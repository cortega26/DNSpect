from __future__ import annotations

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
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

import dns.exception
import dns.message
import dns.query
import dns.rcode
import dns.resolver
from platformdirs import user_data_path

from .detect_dns import detect_system_dns
from .models import BenchmarkRequest, ProbeRequest
from .providers import (
    build_default_resolvers,
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

TERMINAL_STATUSES = {"done", "failed", "cancelled"}


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


class BenchmarkManager:
    def __init__(
        self,
        *,
        max_concurrent_jobs: int | None = None,
        max_queued_jobs: int | None = None,
        terminal_ttl_sec: int | None = None,
        max_retained_states: int | None = None,
        data_runs_dir: Path | None = None,
    ) -> None:
        self._lock = threading.RLock()
        self._states: dict[str, BenchmarkState] = {}
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

    def providers_payload(self) -> list[dict[str, Any]]:
        return self.providers

    def system_dns_payload(self) -> dict[str, Any]:
        payload = detect_system_dns()
        payload["detected_provider_id"] = "isp-detectado"
        return payload

    def _build_config(self, req: BenchmarkRequest) -> BenchmarkConfig:
        runs = req.effective_runs()
        timeout_sec = float(req.timeout_sec)
        queries = req.queries or self.default_queries
        if not queries:
            raise ValueError("No hay dominios para consultar")

        protocol = req.protocol.value

        if req.resolvers:
            resolvers = req.resolvers
        else:
            system_dns = self.system_dns_payload().get("resolvers", [])
            resolvers = list(dict.fromkeys(self.default_resolvers + system_dns))

        resolvers = [r for r in resolvers if self._resolver_supports_protocol(r, protocol)]

        if not resolvers:
            raise ValueError("No hay resolvers disponibles para el protocolo seleccionado")

        scoring_profile = req.effective_scoring_profile()
        target_snapshot_dict: dict[str, object] | None = None
        if req.target_snapshot is not None:
            target_snapshot_dict = req.target_snapshot.model_dump()

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
        )

    def start(self, req: BenchmarkRequest) -> str:
        config = self._build_config(req)
        benchmark_id = uuid.uuid4().hex
        blocking_total = len(config.resolvers) * len(self.blocking_test_queries)
        state = BenchmarkState(
            id=benchmark_id,
            status="queued",
            started_at=datetime.now(UTC).isoformat(),
            last_sample_at=int(datetime.now(UTC).timestamp() * 1000),
            progress_total=len(config.resolvers) * config.runs + blocking_total,
            mode=config.mode,
            goal=config.goal,
            scoring_profile=config.scoring_profile,
            protocol=config.protocol,
            timeout_sec=config.timeout_sec,
            runs=config.runs,
            target_snapshot=config.target_snapshot,
        )
        with self._lock:
            self._cleanup_terminal_states_locked()
            running_count = sum(1 for item in self._states.values() if item.status == "running")
            queued_count = sum(1 for item in self._states.values() if item.status == "queued")
            if running_count + queued_count >= (self.max_concurrent_jobs + self.max_queued_jobs):
                raise ValueError("Capacidad de benchmark agotada. Intenta nuevamente en unos minutos.")
            self._states[benchmark_id] = state
        self._persist_run(benchmark_id)
        try:
            self._executor.submit(self._run, benchmark_id, config)
        except RuntimeError as exc:
            with self._lock:
                self._states.pop(benchmark_id, None)
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

    def get(self, benchmark_id: str, include_samples: bool = False) -> dict[str, Any] | None:
        with self._lock:
            self._cleanup_terminal_states_locked()
            state = self._states.get(benchmark_id)
            if state:
                return state.as_response(include_samples=include_samples)

        # Fallback: load from disk
        result_path = self._data_runs_dir / f"{benchmark_id}.json"
        if not result_path.exists():
            return None
        try:
            data: dict[str, Any] = json.loads(result_path.read_text(encoding="utf-8"))
            return data
        except (json.JSONDecodeError, OSError):
            return None

    def get_state(self, benchmark_id: str) -> BenchmarkState | None:
        with self._lock:
            self._cleanup_terminal_states_locked()
            return self._states.get(benchmark_id)

    def list_history(self) -> dict[str, list[dict[str, Any]]]:
        runs: list[dict[str, Any]] = []
        if not self._data_runs_dir.exists():
            return {"runs": runs}
        run_files = sorted(self._data_runs_dir.glob("[!.]*.json"), reverse=True)
        for path in run_files:
            if path.name.endswith(".samples.json"):
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                results = data.get("results") or []
                runs.append(
                    {
                        "id": path.stem,
                        "mode": data.get("mode"),
                        "goal": data.get("goal"),
                        "protocol": data.get("protocol"),
                        "started_at": data.get("started_at"),
                        "finished_at": data.get("finished_at"),
                        "status": data.get("status"),
                        "results_summary": [
                            {"provider_name": r.get("provider_name"), "resolver": r.get("resolver")}
                            for r in results[:3]
                        ],
                    }
                )
            except (json.JSONDecodeError, OSError):
                continue
            if len(runs) >= 50:
                break
        return {"runs": runs}

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
        self._persist_run(benchmark_id)

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
        self._persist_run(benchmark_id)

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
        path.write_text(payload, encoding="utf-8")

    def _persist_run(self, benchmark_id: str) -> None:
        state = self.get_state(benchmark_id)
        if not state:
            return

        try:
            self._data_runs_dir.mkdir(parents=True, exist_ok=True)

            metadata_path = self._data_runs_dir / f"{benchmark_id}.json"
            self._write_json_file(
                metadata_path,
                json.dumps(state.as_response(include_samples=False), ensure_ascii=False, indent=2),
            )

            if self.persist_samples and state.status == "done":
                samples_path = self._data_runs_dir / f"{benchmark_id}.samples.json"
                self._write_json_file(
                    samples_path,
                    json.dumps(state.as_response(include_samples=True), ensure_ascii=False, indent=2),
                )
        except OSError as exc:
            self._set_storage_warning(benchmark_id, self._format_storage_warning(exc))
            return

        self._clear_storage_warning(benchmark_id)

    def _resolver_supports_protocol(self, resolver_ip: str, protocol: str) -> bool:
        if protocol == "udp":
            return True
        provider = self.provider_index.get(resolver_ip)
        if not provider:
            return False
        features = provider.get("features") or {}
        if protocol == "dot":
            return bool(features.get("dot_hostname") or features.get("dot") == "yes")
        if protocol == "doh":
            return bool(features.get("doh_url"))
        return False

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


def measure_query(resolver: str, domain: str, timeout_sec: float, engine: str) -> dict[str, Any]:
    if engine == "drill":
        sample = run_drill_query(resolver=resolver, domain=domain, timeout_sec=timeout_sec)
    else:
        sample = run_dnspython_query(resolver=resolver, domain=domain, timeout_sec=timeout_sec)
    sample["resolver"] = resolver
    return sample
