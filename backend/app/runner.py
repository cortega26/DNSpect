from __future__ import annotations

import hashlib
import json
import os
import platform
import random
import re
import shutil
import string
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any, Literal

import dns.exception
import dns.message
import dns.query
import dns.quic
import dns.rcode
import dns.resolver
from platformdirs import user_data_path
from pydantic import ValidationError

from .detect_dns import detect_system_dns
from .models import (
    BenchmarkProtocol,
    BenchmarkRequest,
    ComparisonReasonCode,
    ProbeRequest,
    ProtocolComparisonPreflightResponse,
    ProtocolComparisonRequest,
    ProtocolEndpointIdentity,
    ProtocolExclusion,
    RunComparisonDeltas,
    RunComparisonMetrics,
    RunComparisonResponse,
    RunComparisonRow,
    RunManifest,
    TargetSnapshot,
    WatchConfigRequest,
)
from .providers import (
    build_default_resolvers,
    is_valid_dns_hostname,
    is_valid_doh_url,
    load_blocking_domains,
    load_default_queries,
    load_providers,
    resolver_provider_index,
)
from .stats import (
    apply_normalized_scoring,
    compute_blocking_efficacy,
    compute_stats,
    parse_drill_query_time,
    select_recommended_resolver,
)
from .watch import WatchScheduler

TERMINAL_STATUSES = {"done", "failed", "cancelled"}

RUN_MANIFEST_VERSION = 1
RESPONSE_SEMANTICS_VERSION = "dns-response-v1"
SCORING_SEMANTICS_VERSION = "score-v1"
NORMAL_QUERY_SCHEDULE_VERSION = "round-robin-v1"
DIAGNOSTIC_POLICY_VERSION = "random-nxdomain-v1"

PROTOCOL_COMPARISON_MANIFEST_VERSION = 2
PROTOCOL_COMPARISON_DIAGNOSTIC_POLICY_VERSION = "protocol-v1"

COMPARISON_ADMISSION_REASON_CODES: tuple[
    Literal["no_common_targets", "attempt_budget_exceeded", "duration_budget_exceeded"], ...
] = ("no_common_targets", "attempt_budget_exceeded", "duration_budget_exceeded")

COMPARISON_REASON_ORDER: tuple[ComparisonReasonCode, ...] = (
    ComparisonReasonCode.manifest_missing,
    ComparisonReasonCode.manifest_invalid,
    ComparisonReasonCode.manifest_version_mismatch,
    ComparisonReasonCode.response_semantics_mismatch,
    ComparisonReasonCode.scoring_semantics_mismatch,
    ComparisonReasonCode.scoring_profile_mismatch,
    ComparisonReasonCode.target_snapshot_mismatch,
    ComparisonReasonCode.protocol_mismatch,
    ComparisonReasonCode.query_plan_mismatch,
    ComparisonReasonCode.mode_mismatch,
    ComparisonReasonCode.runs_mismatch,
    ComparisonReasonCode.timeout_mismatch,
    ComparisonReasonCode.diagnostic_policy_mismatch,
    ComparisonReasonCode.provider_catalog_mismatch,
)

COMPARISON_METRIC_KEYS = (
    "median_ms",
    "p95_ms",
    "success_rate",
    "failure_rate",
    "blocking_efficacy",
    "score_total",
)


def _resolve_runs_dir() -> Path:
    override = os.getenv("DNS_SPEED_LAB_RUNS_DIR")
    if override:
        return Path(override).expanduser().resolve()
    return user_data_path("dnspect", "DNSpect") / "runs"


def _to_positive_int(raw: str | None, default: int) -> int:
    if raw is None:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        return default
    return max(parsed, 1)


DATA_RUNS = _resolve_runs_dir()
with suppress(OSError):
    DATA_RUNS.mkdir(parents=True, exist_ok=True)

DRILL_RCODE_RE = re.compile(r"rcode:\s*([A-Z]+)", re.IGNORECASE)
DRILL_ANSWER_RE = re.compile(r"^[a-zA-Z0-9._-]+\s+\d+\s+IN\s+A\s+([\d.]+)", re.MULTILINE)
RELIABILITY_FAILURE_KINDS = {"timeout", "servfail", "refused", "noanswer", "other"}


def dns_quic_available() -> bool:
    return dns.quic.have_quic


FIXED_DIAGNOSTIC_ATTEMPTS = 2


@dataclass
class BenchmarkWorkEstimate:
    normal_attempts_per_resolver: int
    blocking_attempts_per_resolver: int
    diagnostic_attempts_per_resolver: int
    total_attempts: int
    estimated_duration_sec: float


def _resolver_rank_key(item: dict[str, Any]) -> tuple[float, float, float, str]:
    stats = item.get("stats", {})
    score_total = stats.get("score_total")
    avg_latency = stats.get("avg_ms")
    score_stability = stats.get("score_stability")
    return (
        float(score_total) if score_total is not None else float("inf"),
        float(avg_latency) if avg_latency is not None else float("inf"),
        float(score_stability) if score_stability is not None else float("inf"),
        str(item.get("resolver", "")),
    )


def _canonical_json_sha256(payload: Any, *, sort_keys: bool = False) -> str:
    """Byte-stable sha256 over the canonical JSON form used by run manifests."""
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=sort_keys, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _build_run_manifest(
    config: BenchmarkConfig,
    provider_index: dict[str, dict[str, Any]],
    blocking_queries: list[str],
) -> RunManifest:
    schedule = [config.queries[run_idx % len(config.queries)] for run_idx in range(config.runs)]
    return RunManifest(
        run_manifest_version=RUN_MANIFEST_VERSION,
        response_semantics_version=RESPONSE_SEMANTICS_VERSION,
        scoring_semantics_version=SCORING_SEMANTICS_VERSION,
        scoring_profile=config.scoring_profile,
        target_snapshot=config.target_snapshot,
        protocol=config.protocol,
        mode=config.mode,
        runs=config.runs,
        timeout_sec=config.timeout_sec,
        normal_query_schedule_version=NORMAL_QUERY_SCHEDULE_VERSION,
        normal_query_plan_sha256=_canonical_json_sha256(schedule),
        normal_query_count=len(schedule),
        blocking_query_plan_sha256=_canonical_json_sha256(blocking_queries),
        blocking_query_count=len(blocking_queries),
        diagnostic_policy_version=DIAGNOSTIC_POLICY_VERSION,
        provider_catalog_sha256=_canonical_json_sha256(provider_index, sort_keys=True),
    )


def _opt_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_manifest(data: dict[str, Any]) -> tuple[RunManifest | None, ComparisonReasonCode | None]:
    raw = data.get("manifest")
    if raw is None:
        return None, ComparisonReasonCode.manifest_missing
    try:
        return RunManifest.model_validate(raw), None
    except (ValidationError, TypeError, ValueError):
        return None, ComparisonReasonCode.manifest_invalid


def _manifest_mismatch_reason_codes(
    baseline: RunManifest, candidate: RunManifest
) -> list[ComparisonReasonCode]:
    checks: list[tuple[bool, ComparisonReasonCode]] = [
        (
            baseline.run_manifest_version != candidate.run_manifest_version,
            ComparisonReasonCode.manifest_version_mismatch,
        ),
        (
            baseline.response_semantics_version != candidate.response_semantics_version,
            ComparisonReasonCode.response_semantics_mismatch,
        ),
        (
            baseline.scoring_semantics_version != candidate.scoring_semantics_version,
            ComparisonReasonCode.scoring_semantics_mismatch,
        ),
        (
            baseline.scoring_profile != candidate.scoring_profile,
            ComparisonReasonCode.scoring_profile_mismatch,
        ),
        (
            baseline.target_snapshot != candidate.target_snapshot,
            ComparisonReasonCode.target_snapshot_mismatch,
        ),
        (
            baseline.protocol != candidate.protocol,
            ComparisonReasonCode.protocol_mismatch,
        ),
        (
            baseline.normal_query_schedule_version != candidate.normal_query_schedule_version
            or baseline.normal_query_plan_sha256 != candidate.normal_query_plan_sha256
            or baseline.normal_query_count != candidate.normal_query_count
            or baseline.blocking_query_plan_sha256 != candidate.blocking_query_plan_sha256
            or baseline.blocking_query_count != candidate.blocking_query_count,
            ComparisonReasonCode.query_plan_mismatch,
        ),
        (
            baseline.mode != candidate.mode,
            ComparisonReasonCode.mode_mismatch,
        ),
        (
            baseline.runs != candidate.runs,
            ComparisonReasonCode.runs_mismatch,
        ),
        (
            baseline.timeout_sec != candidate.timeout_sec,
            ComparisonReasonCode.timeout_mismatch,
        ),
        (
            baseline.diagnostic_policy_version != candidate.diagnostic_policy_version,
            ComparisonReasonCode.diagnostic_policy_mismatch,
        ),
        (
            baseline.provider_catalog_sha256 != candidate.provider_catalog_sha256,
            ComparisonReasonCode.provider_catalog_mismatch,
        ),
    ]
    return [code for mismatched, code in checks if mismatched]


def _comparison_metrics(result: dict[str, Any]) -> RunComparisonMetrics:
    stats = result.get("stats") or {}
    return RunComparisonMetrics(
        median_ms=_opt_float(stats.get("median_ms")),
        p95_ms=_opt_float(stats.get("p95_ms")),
        success_rate=_opt_float(stats.get("success_rate")),
        failure_rate=_opt_float(stats.get("failure_rate")),
        blocking_efficacy=_opt_float(stats.get("blocking_efficacy")),
        score_total=_opt_float(stats.get("score_total")),
    )


def _comparison_deltas(
    baseline_stats: dict[str, Any],
    candidate_stats: dict[str, Any],
    *,
    baseline_rank: int,
    candidate_rank: int,
) -> RunComparisonDeltas:
    deltas: dict[str, float | None] = {}
    for key in COMPARISON_METRIC_KEYS:
        baseline_value = _opt_float(baseline_stats.get(key))
        candidate_value = _opt_float(candidate_stats.get(key))
        if baseline_value is None or candidate_value is None:
            deltas[key] = None
        else:
            deltas[key] = round(candidate_value - baseline_value, 4)
    return RunComparisonDeltas(
        median_ms=deltas["median_ms"],
        p95_ms=deltas["p95_ms"],
        success_rate=deltas["success_rate"],
        failure_rate=deltas["failure_rate"],
        blocking_efficacy=deltas["blocking_efficacy"],
        score_total=deltas["score_total"],
        rank=candidate_rank - baseline_rank,
    )


def _ranked_resolvers(data: dict[str, Any]) -> dict[str, int]:
    results = sorted(data.get("results") or [], key=_resolver_rank_key)
    return {str(item.get("resolver", "")): index + 1 for index, item in enumerate(results)}


def _protocol_diagnostic_domain(parent_id: str) -> str:
    nonce = hashlib.sha256(f"dnspect-protocol-v1:{parent_id}".encode()).hexdigest()[:16]
    return f"{nonce}.dnspect.invalid"


def _resolver_protocol_endpoint(
    resolver_ip: str, protocol: BenchmarkProtocol, provider_index: dict[str, dict[str, Any]],
) -> tuple[str | None, str | None]:
    """(endpoint, exclusion_code) — the single source of per-protocol eligibility."""
    if protocol == BenchmarkProtocol.udp:
        return resolver_ip, None
    provider = provider_index.get(resolver_ip)
    features = (provider or {}).get("features") or {}
    if protocol == BenchmarkProtocol.dot:
        hostname = features.get("dot_hostname")
        if not isinstance(hostname, str) or not hostname.strip():
            return None, "dot_hostname_missing"
        if not is_valid_dns_hostname(hostname):
            return None, "dot_hostname_invalid"
        return hostname, None
    if protocol == BenchmarkProtocol.doh:
        url = features.get("doh_url")
        if not isinstance(url, str) or not url.strip():
            return None, "doh_url_missing"
        if not is_valid_doh_url(url):
            return None, "doh_url_invalid"
        return url, None
    if protocol == BenchmarkProtocol.doq:
        if features.get("doq") != "yes":
            return None, "doq_unsupported"
        if not dns_quic_available():
            return None, "doq_unavailable"
        hostname = features.get("doq_hostname")
        if not isinstance(hostname, str) or not hostname.strip():
            return None, "doq_hostname_missing"
        if not is_valid_dns_hostname(hostname):
            return None, "doq_hostname_invalid"
        return hostname, None
    return None, "invalid_protocol"


def _protocol_metrics_dict(result: dict[str, Any]) -> dict[str, float | None]:
    stats = result.get("stats") or {}
    return {
        "median_ms": _opt_float(stats.get("median_ms")),
        "p95_ms": _opt_float(stats.get("p95_ms")),
        "success_rate": _opt_float(stats.get("success_rate")),
        "failure_rate": _opt_float(stats.get("failure_rate")),
        "blocking_efficacy": _opt_float(stats.get("blocking_efficacy")),
        "score_total": _opt_float(stats.get("score_total")),
    }


def _protocol_deltas_dict(
    baseline: dict[str, float | None], candidate: dict[str, float | None]
) -> dict[str, float | None]:
    deltas: dict[str, float | None] = {}
    for key in COMPARISON_METRIC_KEYS:
        baseline_value = baseline.get(key)
        candidate_value = candidate.get(key)
        if baseline_value is None or candidate_value is None:
            deltas[key] = None
        else:
            deltas[key] = round(candidate_value - baseline_value, 4)
    return deltas


def _subrun_results_by_resolver(subrun: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if subrun is None:
        return {}
    return {str(item.get("resolver", "")): item for item in subrun.get("results") or []}


def _protocol_delta_pairs(state: ProtocolComparisonState) -> list[dict[str, Any]]:
    manifest = state.manifest or {}
    canonical = manifest.get("canonical_protocols") or []
    common_resolvers = (manifest.get("common_eligible_target_snapshot") or {}).get("resolver_ips") or []
    if not canonical or not common_resolvers:
        return []
    done_subruns = {
        subrun.get("protocol"): subrun for subrun in state.subruns if subrun.get("status") == "done"
    }
    baseline_protocol = canonical[0]
    pairs: list[dict[str, Any]] = []
    for candidate_protocol in canonical[1:]:
        baseline_results = _subrun_results_by_resolver(done_subruns.get(baseline_protocol))
        candidate_results = _subrun_results_by_resolver(done_subruns.get(candidate_protocol))
        rows: list[dict[str, Any]] = []
        for resolver in common_resolvers:
            baseline_result = baseline_results.get(resolver)
            candidate_result = candidate_results.get(resolver)
            baseline_metrics = (
                _protocol_metrics_dict(baseline_result) if baseline_result is not None else None
            )
            candidate_metrics = (
                _protocol_metrics_dict(candidate_result) if candidate_result is not None else None
            )
            if baseline_metrics is None or candidate_metrics is None:
                deltas: dict[str, float | None] = {key: None for key in COMPARISON_METRIC_KEYS}
            else:
                deltas = _protocol_deltas_dict(baseline_metrics, candidate_metrics)
            rows.append(
                {
                    "resolver": resolver,
                    "baseline": baseline_metrics,
                    "candidate": candidate_metrics,
                    "deltas": deltas,
                }
            )
        pairs.append(
            {
                "baseline_protocol": baseline_protocol,
                "candidate_protocol": candidate_protocol,
                "rows": rows,
            }
        )
    return pairs


@dataclass
class ProtocolComparisonState:
    comparison_id: str
    status: str
    started_at: str
    finished_at: str | None = None
    complete: bool = False
    error: str | None = None
    run_storage_warning: str | None = None
    progress_current: int = 0
    progress_total: int = 0
    current_protocol: str | None = None
    current_resolver: str | None = None
    last_sample_at: int | None = None
    observed_latency_total_ms: float = 0.0
    observed_latency_count: int = 0
    manifest: dict[str, Any] | None = None
    exclusions: list[dict[str, Any]] = field(default_factory=list)
    subruns: list[dict[str, Any]] = field(default_factory=list)
    delta_pairs: list[dict[str, Any]] = field(default_factory=list)

    def as_response(self) -> dict[str, Any]:
        progress = {
            "current": self.progress_current,
            "total": self.progress_total,
            "current_protocol": self.current_protocol,
            "current_resolver": self.current_resolver,
            "last_sample_at": self.last_sample_at,
            "avg_latency_ms": (
                round(self.observed_latency_total_ms / self.observed_latency_count, 3)
                if self.observed_latency_count > 0
                else None
            ),
        }
        subruns: list[dict[str, Any]] = []
        for subrun in self.subruns:
            serialized = dict(subrun)
            serialized["results"] = (
                _sanitize_results(subrun.get("results") or [], include_samples=False) or []
            )
            subruns.append(serialized)
        return {
            "comparison_id": self.comparison_id,
            "status": self.status,
            "complete": self.complete,
            "error": self.error,
            "run_storage_warning": self.run_storage_warning,
            "progress": progress,
            "manifest": self.manifest,
            "exclusions": self.exclusions,
            "subruns": subruns,
            "delta_pairs": self.delta_pairs,
        }


@dataclass
class ProtocolComparisonPlan:
    comparison_id: str
    canonical_protocols: list[str]
    resolver_ips: list[str]
    schedule: list[str]
    blocking_queries: list[str]
    timeout_sec: float
    effective_runs: int
    diagnostic_domain: str
    scoring_profile: str
    endpoints: dict[str, dict[str, str]]


@dataclass
class BenchmarkState:
    id: str
    status: str
    started_at: str
    finished_at: str | None = None
    progress_current: int = 0
    progress_total: int = 0
    current_resolver: str | None = None
    last_sample_at: int | None = None
    observed_latency_total_ms: float = 0.0
    observed_latency_count: int = 0
    mode: str = "standard"
    goal: str = "speed"
    scoring_profile: str = "speed"
    protocol: str = "udp"
    timeout_sec: float = 2.0
    runs: int = 30
    engine: str | None = None
    error: str | None = None
    results: list[dict[str, Any]] | None = None
    run_storage_warning: str | None = None
    target_snapshot: dict[str, object] | None = None
    manifest: RunManifest | None = None
    origin: str | None = None

    def as_response(self, include_samples: bool = False) -> dict[str, Any]:
        sanitized_results = _sanitize_results(self.results, include_samples=include_samples)
        recommended_resolver, recommendation_warning = select_recommended_resolver(sanitized_results or [])
        response: dict[str, Any] = {
            "id": self.id,
            "status": self.status,
            "progress": {
                "current": self.progress_current,
                "total": self.progress_total,
                "current_resolver": self.current_resolver,
                "last_sample_at": self.last_sample_at,
                "avg_latency_ms": (
                    round(self.observed_latency_total_ms / self.observed_latency_count, 3)
                    if self.observed_latency_count > 0
                    else None
                ),
            },
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "mode": self.mode,
            "goal": self.goal,
            "scoring_profile": self.scoring_profile,
            "protocol": self.protocol,
            "timeout_sec": self.timeout_sec,
            "runs": self.runs,
            "engine": self.engine,
            "error": self.error,
            "run_storage_warning": self.run_storage_warning,
            "results": sanitized_results,
            "recommended_resolver": recommended_resolver,
            "recommendation_warning": recommendation_warning,
            "target_snapshot": self.target_snapshot,
            "manifest": self.manifest.model_dump() if self.manifest else None,
            "origin": self.origin,
        }
        return response


@dataclass
class BenchmarkConfig:
    resolvers: list[str]
    queries: list[str]
    runs: int
    timeout_sec: float
    mode: str
    goal: str
    scoring_profile: str
    protocol: str
    target_snapshot: dict[str, object] | None = None
    origin: str | None = None


def _sanitize_results(
    results: list[dict[str, Any]] | None,
    *,
    include_samples: bool,
) -> list[dict[str, Any]] | None:
    if results is None:
        return None

    sanitized: list[dict[str, Any]] = []
    for result in results:
        item = dict(result)
        samples = item.get("samples") or []
        if include_samples:
            item["samples"] = samples
        else:
            item["sample_count"] = len(samples)
            item["samples"] = []
        sanitized.append(item)
    return sanitized


def _rcode_to_failure_kind(rcode_str: str) -> str | None:
    """Map a DNS RCODE string to failure_kind. Returns None for NOERROR."""
    upper = rcode_str.upper()
    if upper == "NOERROR":
        return None
    if upper == "NXDOMAIN":
        return "nxdomain"
    if upper == "SERVFAIL":
        return "servfail"
    if upper == "REFUSED":
        return "refused"
    return "other"


def classify_failure_from_text(text: str) -> str:
    upper = text.upper()
    rcode_match = DRILL_RCODE_RE.search(upper)
    rcode = rcode_match.group(1).upper() if rcode_match else ""

    if "TIMEOUT" in upper:
        return "timeout"
    if rcode == "NXDOMAIN" or "NXDOMAIN" in upper:
        return "nxdomain"
    if rcode == "SERVFAIL" or "SERVFAIL" in upper:
        return "servfail"
    if rcode == "REFUSED" or "REFUSED" in upper:
        return "refused"
    if "NOANSWER" in upper or "NO ANSWER" in upper:
        return "noanswer"

    return "other"


def classify_dnspython_exception(exc: Exception) -> str:
    if isinstance(exc, dns.exception.Timeout):
        return "timeout"
    if isinstance(exc, dns.resolver.NXDOMAIN):
        return "nxdomain"
    if isinstance(exc, dns.resolver.NoAnswer):
        return "noanswer"
    if isinstance(exc, dns.resolver.NoNameservers):
        return classify_failure_from_text(str(exc))
    if isinstance(exc, dns.exception.DNSException):
        return classify_failure_from_text(str(exc))
    return "other"


def is_generated_run_id(benchmark_id: str) -> bool:
    """True only for the canonical lowercase UUIDv4 hex form from ``uuid.uuid4().hex``."""
    try:
        parsed = uuid.UUID(benchmark_id)
    except (ValueError, AttributeError, TypeError):
        return False
    return parsed.version == 4 and parsed.hex == benchmark_id


def _build_history_summary(snapshot: dict[str, Any]) -> dict[str, Any]:
    results = snapshot.get("results") or []
    return {
        "id": snapshot.get("id"),
        "mode": snapshot.get("mode"),
        "goal": snapshot.get("goal") or snapshot.get("scoring_profile"),
        "scoring_profile": snapshot.get("scoring_profile") or snapshot.get("goal"),
        "protocol": snapshot.get("protocol"),
        "started_at": snapshot.get("started_at"),
        "finished_at": snapshot.get("finished_at"),
        "status": snapshot.get("status"),
        "target_snapshot": snapshot.get("target_snapshot"),
        "results_summary": [
            {"provider_name": r.get("provider_name"), "resolver": r.get("resolver")} for r in results[:3]
        ],
        "origin": snapshot.get("origin"),
    }


class BenchmarkManager:
    def __init__(
        self,
        *,
        max_concurrent_jobs: int | None = None,
        max_queued_jobs: int | None = None,
        terminal_ttl_sec: int | None = None,
        max_retained_states: int | None = None,
        data_runs_dir: Path | None = None,
        watch_dir: Path | None = None,
    ) -> None:
        self._lock = threading.RLock()
        self._states: dict[str, BenchmarkState] = {}
        self._protocol_comparison_states: dict[str, ProtocolComparisonState] = {}
        self.max_concurrent_jobs = max_concurrent_jobs or _to_positive_int(
            os.getenv("DNS_SPEED_LAB_MAX_CONCURRENT_JOBS"), 2
        )
        self.max_queued_jobs = max_queued_jobs or _to_positive_int(
            os.getenv("DNS_SPEED_LAB_MAX_QUEUED_JOBS"), 5
        )
        self.terminal_ttl_sec = terminal_ttl_sec or _to_positive_int(
            os.getenv("DNS_SPEED_LAB_TERMINAL_TTL_SEC"), 3600
        )
        self.max_retained_states = max_retained_states or _to_positive_int(
            os.getenv("DNS_SPEED_LAB_MAX_RETAINED_STATES"), 256
        )
        self.max_query_attempts = _to_positive_int(os.getenv("DNS_SPEED_LAB_MAX_QUERY_ATTEMPTS"), 10000)
        self.max_estimated_duration_sec = _to_positive_int(
            os.getenv("DNS_SPEED_LAB_MAX_ESTIMATED_DURATION_SEC"), 14400
        )
        self._data_runs_dir = data_runs_dir or DATA_RUNS
        self._executor = ThreadPoolExecutor(
            max_workers=self.max_concurrent_jobs,
            thread_name_prefix="dnsbench",
        )
        self.providers = load_providers()
        self.provider_index = resolver_provider_index(self.providers)
        self.default_queries = load_default_queries()
        self.default_resolvers = build_default_resolvers(self.providers)
        self.blocking_test_queries = load_blocking_domains()
        self.persist_samples = os.getenv("DNS_SPEED_LAB_PERSIST_SAMPLES", "0").strip().lower() in {
            "1",
            "true",
            "yes",
        }
        self._watch_scheduler = WatchScheduler(self, watch_dir=watch_dir)

    def providers_payload(self) -> list[dict[str, Any]]:
        return self.providers

    def system_dns_payload(self) -> dict[str, Any]:
        payload = detect_system_dns()
        payload["detected_provider_id"] = "isp-detectado"
        return payload

    def _estimate_benchmark_work(
        self,
        *,
        resolver_count: int,
        runs: int,
        timeout_sec: float,
        protocol_count: int = 1,
    ) -> BenchmarkWorkEstimate:
        blocking = len(self.blocking_test_queries)
        normal_per_resolver = runs
        diag_per_resolver = FIXED_DIAGNOSTIC_ATTEMPTS
        total = (normal_per_resolver + blocking + diag_per_resolver) * resolver_count * protocol_count
        drill_allowance = timeout_sec + 0.6
        est_duration = total * drill_allowance
        return BenchmarkWorkEstimate(
            normal_attempts_per_resolver=normal_per_resolver,
            blocking_attempts_per_resolver=blocking,
            diagnostic_attempts_per_resolver=diag_per_resolver,
            total_attempts=total,
            estimated_duration_sec=est_duration,
        )

    def _build_config(self, req: BenchmarkRequest) -> BenchmarkConfig:
        runs = req.effective_runs()
        timeout_sec = float(req.timeout_sec)
        queries = req.queries or self.default_queries
        if not queries:
            raise ValueError("No hay dominios para consultar")

        protocol = req.protocol.value

        if protocol == "doq" and not dns_quic_available():
            raise ValueError("DoQ no disponible en esta instalación (falta aioquic).")

        if req.resolvers:
            resolvers = req.resolvers
        else:
            system_dns = self.system_dns_payload().get("resolvers", [])
            resolvers = list(dict.fromkeys(self.default_resolvers + system_dns))

        resolvers = [r for r in resolvers if self._resolver_supports_protocol(r, protocol)]

        if not resolvers:
            raise ValueError("No hay resolvers disponibles para el protocolo seleccionado")

        scoring_profile = req.effective_scoring_profile()
        if req.target_snapshot is not None:
            target_snapshot_dict = req.target_snapshot.model_dump()
        else:
            # "catalog" approximates the implicit default set (catalog defaults + detected system DNS).
            target_snapshot_dict = {
                "resolver_ips": list(resolvers),
                "selection_source": "manual" if req.resolvers else "catalog",
                "provider_ids": {
                    ip: provider.get("id", "")
                    for ip in resolvers
                    for provider in [self.provider_index.get(ip) or {}]
                    if provider.get("id")
                },
            }

        return BenchmarkConfig(
            resolvers=resolvers,
            queries=queries,
            runs=runs,
            timeout_sec=timeout_sec,
            mode=req.mode.value,
            goal=scoring_profile,
            scoring_profile=scoring_profile,
            protocol=req.protocol.value,
            target_snapshot=target_snapshot_dict,
            origin=req.origin.value if req.origin else None,
        )

    def start(self, req: BenchmarkRequest) -> str:
        config = self._build_config(req)
        work = self._estimate_benchmark_work(
            resolver_count=len(config.resolvers),
            runs=config.runs,
            timeout_sec=config.timeout_sec,
        )
        if work.total_attempts > self.max_query_attempts:
            raise ValueError(
                "Demasiados intentos de consulta. "
                f"Reduzca cantidad de resolvers o ejecuciones "
                f"(máximo: {self.max_query_attempts} intentos)."
            )
        if work.estimated_duration_sec > self.max_estimated_duration_sec:
            raise ValueError(
                "Duración estimada excede el límite. "
                f"Reduzca tiempo de espera, resolvers o ejecuciones "
                f"(máximo: {self.max_estimated_duration_sec} segundos)."
            )
        benchmark_id = uuid.uuid4().hex
        manifest = _build_run_manifest(config, self.provider_index, self.blocking_test_queries)
        state = BenchmarkState(
            id=benchmark_id,
            status="queued",
            started_at=datetime.now(UTC).isoformat(),
            last_sample_at=int(datetime.now(UTC).timestamp() * 1000),
            progress_total=work.total_attempts,
            mode=config.mode,
            goal=config.goal,
            scoring_profile=config.scoring_profile,
            protocol=config.protocol,
            timeout_sec=config.timeout_sec,
            runs=config.runs,
            target_snapshot=config.target_snapshot,
            manifest=manifest,
            origin=config.origin,
        )
        with self._lock:
            self._cleanup_terminal_states_locked()
            running_count = sum(1 for item in self._states.values() if item.status == "running")
            queued_count = sum(1 for item in self._states.values() if item.status == "queued")
            running_count += sum(
                1 for item in self._protocol_comparison_states.values() if item.status == "running"
            )
            queued_count += sum(
                1 for item in self._protocol_comparison_states.values() if item.status == "queued"
            )
            if running_count + queued_count >= (self.max_concurrent_jobs + self.max_queued_jobs):
                raise ValueError("Capacidad de benchmark agotada. Intenta nuevamente en unos minutos.")
            self._states[benchmark_id] = state
        self._persist_run(benchmark_id)
        try:
            self._executor.submit(self._run, benchmark_id, config)
        except RuntimeError as exc:
            with self._lock:
                self._states.pop(benchmark_id, None)
            persisted = self._persisted_run_path(benchmark_id)
            if persisted is not None:
                with suppress(OSError):
                    persisted.unlink()
                with suppress(OSError):
                    (self._data_runs_dir / f"{benchmark_id}.summary.json").unlink()
            raise ValueError("No se pudo iniciar benchmark en este momento.") from exc
        return benchmark_id

    def probe(self, req: ProbeRequest) -> dict[str, Any]:
        queries = req.queries or self.default_queries
        if not queries:
            raise ValueError("No hay dominios para consultar en probe")

        engine = select_engine()
        results: list[dict[str, Any]] = []
        for resolver in req.resolvers:
            successful_ms: list[float] = []
            samples: list[dict[str, Any]] = []
            timeout_count = 0
            failure_count = 0

            for run_idx in range(req.runs_per_resolver):
                domain = queries[run_idx % len(queries)]
                sample = measure_query(
                    resolver=resolver,
                    domain=domain,
                    timeout_sec=float(req.timeout_sec),
                    engine=engine,
                )
                sample["run_index"] = run_idx + 1
                samples.append(sample)
                if sample.get("ok") and sample.get("ms") is not None:
                    successful_ms.append(float(sample["ms"]))
                if sample.get("failure_kind") == "timeout":
                    timeout_count += 1
                if sample.get("failure_kind") in RELIABILITY_FAILURE_KINDS:
                    failure_count += 1

            stats = compute_stats(
                successful_ms,
                total_runs=req.runs_per_resolver,
                timeout_count=timeout_count,
                failure_count=failure_count,
            )
            provider = self.provider_index.get(
                resolver,
                {
                    "id": "isp-detectado",
                    "name": "ISP (Detectado)",
                    "notes_es": "Resolver detectado desde el sistema local.",
                },
            )
            results.append(
                {
                    "resolver": resolver,
                    "provider_id": provider.get("id", "desconocido"),
                    "provider_name": provider.get("name", "Desconocido"),
                    "engine": engine,
                    "stats": stats,
                    "samples": samples,
                }
            )

        return {
            "engine": engine,
            "timeout_sec": float(req.timeout_sec),
            "runs_per_resolver": req.runs_per_resolver,
            "queried_at": datetime.now(UTC).isoformat(),
            "results": results,
        }

    def _persisted_run_path(self, benchmark_id: str) -> Path | None:
        """Return the metadata path only for canonical lowercase UUIDv4 hex IDs.

        Accepts exactly the 32-character lowercase hex form produced by
        ``uuid.uuid4().hex`` in ``start()``. Any other identifier returns None
        without touching the disk; the resolved candidate must also stay
        contained in the runs directory.
        """
        if not is_generated_run_id(benchmark_id):
            return None

        candidate = self._data_runs_dir / f"{benchmark_id}.json"
        try:
            if not candidate.resolve().is_relative_to(self._data_runs_dir.resolve()):
                return None
        except OSError:
            return None
        return candidate

    def get(self, benchmark_id: str, include_samples: bool = False) -> dict[str, Any] | None:
        with self._lock:
            self._cleanup_terminal_states_locked()
            state = self._states.get(benchmark_id)
            if state:
                return state.as_response(include_samples=include_samples)

        # Fallback: load from disk, only for canonical generated IDs
        result_path = self._persisted_run_path(benchmark_id)
        if result_path is None or not result_path.exists():
            return None
        try:
            data: dict[str, Any] = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        if include_samples:
            samples_path = self._data_runs_dir / f"{benchmark_id}.samples.json"
            try:
                samples_data = json.loads(samples_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                samples_data = None
            if isinstance(samples_data, dict):
                return samples_data
        return data

    def get_state(self, benchmark_id: str) -> BenchmarkState | None:
        with self._lock:
            self._cleanup_terminal_states_locked()
            return self._states.get(benchmark_id)

    def list_history(self) -> dict[str, list[dict[str, Any]]]:
        runs: list[dict[str, Any]] = []
        if not self._data_runs_dir.exists():
            return {"runs": runs}
        for path in sorted(self._data_runs_dir.glob("[!.]*.json")):
            if path.name.endswith(".samples.json"):
                continue
            if path.name.endswith(".summary.json"):
                continue
            summary_path = self._data_runs_dir / f"{path.stem}.summary.json"
            try:
                summary_data = json.loads(summary_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                summary_data = None
            if isinstance(summary_data, dict):
                summary_data.setdefault("id", path.stem)
                runs.append(summary_data)
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(data, dict):
                continue
            results = data.get("results") or []
            entry = {
                "id": path.stem,
                "mode": data.get("mode"),
                "goal": data.get("goal") or data.get("scoring_profile"),
                "scoring_profile": data.get("scoring_profile") or data.get("goal"),
                "protocol": data.get("protocol"),
                "started_at": data.get("started_at"),
                "finished_at": data.get("finished_at"),
                "status": data.get("status"),
                "target_snapshot": data.get("target_snapshot"),
                "origin": data.get("origin"),
                "results_summary": [
                    {"provider_name": r.get("provider_name"), "resolver": r.get("resolver")}
                    for r in results[:3]
                ],
            }
            runs.append(entry)

        def _sort_key(entry: dict[str, Any]) -> tuple[float, int, str]:
            started_raw = entry.get("started_at")
            try:
                parsed = datetime.fromisoformat(str(started_raw))
                return (parsed.timestamp(), 0, str(entry.get("id", "")))
            except (ValueError, TypeError):
                return (0, 1, str(entry.get("id", "")))

        runs.sort(key=_sort_key, reverse=True)
        return {"runs": runs[:50]}

    def create_watch(self, request: WatchConfigRequest) -> str:
        return self._watch_scheduler.create(request)

    def delete_watch(self, watch_id: str) -> bool:
        return self._watch_scheduler.delete(watch_id)

    def list_watches(self) -> dict[str, list[dict[str, Any]]]:
        return self._watch_scheduler.list_watches()

    def get_watch_status(self, watch_id: str) -> dict[str, Any] | None:
        return self._watch_scheduler.get_status(watch_id)

    def preflight_protocol_comparison(
        self, request: ProtocolComparisonRequest
    ) -> ProtocolComparisonPreflightResponse:
        """Single source of eligibility truth for the preflight and start routes.

        Never allocates an ID, submits work, or reserves queue capacity.
        """
        canonical_protocols = list(request.protocols)
        requested_target = request.target_snapshot
        queries = request.queries or self.default_queries
        if not queries:
            raise ValueError("No hay dominios para consultar")
        effective_runs = request.effective_runs()
        timeout_sec = float(request.timeout_sec)

        common_resolvers: list[str] = []
        endpoint_identities: list[dict[str, Any]] = []
        exclusions: list[dict[str, Any]] = []
        for resolver in requested_target.resolver_ips:
            endpoints: dict[str, str | None] = {}
            excluded: list[tuple[str, str]] = []
            for protocol in canonical_protocols:
                endpoint, exclusion = _resolver_protocol_endpoint(resolver, protocol, self.provider_index)
                endpoints[protocol.value] = endpoint
                if exclusion is not None:
                    excluded.append((protocol.value, exclusion))
            for protocol_value, exclusion in excluded:
                exclusions.append({"resolver": resolver, "protocol": protocol_value, "code": exclusion})
            if excluded:
                continue
            common_resolvers.append(resolver)
            endpoint_identities.append(
                {
                    "resolver": resolver,
                    "udp_resolver_ip": resolver,
                    "dot_hostname": (
                        endpoints.get("dot") if BenchmarkProtocol.dot in canonical_protocols else None
                    ),
                    "doh_url": (
                        endpoints.get("doh") if BenchmarkProtocol.doh in canonical_protocols else None
                    ),
                }
            )

        if common_resolvers:
            provider_ids: dict[str, str] | None = None
            if requested_target.provider_ids is not None:
                provider_ids = {
                    ip: pid for ip, pid in requested_target.provider_ids.items() if ip in common_resolvers
                }
            common_target = TargetSnapshot(
                resolver_ips=common_resolvers,
                selection_source=requested_target.selection_source,
                provider_ids=provider_ids,
            )
        else:
            common_target = None

        schedule = [queries[run_idx % len(queries)] for run_idx in range(effective_runs)]
        normal_plan_sha256 = _canonical_json_sha256(schedule)
        blocking_plan_sha256 = _canonical_json_sha256(self.blocking_test_queries)

        work = self._estimate_benchmark_work(
            resolver_count=len(common_resolvers),
            runs=effective_runs,
            timeout_sec=timeout_sec,
            protocol_count=len(canonical_protocols),
        )

        reason_codes: list[
            Literal["no_common_targets", "attempt_budget_exceeded", "duration_budget_exceeded"]
        ] = []
        if len(common_resolvers) == 0:
            reason_codes.append("no_common_targets")
        if work.total_attempts > self.max_query_attempts:
            reason_codes.append("attempt_budget_exceeded")
        if work.estimated_duration_sec > self.max_estimated_duration_sec:
            reason_codes.append("duration_budget_exceeded")

        return ProtocolComparisonPreflightResponse(
            canonical_protocols=canonical_protocols,
            requested_target_snapshot=requested_target,
            common_eligible_target_snapshot=common_target,
            exclusions=[ProtocolExclusion(**item) for item in exclusions],
            endpoint_identities=[ProtocolEndpointIdentity(**item) for item in endpoint_identities],
            normal_query_plan_sha256=normal_plan_sha256,
            normal_query_count=len(schedule),
            blocking_query_plan_sha256=blocking_plan_sha256,
            blocking_query_count=len(self.blocking_test_queries),
            effective_runs=effective_runs,
            timeout_sec=timeout_sec,
            total_attempts=work.total_attempts,
            estimated_duration_sec=work.estimated_duration_sec,
            admissible=not reason_codes,
            admission_reason_codes=reason_codes,
        )

    def _reject_inadmissible_preflight(self, preflight: ProtocolComparisonPreflightResponse) -> None:
        codes = preflight.admission_reason_codes
        if "no_common_targets" in codes:
            raise ValueError("Sin resolvers compatibles con todos los protocolos seleccionados")
        if "attempt_budget_exceeded" in codes:
            raise ValueError(
                "Demasiados intentos de consulta. "
                f"Reduzca cantidad de resolvers o ejecuciones "
                f"(máximo: {self.max_query_attempts} intentos)."
            )
        if "duration_budget_exceeded" in codes:
            raise ValueError(
                "Duración estimada excede el límite. "
                f"Reduzca tiempo de espera, resolvers o ejecuciones "
                f"(máximo: {self.max_estimated_duration_sec} segundos)."
            )

    def start_protocol_comparison(self, request: ProtocolComparisonRequest) -> str:
        preflight = self.preflight_protocol_comparison(request)
        self._reject_inadmissible_preflight(preflight)
        common_target = preflight.common_eligible_target_snapshot
        if common_target is None:
            raise ValueError("Sin resolvers compatibles con todos los protocolos seleccionados")

        work = self._estimate_benchmark_work(
            resolver_count=len(common_target.resolver_ips),
            runs=preflight.effective_runs,
            timeout_sec=preflight.timeout_sec,
            protocol_count=len(preflight.canonical_protocols),
        )
        if work.total_attempts > self.max_query_attempts:
            raise ValueError(
                "Demasiados intentos de consulta. "
                f"Reduzca cantidad de resolvers o ejecuciones "
                f"(máximo: {self.max_query_attempts} intentos)."
            )
        if work.estimated_duration_sec > self.max_estimated_duration_sec:
            raise ValueError(
                "Duración estimada excede el límite. "
                f"Reduzca tiempo de espera, resolvers o ejecuciones "
                f"(máximo: {self.max_estimated_duration_sec} segundos)."
            )

        comparison_id = uuid.uuid4().hex
        diagnostic_domain = _protocol_diagnostic_domain(comparison_id)
        queries = request.queries or self.default_queries
        preflight_schedule = [queries[run_idx % len(queries)] for run_idx in range(preflight.effective_runs)]
        manifest: dict[str, Any] = {
            "manifest_version": PROTOCOL_COMPARISON_MANIFEST_VERSION,
            "scoring_profile": request.scoring_profile.value,
            "requested_target_snapshot": request.target_snapshot.model_dump(),
            "common_eligible_target_snapshot": common_target.model_dump(),
            "canonical_protocols": [protocol.value for protocol in preflight.canonical_protocols],
            "normal_query_plan_sha256": preflight.normal_query_plan_sha256,
            "normal_query_count": preflight.normal_query_count,
            "blocking_query_plan_sha256": preflight.blocking_query_plan_sha256,
            "blocking_query_count": preflight.blocking_query_count,
            "diagnostic_policy_version": PROTOCOL_COMPARISON_DIAGNOSTIC_POLICY_VERSION,
            "diagnostic_plan_sha256": _canonical_json_sha256(diagnostic_domain),
            "effective_runs": preflight.effective_runs,
            "timeout_sec": preflight.timeout_sec,
            "endpoint_identities": [item.model_dump() for item in preflight.endpoint_identities],
        }
        state = ProtocolComparisonState(
            comparison_id=comparison_id,
            status="queued",
            started_at=datetime.now(UTC).isoformat(),
            last_sample_at=int(datetime.now(UTC).timestamp() * 1000),
            progress_total=work.total_attempts,
            manifest=manifest,
            exclusions=[item.model_dump() for item in preflight.exclusions],
        )
        with self._lock:
            self._cleanup_protocol_comparison_states_locked()
            running_count = sum(1 for item in self._states.values() if item.status == "running")
            queued_count = sum(1 for item in self._states.values() if item.status == "queued")
            running_count += sum(
                1 for item in self._protocol_comparison_states.values() if item.status == "running"
            )
            queued_count += sum(
                1 for item in self._protocol_comparison_states.values() if item.status == "queued"
            )
            if running_count + queued_count >= (self.max_concurrent_jobs + self.max_queued_jobs):
                raise ValueError("Capacidad de benchmark agotada. Intenta nuevamente en unos minutos.")
            self._protocol_comparison_states[comparison_id] = state

        plan = ProtocolComparisonPlan(
            comparison_id=comparison_id,
            canonical_protocols=[protocol.value for protocol in preflight.canonical_protocols],
            resolver_ips=list(common_target.resolver_ips),
            schedule=list(preflight_schedule),
            blocking_queries=list(self.blocking_test_queries),
            timeout_sec=preflight.timeout_sec,
            effective_runs=preflight.effective_runs,
            diagnostic_domain=diagnostic_domain,
            scoring_profile=request.scoring_profile.value,
            endpoints=self._plan_endpoints(preflight),
        )
        try:
            self._executor.submit(self._run_protocol_comparison, comparison_id, plan)
        except RuntimeError as exc:
            with self._lock:
                self._protocol_comparison_states.pop(comparison_id, None)
            raise ValueError("No se pudo iniciar benchmark en este momento.") from exc
        return comparison_id

    def _plan_endpoints(self, preflight: ProtocolComparisonPreflightResponse) -> dict[str, dict[str, str]]:
        endpoints: dict[str, dict[str, str]] = {}
        for identity in preflight.endpoint_identities:
            entry: dict[str, str] = {"udp": identity.udp_resolver_ip}
            for protocol in (BenchmarkProtocol.dot, BenchmarkProtocol.doh, BenchmarkProtocol.doq):
                endpoint, _ = _resolver_protocol_endpoint(identity.resolver, protocol, self.provider_index)
                if endpoint is not None:
                    entry[protocol.value] = endpoint
            endpoints[identity.resolver] = entry
        return endpoints

    def get_protocol_comparison(self, comparison_id: str) -> ProtocolComparisonState | None:
        with self._lock:
            self._cleanup_protocol_comparison_states_locked()
            state = self._protocol_comparison_states.get(comparison_id)
            if state:
                return state
            result_path = self._persisted_protocol_comparison_path(comparison_id)
            if result_path is None or not result_path.exists():
                return None
        try:
            data: dict[str, Any] = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        progress = data.get("progress") or {}
        loaded = ProtocolComparisonState(
            comparison_id=str(data.get("comparison_id", comparison_id)),
            status="done" if data.get("status") == "done" else "failed",
            started_at=str(data.get("started_at", "")),
            finished_at=str(data.get("finished_at") or ""),
            complete=bool(data.get("complete")),
            error=data.get("error"),
            run_storage_warning=data.get("run_storage_warning"),
            progress_current=int(progress.get("current") or 0),
            progress_total=int(progress.get("total") or 0),
            current_protocol=progress.get("current_protocol"),
            current_resolver=progress.get("current_resolver"),
            last_sample_at=progress.get("last_sample_at"),
            manifest=data.get("manifest"),
            exclusions=data.get("exclusions") or [],
            subruns=data.get("subruns") or [],
            delta_pairs=data.get("delta_pairs") or [],
        )
        with self._lock:
            self._cleanup_protocol_comparison_states_locked()
            self._protocol_comparison_states[comparison_id] = loaded
        return loaded

    def _persisted_protocol_comparison_path(self, comparison_id: str) -> Path | None:
        """Contained nested path only for canonical lowercase UUIDv4 hex IDs."""
        if not is_generated_run_id(comparison_id):
            return None
        candidate = self._data_runs_dir / "protocol-comparisons" / f"{comparison_id}.json"
        try:
            if not candidate.resolve().is_relative_to(self._data_runs_dir.resolve()):
                return None
        except OSError:
            return None
        return candidate

    def _cleanup_protocol_comparison_states_locked(self) -> None:
        now_ts = datetime.now(UTC).timestamp()
        expired_ids: list[str] = []
        for comparison_id, state in self._protocol_comparison_states.items():
            if state.status not in TERMINAL_STATUSES:
                continue
            if not state.finished_at:
                continue
            try:
                finished_ts = datetime.fromisoformat(state.finished_at).timestamp()
            except ValueError:
                finished_ts = now_ts
            if now_ts - finished_ts >= self.terminal_ttl_sec:
                expired_ids.append(comparison_id)
        for comparison_id in expired_ids:
            self._protocol_comparison_states.pop(comparison_id, None)

        if len(self._protocol_comparison_states) <= self.max_retained_states:
            return
        terminal_candidates: list[tuple[float, str]] = []
        for comparison_id, state in self._protocol_comparison_states.items():
            if state.status not in TERMINAL_STATUSES:
                continue
            if state.finished_at:
                try:
                    finished_ts = datetime.fromisoformat(state.finished_at).timestamp()
                except ValueError:
                    finished_ts = 0.0
            else:
                finished_ts = 0.0
            terminal_candidates.append((finished_ts, comparison_id))
        terminal_candidates.sort()
        while len(self._protocol_comparison_states) > self.max_retained_states and terminal_candidates:
            _, comparison_id = terminal_candidates.pop(0)
            self._protocol_comparison_states.pop(comparison_id, None)

    def _set_comparison_storage_warning(self, comparison_id: str, warning: str) -> None:
        with self._lock:
            state = self._protocol_comparison_states.get(comparison_id)
            if state:
                state.run_storage_warning = warning

    def _clear_comparison_storage_warning(self, comparison_id: str) -> None:
        with self._lock:
            state = self._protocol_comparison_states.get(comparison_id)
            if state:
                state.run_storage_warning = None

    def _persist_protocol_comparison(self, comparison_id: str) -> None:
        state = self.get_protocol_comparison(comparison_id)
        if not state or state.status not in ("done", "failed"):
            return
        try:
            path = self._persisted_protocol_comparison_path(comparison_id)
            if path is None:
                return
            path.parent.mkdir(parents=True, exist_ok=True)
            self._write_json_file(
                path,
                json.dumps(state.as_response(), ensure_ascii=False, indent=2),
            )
        except OSError as exc:
            self._set_comparison_storage_warning(comparison_id, self._format_storage_warning(exc))
            return
        self._clear_comparison_storage_warning(comparison_id)

    def _update_comparison_progress(
        self,
        comparison_id: str,
        increment: int = 1,
        protocol: str | None = None,
        resolver: str | None = None,
        observed_latency_ms: float | None = None,
    ) -> None:
        with self._lock:
            state = self._protocol_comparison_states.get(comparison_id)
            if not state:
                return
            state.progress_current += increment
            if protocol:
                state.current_protocol = protocol
            if resolver:
                state.current_resolver = resolver
            sample_timestamp_ms = int(datetime.now(UTC).timestamp() * 1000)
            state.last_sample_at = max(state.last_sample_at or sample_timestamp_ms, sample_timestamp_ms)
            if observed_latency_ms is not None:
                state.observed_latency_total_ms += observed_latency_ms
                state.observed_latency_count += 1

    def _set_comparison_running(self, comparison_id: str) -> None:
        with self._lock:
            state = self._protocol_comparison_states.get(comparison_id)
            if state and state.status == "queued":
                state.status = "running"

    def _finish_protocol_comparison(self, comparison_id: str) -> None:
        with self._lock:
            state = self._protocol_comparison_states[comparison_id]
            state.status = "done"
            state.finished_at = datetime.now(UTC).isoformat()
            state.current_protocol = None
            state.current_resolver = None
            state.complete = bool(state.subruns) and all(
                subrun.get("status") == "done" for subrun in state.subruns
            )
            state.delta_pairs = _protocol_delta_pairs(state)
        self._persist_protocol_comparison(comparison_id)

    def _fail_protocol_comparison(self, comparison_id: str, message: str) -> None:
        with self._lock:
            state = self._protocol_comparison_states.get(comparison_id)
            if not state:
                return
            state.status = "failed"
            state.error = message
            state.finished_at = datetime.now(UTC).isoformat()
            state.complete = False
            state.current_protocol = None
            state.current_resolver = None
        self._persist_protocol_comparison(comparison_id)

    def _run_protocol_comparison(self, comparison_id: str, plan: ProtocolComparisonPlan) -> None:
        try:
            self._set_comparison_running(comparison_id)
            engine = select_engine()
            for protocol in plan.canonical_protocols:
                subrun = self._run_protocol_subrun(comparison_id, plan, protocol, engine)
                with self._lock:
                    state = self._protocol_comparison_states.get(comparison_id)
                    if state:
                        state.subruns.append(subrun)
                        state.current_protocol = None
            self._finish_protocol_comparison(comparison_id)
        except Exception as exc:  # noqa: BLE001
            self._fail_protocol_comparison(comparison_id, str(exc))

    def _run_protocol_subrun(
        self,
        comparison_id: str,
        plan: ProtocolComparisonPlan,
        protocol: str,
        engine: str,
    ) -> dict[str, Any]:
        results: list[dict[str, Any]] = []
        try:
            for resolver in plan.resolver_ips:
                results.append(
                    self._measure_comparison_resolver(comparison_id, plan, protocol, resolver, engine)
                )
            apply_normalized_scoring(results, goal=plan.scoring_profile)
            return {
                "protocol": protocol,
                "status": "done",
                "complete": True,
                "error": None,
                "results": results,
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "protocol": protocol,
                "status": "failed",
                "complete": False,
                "error": {"code": "transport_execution_failed", "message": str(exc)[:500]},
                "results": results,
            }

    def _measure_comparison_resolver(
        self,
        comparison_id: str,
        plan: ProtocolComparisonPlan,
        protocol: str,
        resolver: str,
        engine: str,
    ) -> dict[str, Any]:
        endpoint = plan.endpoints[resolver][protocol]
        successful_ms: list[float] = []
        samples: list[dict[str, Any]] = []

        for run_idx, domain in enumerate(plan.schedule):
            sample = self._measure_comparison_sample(
                resolver, domain, protocol, endpoint, plan.timeout_sec, engine
            )
            sample["run_index"] = run_idx + 1
            samples.append(sample)
            if sample.get("ok") and sample.get("ms") is not None:
                successful_ms.append(float(sample["ms"]))
            observed_latency = (
                float(sample["ms"]) if sample.get("ok") and sample.get("ms") is not None else None
            )
            self._update_comparison_progress(
                comparison_id,
                increment=1,
                protocol=protocol,
                resolver=resolver,
                observed_latency_ms=observed_latency,
            )

        timeout_count = sum(1 for sample in samples if sample.get("failure_kind") == "timeout")
        failure_count = sum(
            1 for sample in samples if sample.get("failure_kind") in RELIABILITY_FAILURE_KINDS
        )
        stats = compute_stats(
            successful_ms,
            total_runs=plan.effective_runs,
            timeout_count=timeout_count,
            failure_count=failure_count,
        )

        blocking_samples: list[dict[str, Any]] = []
        for domain in plan.blocking_queries:
            b_sample = self._measure_comparison_sample(
                resolver, domain, protocol, endpoint, plan.timeout_sec, engine
            )
            b_sample["run_index"] = 0
            b_sample["blocking_test"] = True
            blocking_samples.append(b_sample)
            self._update_comparison_progress(comparison_id, increment=1, protocol=protocol, resolver=resolver)
        blocking_raw = compute_blocking_efficacy(blocking_samples)
        stats["blocking_efficacy"] = blocking_raw["blocking_efficacy"]
        stats["blocked_count"] = blocking_raw["blocked_count"]
        stats["blocking_test_count"] = blocking_raw["blocking_test_count"]

        hijack_sample = self._measure_comparison_sample(
            resolver, plan.diagnostic_domain, protocol, endpoint, plan.timeout_sec, engine
        )
        hijack_detected: bool | None = None
        if hijack_sample.get("ok") and hijack_sample.get("answer_ips"):
            hijack_detected = True
        elif hijack_sample.get("failure_kind") == "nxdomain":
            hijack_detected = False
        stats["nxdomain_hijack_detected"] = hijack_detected
        self._update_comparison_progress(comparison_id, increment=1, protocol=protocol, resolver=resolver)

        dnssec_sample = self._measure_comparison_sample(
            resolver, "badsig.go.dnscheck.tools", protocol, endpoint, plan.timeout_sec, engine
        )
        dnssec_validating: bool | None = None
        if dnssec_sample.get("failure_kind") == "servfail":
            dnssec_validating = True
        elif dnssec_sample.get("ok"):
            dnssec_validating = False
        stats["dnssec_validating"] = dnssec_validating
        self._update_comparison_progress(comparison_id, increment=1, protocol=protocol, resolver=resolver)

        provider = self.provider_index.get(
            resolver,
            {
                "id": "isp-detectado",
                "name": "ISP (Detectado)",
                "notes_es": "Resolver detectado desde el sistema local.",
            },
        )
        return {
            "resolver": resolver,
            "provider_id": provider.get("id", "desconocido"),
            "provider_name": provider.get("name", "Desconocido"),
            "engine": engine,
            "protocol": protocol,
            "stats": stats,
            "samples": samples,
        }

    def _measure_comparison_sample(
        self,
        resolver: str,
        domain: str,
        protocol: str,
        endpoint: str,
        timeout_sec: float,
        engine: str,
    ) -> dict[str, Any]:
        if protocol == "dot":
            return run_dot_query(resolver, domain, timeout_sec, endpoint)
        if protocol == "doh":
            return run_doh_query(resolver, domain, timeout_sec, endpoint)
        if protocol == "doq":
            return run_doq_query(resolver, domain, timeout_sec, endpoint)
        return measure_query(resolver=resolver, domain=domain, timeout_sec=timeout_sec, engine=engine)

    def compare_runs(self, baseline_id: str, candidate_id: str) -> RunComparisonResponse | None:
        """Compare two persisted runs under the immutable manifest contract.

        Returns None when either run cannot be read (route maps it to 404) and
        raises ValueError when a run exists but is not ``done`` (route maps it
        to 409). Every readable ``done`` pair produces a typed response, even
        when the pair is not comparable.
        """
        baseline = self.get(baseline_id)
        if baseline is None:
            return None
        candidate = self.get(candidate_id)
        if candidate is None:
            return None
        if baseline.get("status") != "done" or candidate.get("status") != "done":
            raise ValueError("benchmark aún en ejecución")
        return self._build_comparison(baseline, candidate)

    def _build_comparison(self, baseline: dict[str, Any], candidate: dict[str, Any]) -> RunComparisonResponse:
        baseline_manifest, baseline_reason = _extract_manifest(baseline)
        candidate_manifest, candidate_reason = _extract_manifest(candidate)

        reason_codes: list[ComparisonReasonCode] = []
        if baseline_reason is not None:
            reason_codes.append(baseline_reason)
        if candidate_reason is not None:
            reason_codes.append(candidate_reason)

        if baseline_manifest is not None and candidate_manifest is not None:
            reason_codes.extend(_manifest_mismatch_reason_codes(baseline_manifest, candidate_manifest))

        reason_codes.sort(key=COMPARISON_REASON_ORDER.index)
        comparable = baseline_manifest is not None and candidate_manifest is not None and not reason_codes

        if not comparable:
            return RunComparisonResponse(
                baseline_id=str(baseline.get("id", "")),
                candidate_id=str(candidate.get("id", "")),
                baseline_manifest=baseline_manifest,
                candidate_manifest=candidate_manifest,
                comparable=False,
                reason_codes=reason_codes,
                rows=[],
                missing_baseline_results=[],
                missing_candidate_results=[],
            )

        baseline_results = {str(item.get("resolver", "")): item for item in (baseline.get("results") or [])}
        candidate_results = {str(item.get("resolver", "")): item for item in (candidate.get("results") or [])}
        baseline_ranks = _ranked_resolvers(baseline)
        candidate_ranks = _ranked_resolvers(candidate)

        common_resolvers = sorted(set(baseline_results) & set(candidate_results))
        missing_baseline_results = sorted(set(candidate_results) - set(baseline_results))
        missing_candidate_results = sorted(set(baseline_results) - set(candidate_results))

        rows = [
            RunComparisonRow(
                resolver=resolver,
                baseline=_comparison_metrics(baseline_results[resolver]),
                candidate=_comparison_metrics(candidate_results[resolver]),
                baseline_rank=baseline_ranks[resolver],
                candidate_rank=candidate_ranks[resolver],
                deltas=_comparison_deltas(
                    baseline_results[resolver].get("stats") or {},
                    candidate_results[resolver].get("stats") or {},
                    baseline_rank=baseline_ranks[resolver],
                    candidate_rank=candidate_ranks[resolver],
                ),
            )
            for resolver in common_resolvers
        ]

        return RunComparisonResponse(
            baseline_id=str(baseline.get("id", "")),
            candidate_id=str(candidate.get("id", "")),
            baseline_manifest=baseline_manifest,
            candidate_manifest=candidate_manifest,
            comparable=True,
            reason_codes=[],
            rows=rows,
            missing_baseline_results=missing_baseline_results,
            missing_candidate_results=missing_candidate_results,
        )

    def _cleanup_terminal_states(self) -> None:
        with self._lock:
            self._cleanup_terminal_states_locked()

    def _cleanup_terminal_states_locked(self) -> None:
        now_ts = datetime.now(UTC).timestamp()
        expired_ids: list[str] = []
        for benchmark_id, state in self._states.items():
            if state.status not in TERMINAL_STATUSES:
                continue
            if not state.finished_at:
                continue
            try:
                finished_ts = datetime.fromisoformat(state.finished_at).timestamp()
            except ValueError:
                finished_ts = now_ts
            if now_ts - finished_ts >= self.terminal_ttl_sec:
                expired_ids.append(benchmark_id)

        for benchmark_id in expired_ids:
            self._states.pop(benchmark_id, None)

        if len(self._states) <= self.max_retained_states:
            return

        terminal_candidates: list[tuple[float, str]] = []
        for benchmark_id, state in self._states.items():
            if state.status not in TERMINAL_STATUSES:
                continue
            if state.finished_at:
                try:
                    finished_ts = datetime.fromisoformat(state.finished_at).timestamp()
                except ValueError:
                    finished_ts = 0.0
            else:
                finished_ts = 0.0
            terminal_candidates.append((finished_ts, benchmark_id))

        terminal_candidates.sort()
        while len(self._states) > self.max_retained_states and terminal_candidates:
            _, benchmark_id = terminal_candidates.pop(0)
            self._states.pop(benchmark_id, None)

    def _update_progress(
        self,
        benchmark_id: str,
        increment: int = 1,
        resolver: str | None = None,
        observed_latency_ms: float | None = None,
    ) -> None:
        with self._lock:
            state = self._states[benchmark_id]
            state.progress_current += increment
            if resolver:
                state.current_resolver = resolver
            sample_timestamp_ms = int(datetime.now(UTC).timestamp() * 1000)
            state.last_sample_at = max(state.last_sample_at or sample_timestamp_ms, sample_timestamp_ms)
            if observed_latency_ms is not None:
                state.observed_latency_total_ms += observed_latency_ms
                state.observed_latency_count += 1

    def _set_running(self, benchmark_id: str) -> None:
        with self._lock:
            state = self._states.get(benchmark_id)
            if not state:
                return
            if state.status == "cancelled":
                return
            state.status = "running"

    def _set_done(self, benchmark_id: str, engine: str, results: list[dict[str, Any]]) -> None:
        state = self.get_state(benchmark_id)
        apply_normalized_scoring(results, goal=state.scoring_profile if state else None)
        ranked_results = sorted(results, key=_resolver_rank_key)
        with self._lock:
            state = self._states[benchmark_id]
            state.status = "done"
            state.finished_at = datetime.now(UTC).isoformat()
            state.results = ranked_results
            state.engine = engine
            state.current_resolver = None
            state_snapshot = state.as_response(include_samples=False)
            samples_snapshot = state.as_response(include_samples=True) if self.persist_samples else None
        self._persist_run_payload(benchmark_id, state_snapshot, samples_snapshot)

    def _append_partial_result(self, benchmark_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            state = self._states[benchmark_id]
            if state.results is None:
                state.results = []
            state.results.append(result)
            apply_normalized_scoring(state.results, goal=state.scoring_profile)
            state.results.sort(key=_resolver_rank_key)

    def _set_failed(self, benchmark_id: str, message: str) -> None:
        with self._lock:
            state = self._states[benchmark_id]
            state.status = "failed"
            state.error = message
            state.finished_at = datetime.now(UTC).isoformat()
            state.current_resolver = None
            state_snapshot = state.as_response(include_samples=False)
        self._persist_run_payload(benchmark_id, state_snapshot)

    def _format_storage_warning(self, exc: OSError) -> str:
        detail = str(exc).strip()
        if detail:
            detail = detail[:180]
            return f"Persistence warning: {exc.__class__.__name__}: {detail}"
        return f"Persistence warning: {exc.__class__.__name__}"

    def _set_storage_warning(self, benchmark_id: str, warning: str) -> None:
        with self._lock:
            state = self._states.get(benchmark_id)
            if not state:
                return
            state.run_storage_warning = warning

    def _clear_storage_warning(self, benchmark_id: str) -> None:
        with self._lock:
            state = self._states.get(benchmark_id)
            if not state:
                return
            state.run_storage_warning = None

    def _write_json_file(self, path: Path, payload: str) -> None:
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)

    def _persist_run(self, benchmark_id: str) -> None:
        state = self.get_state(benchmark_id)
        if not state:
            return
        samples_snapshot = (
            state.as_response(include_samples=True)
            if self.persist_samples and state.status == "done"
            else None
        )
        self._persist_run_payload(
            benchmark_id,
            state.as_response(include_samples=False),
            samples_snapshot,
        )

    def _persist_run_payload(
        self,
        benchmark_id: str,
        state_snapshot: dict[str, Any],
        samples_snapshot: dict[str, Any] | None = None,
    ) -> None:
        try:
            self._data_runs_dir.mkdir(parents=True, exist_ok=True)

            metadata_path = self._data_runs_dir / f"{benchmark_id}.json"
            self._write_json_file(
                metadata_path,
                json.dumps(state_snapshot, ensure_ascii=False, indent=2),
            )

            summary_path = self._data_runs_dir / f"{benchmark_id}.summary.json"
            self._write_json_file(
                summary_path,
                json.dumps(_build_history_summary(state_snapshot), ensure_ascii=False, indent=2),
            )

            if samples_snapshot is not None:
                samples_path = self._data_runs_dir / f"{benchmark_id}.samples.json"
                self._write_json_file(
                    samples_path,
                    json.dumps(samples_snapshot, ensure_ascii=False, indent=2),
                )
        except OSError as exc:
            self._set_storage_warning(benchmark_id, self._format_storage_warning(exc))
            return

        self._clear_storage_warning(benchmark_id)

    def _resolver_supports_protocol(self, resolver_ip: str, protocol: str) -> bool:
        endpoint, _ = _resolver_protocol_endpoint(resolver_ip, protocol, self.provider_index)
        return endpoint is not None

    def _measure_with_protocol(
        self,
        resolver: str,
        domain: str,
        config: BenchmarkConfig,
        engine: str,
    ) -> dict[str, Any]:
        if config.protocol == "dot":
            provider_data = self.provider_index.get(resolver, {})
            features = provider_data.get("features") or {}
            dot_hostname = features.get("dot_hostname")
            return run_dot_query(resolver, domain, config.timeout_sec, dot_hostname)
        if config.protocol == "doh":
            provider_data = self.provider_index.get(resolver, {})
            features = provider_data.get("features") or {}
            doh_url = features.get("doh_url")
            return run_doh_query(resolver, domain, config.timeout_sec, doh_url)
        if config.protocol == "doq":
            provider_data = self.provider_index.get(resolver, {})
            features = provider_data.get("features") or {}
            doq_hostname = features.get("doq_hostname")
            return run_doq_query(resolver, domain, config.timeout_sec, doq_hostname)
        return measure_query(resolver=resolver, domain=domain, timeout_sec=config.timeout_sec, engine=engine)

    def _run(self, benchmark_id: str, config: BenchmarkConfig) -> None:
        try:
            self._set_running(benchmark_id)
            engine = select_engine()
            results: list[dict[str, Any]] = []
            query_schedule = [config.queries[run_idx % len(config.queries)] for run_idx in range(config.runs)]

            for resolver in config.resolvers:
                successful_ms: list[float] = []
                samples: list[dict[str, Any]] = []

                for run_idx, domain in enumerate(query_schedule):
                    sample = self._measure_with_protocol(
                        resolver=resolver,
                        domain=domain,
                        config=config,
                        engine=engine,
                    )
                    sample["run_index"] = run_idx + 1
                    samples.append(sample)
                    if sample["ok"] and sample["ms"] is not None:
                        successful_ms.append(float(sample["ms"]))
                    observed_latency = (
                        float(sample["ms"]) if sample["ok"] and sample["ms"] is not None else None
                    )
                    self._update_progress(
                        benchmark_id,
                        increment=1,
                        resolver=resolver,
                        observed_latency_ms=observed_latency,
                    )

                timeout_count = sum(1 for sample in samples if sample.get("failure_kind") == "timeout")
                failure_count = sum(
                    1 for sample in samples if sample.get("failure_kind") in RELIABILITY_FAILURE_KINDS
                )
                stats = compute_stats(
                    successful_ms,
                    total_runs=config.runs,
                    timeout_count=timeout_count,
                    failure_count=failure_count,
                )
                provider = self.provider_index.get(
                    resolver,
                    {
                        "id": "isp-detectado",
                        "name": "ISP (Detectado)",
                        "notes_es": "Resolver detectado desde el sistema local.",
                    },
                )
                resolver_result = {
                    "resolver": resolver,
                    "provider_id": provider.get("id", "desconocido"),
                    "provider_name": provider.get("name", "Desconocido"),
                    "engine": engine,
                    "protocol": config.protocol,
                    "stats": stats,
                    "samples": samples,
                }
                results.append(resolver_result)
                self._append_partial_result(benchmark_id, resolver_result)

                # Blocking efficacy test
                blocking_samples: list[dict[str, Any]] = []
                for domain in self.blocking_test_queries:
                    b_sample = self._measure_with_protocol(
                        resolver=resolver,
                        domain=domain,
                        config=config,
                        engine=engine,
                    )
                    b_sample["run_index"] = 0
                    b_sample["blocking_test"] = True
                    blocking_samples.append(b_sample)
                    self._update_progress(
                        benchmark_id,
                        increment=1,
                        resolver=resolver,
                    )

                blocking_raw = compute_blocking_efficacy(blocking_samples)
                stats["blocking_efficacy"] = blocking_raw["blocking_efficacy"]
                stats["blocked_count"] = blocking_raw["blocked_count"]
                stats["blocking_test_count"] = blocking_raw["blocking_test_count"]

                # NXDOMAIN hijacking detection
                hijack_suffix = "".join(random.choices(string.ascii_lowercase, k=8))  # nosec B311
                hijack_domain = f"nxdomain-check-{hijack_suffix}.invalid"
                hijack_sample = self._measure_with_protocol(
                    resolver=resolver,
                    domain=hijack_domain,
                    config=config,
                    engine=engine,
                )
                hijack_detected: bool | None = None
                if hijack_sample.get("ok") and hijack_sample.get("answer_ips"):
                    # Got a valid A record for a guaranteed-nonexistent domain
                    hijack_detected = True
                elif hijack_sample.get("failure_kind") == "nxdomain":
                    hijack_detected = False
                stats["nxdomain_hijack_detected"] = hijack_detected
                self._update_progress(
                    benchmark_id,
                    increment=1,
                    resolver=resolver,
                )

                # DNSSEC validation check
                dnssec_domain = "badsig.go.dnscheck.tools"
                dnssec_sample = self._measure_with_protocol(
                    resolver=resolver,
                    domain=dnssec_domain,
                    config=config,
                    engine=engine,
                )
                dnssec_validating: bool | None = None
                if dnssec_sample.get("failure_kind") == "servfail":
                    # SERVFAIL for a known-bad DNSSEC signature → resolver validates
                    dnssec_validating = True
                elif dnssec_sample.get("ok"):
                    # Got an answer when should have failed → not validating
                    dnssec_validating = False
                stats["dnssec_validating"] = dnssec_validating
                self._update_progress(
                    benchmark_id,
                    increment=1,
                    resolver=resolver,
                )

            self._set_done(benchmark_id, engine=engine, results=results)
        except Exception as exc:  # noqa: BLE001
            self._set_failed(benchmark_id, str(exc))


def select_engine() -> str:
    if platform.system().lower().startswith("win"):
        return "dnspython"
    if shutil.which("drill"):
        return "drill"
    return "dnspython"


def run_drill_query(resolver: str, domain: str, timeout_sec: float) -> dict[str, Any]:
    cmd = ["drill", f"@{resolver}", domain, "A"]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec + 0.6,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": "timeout",
            "failure_kind": "timeout",
        }
    except FileNotFoundError:
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": "drill no disponible",
            "failure_kind": "other",
        }

    combined = f"{proc.stdout}\n{proc.stderr}"
    query_time_ms = parse_drill_query_time(combined)
    if query_time_ms is None:
        failure_kind = classify_failure_from_text(combined)
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": "sin Query time",
            "failure_kind": failure_kind,
        }

    rcode_match = DRILL_RCODE_RE.search(proc.stdout)
    if rcode_match:
        rcode = rcode_match.group(1)
        rcode_kind = _rcode_to_failure_kind(rcode)
        if rcode_kind is not None:
            return {
                "ok": False,
                "ms": None,
                "query": domain,
                "error": f"DNS RCODE: {rcode}",
                "failure_kind": rcode_kind,
            }

    answer_ips = DRILL_ANSWER_RE.findall(proc.stdout)
    return {
        "ok": True,
        "ms": round(float(query_time_ms), 3),
        "query": domain,
        "error": None,
        "failure_kind": None,
        "answer_ips": answer_ips,
    }


def run_dnspython_query(resolver: str, domain: str, timeout_sec: float) -> dict[str, Any]:
    dnsr = dns.resolver.Resolver(configure=False)
    dnsr.nameservers = [resolver]
    dnsr.lifetime = timeout_sec
    dnsr.timeout = timeout_sec
    start = perf_counter()
    try:
        answers = dnsr.resolve(domain, "A")
        elapsed_ms = (perf_counter() - start) * 1000.0
        answer_ips = [rr.to_text() for rr in answers]
        return {
            "ok": True,
            "ms": round(elapsed_ms, 3),
            "query": domain,
            "error": None,
            "failure_kind": None,
            "answer_ips": answer_ips,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": str(exc),
            "failure_kind": classify_dnspython_exception(exc),
        }


def run_dot_query(resolver: str, domain: str, timeout_sec: float, dot_hostname: str | None) -> dict[str, Any]:
    hostname = dot_hostname or resolver
    q = dns.message.make_query(domain, "A")
    start = perf_counter()
    try:
        response = dns.query.tls(q, resolver, timeout=timeout_sec, server_hostname=hostname)
        elapsed_ms = (perf_counter() - start) * 1000.0
        rcode = dns.rcode.to_text(response.rcode())
        failure_kind = _rcode_to_failure_kind(rcode)
        if failure_kind is not None:
            return {
                "ok": False,
                "ms": None,
                "query": domain,
                "error": f"DNS RCODE: {rcode}",
                "failure_kind": failure_kind,
            }
        answer_ips = [
            str(rr.address) for ans in response.answer for rr in ans if rr.rdtype == dns.rdatatype.A
        ]
        return {
            "ok": True,
            "ms": round(elapsed_ms, 3),
            "query": domain,
            "error": None,
            "failure_kind": None,
            "answer_ips": answer_ips,
        }
    except Exception as exc:  # noqa: BLE001
        fkind = classify_dnspython_exception(exc) if isinstance(exc, dns.exception.DNSException) else "other"
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": str(exc),
            "failure_kind": fkind,
        }


def run_doh_query(resolver: str, domain: str, timeout_sec: float, doh_url: str | None) -> dict[str, Any]:
    if not doh_url:
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": "No DoH URL configured for this resolver",
            "failure_kind": "other",
        }
    q = dns.message.make_query(domain, "A")
    start = perf_counter()
    try:
        response = dns.query.https(q, doh_url, timeout=timeout_sec)
        elapsed_ms = (perf_counter() - start) * 1000.0
        rcode = dns.rcode.to_text(response.rcode())
        failure_kind = _rcode_to_failure_kind(rcode)
        if failure_kind is not None:
            return {
                "ok": False,
                "ms": None,
                "query": domain,
                "error": f"DNS RCODE: {rcode}",
                "failure_kind": failure_kind,
            }
        answer_ips = [
            str(rr.address) for ans in response.answer for rr in ans if rr.rdtype == dns.rdatatype.A
        ]
        return {
            "ok": True,
            "ms": round(elapsed_ms, 3),
            "query": domain,
            "error": None,
            "failure_kind": None,
            "answer_ips": answer_ips,
        }
    except Exception as exc:  # noqa: BLE001
        fkind = classify_dnspython_exception(exc) if isinstance(exc, dns.exception.DNSException) else "other"
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": str(exc),
            "failure_kind": fkind,
        }


def run_doq_query(resolver: str, domain: str, timeout_sec: float, doq_hostname: str | None) -> dict[str, Any]:
    if not dns_quic_available():
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": "DoQ no disponible en esta instalación (falta aioquic).",
            "failure_kind": "doq_unavailable",
        }
    q = dns.message.make_query(domain, "A")
    hostname = doq_hostname or resolver
    start = perf_counter()
    try:
        response = dns.query.quic(q, resolver, timeout=timeout_sec, port=853, server_hostname=hostname)
        elapsed_ms = (perf_counter() - start) * 1000.0
        rcode = dns.rcode.to_text(response.rcode())
        failure_kind = _rcode_to_failure_kind(rcode)
        if failure_kind is not None:
            return {
                "ok": False,
                "ms": None,
                "query": domain,
                "error": f"DNS RCODE: {rcode}",
                "failure_kind": failure_kind,
            }
        answer_ips = [
            str(rr.address)
            for ans in response.answer
            for rr in ans
            if rr.rdtype in (dns.rdatatype.A, dns.rdatatype.AAAA)
        ]
        return {
            "ok": True,
            "ms": round(elapsed_ms, 3),
            "query": domain,
            "error": None,
            "failure_kind": None,
            "answer_ips": answer_ips,
        }
    except dns.exception.Timeout:
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": "timeout",
            "failure_kind": "timeout",
        }
    except dns.query.NoDOQ:
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": "DoQ no disponible en esta instalación (falta aioquic).",
            "failure_kind": "doq_unavailable",
        }
    except Exception as exc:  # noqa: BLE001
        fkind = classify_dnspython_exception(exc) if isinstance(exc, dns.exception.DNSException) else "other"
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": str(exc),
            "failure_kind": fkind,
        }


def measure_query(resolver: str, domain: str, timeout_sec: float, engine: str) -> dict[str, Any]:
    if engine == "drill":
        sample = run_drill_query(resolver=resolver, domain=domain, timeout_sec=timeout_sec)
    else:
        sample = run_dnspython_query(resolver=resolver, domain=domain, timeout_sec=timeout_sec)
    sample["resolver"] = resolver
    return sample
