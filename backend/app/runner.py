from __future__ import annotations

import json
import os
import platform
import re
import shutil
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
import dns.resolver
from platformdirs import user_data_path

from .detect_dns import detect_system_dns
from .models import BenchmarkRequest, ProbeRequest
from .providers import build_default_resolvers, load_default_queries, load_providers, resolver_provider_index
from .stats import (
    apply_normalized_scoring,
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
    timeout_sec: float = 2.0
    runs: int = 30
    engine: str | None = None
    error: str | None = None
    results: list[dict[str, Any]] | None = None
    run_storage_warning: str | None = None

    def as_response(self, include_samples: bool = False) -> dict[str, Any]:
        sanitized_results = _sanitize_results(self.results, include_samples=include_samples)
        recommended_resolver, recommendation_warning = select_recommended_resolver(sanitized_results or [])
        return {
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
            "timeout_sec": self.timeout_sec,
            "runs": self.runs,
            "engine": self.engine,
            "error": self.error,
            "run_storage_warning": self.run_storage_warning,
            "results": sanitized_results,
            "recommended_resolver": recommended_resolver,
            "recommendation_warning": recommendation_warning,
        }


@dataclass
class BenchmarkConfig:
    resolvers: list[str]
    queries: list[str]
    runs: int
    timeout_sec: float
    mode: str


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

        if req.resolvers:
            resolvers = req.resolvers
        else:
            system_dns = self.system_dns_payload().get("resolvers", [])
            resolvers = list(dict.fromkeys(self.default_resolvers + system_dns))

        if not resolvers:
            raise ValueError("No hay resolvers disponibles")

        return BenchmarkConfig(
            resolvers=resolvers,
            queries=queries,
            runs=runs,
            timeout_sec=timeout_sec,
            mode=req.mode.value,
        )

    def start(self, req: BenchmarkRequest) -> str:
        config = self._build_config(req)
        benchmark_id = uuid.uuid4().hex
        state = BenchmarkState(
            id=benchmark_id,
            status="queued",
            started_at=datetime.now(UTC).isoformat(),
            last_sample_at=int(datetime.now(UTC).timestamp() * 1000),
            progress_total=len(config.resolvers) * config.runs,
            mode=config.mode,
            timeout_sec=config.timeout_sec,
            runs=config.runs,
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
            if not state:
                return None
            return state.as_response(include_samples=include_samples)

    def get_state(self, benchmark_id: str) -> BenchmarkState | None:
        with self._lock:
            self._cleanup_terminal_states_locked()
            return self._states.get(benchmark_id)

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
        apply_normalized_scoring(results)
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
            apply_normalized_scoring(state.results)
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
                    sample = measure_query(
                        resolver=resolver,
                        domain=domain,
                        timeout_sec=config.timeout_sec,
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
                    "stats": stats,
                    "samples": samples,
                }
                results.append(resolver_result)
                self._append_partial_result(benchmark_id, resolver_result)

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

    return {
        "ok": True,
        "ms": round(float(query_time_ms), 3),
        "query": domain,
        "error": None,
        "failure_kind": None,
    }


def run_dnspython_query(resolver: str, domain: str, timeout_sec: float) -> dict[str, Any]:
    dnsr = dns.resolver.Resolver(configure=False)
    dnsr.nameservers = [resolver]
    dnsr.lifetime = timeout_sec
    dnsr.timeout = timeout_sec
    start = perf_counter()
    try:
        dnsr.resolve(domain, "A")
        elapsed_ms = (perf_counter() - start) * 1000.0
        return {
            "ok": True,
            "ms": round(elapsed_ms, 3),
            "query": domain,
            "error": None,
            "failure_kind": None,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": str(exc),
            "failure_kind": classify_dnspython_exception(exc),
        }


def measure_query(resolver: str, domain: str, timeout_sec: float, engine: str) -> dict[str, Any]:
    if engine == "drill":
        sample = run_drill_query(resolver=resolver, domain=domain, timeout_sec=timeout_sec)
    else:
        sample = run_dnspython_query(resolver=resolver, domain=domain, timeout_sec=timeout_sec)
    sample["resolver"] = resolver
    return sample
