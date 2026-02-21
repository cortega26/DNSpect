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
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

import dns.exception
import dns.resolver

from .detect_dns import detect_system_dns
from .models import BenchmarkRequest
from .providers import build_default_resolvers, load_default_queries, load_providers, resolver_provider_index
from .stats import compute_stats, parse_drill_query_time

DATA_RUNS = Path(__file__).resolve().parents[1] / "data" / "runs"
DATA_RUNS.mkdir(parents=True, exist_ok=True)

DRILL_RCODE_RE = re.compile(r"rcode:\s*([A-Z]+)", re.IGNORECASE)


@dataclass
class BenchmarkState:
    id: str
    status: str
    started_at: str
    finished_at: str | None = None
    progress_current: int = 0
    progress_total: int = 0
    current_resolver: str | None = None
    mode: str = "standard"
    timeout_sec: float = 2.0
    runs: int = 30
    engine: str | None = None
    error: str | None = None
    results: list[dict[str, Any]] | None = None

    def as_response(self, include_samples: bool = False) -> dict[str, Any]:
        sanitized_results: list[dict[str, Any]] | None = None
        if self.status == "done":
            sanitized_results = _sanitize_results(self.results, include_samples=include_samples)
        return {
            "id": self.id,
            "status": self.status,
            "progress": {
                "current": self.progress_current,
                "total": self.progress_total,
                "current_resolver": self.current_resolver,
            },
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "mode": self.mode,
            "timeout_sec": self.timeout_sec,
            "runs": self.runs,
            "engine": self.engine,
            "error": self.error,
            "results": sanitized_results,
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
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._states: dict[str, BenchmarkState] = {}
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="dnsbench")
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
            status="running",
            started_at=datetime.now(UTC).isoformat(),
            progress_total=len(config.resolvers) * config.runs,
            mode=config.mode,
            timeout_sec=config.timeout_sec,
            runs=config.runs,
        )
        with self._lock:
            self._states[benchmark_id] = state
        self._persist_run(benchmark_id)
        self._executor.submit(self._run, benchmark_id, config)
        return benchmark_id

    def get(self, benchmark_id: str, include_samples: bool = False) -> dict[str, Any] | None:
        with self._lock:
            state = self._states.get(benchmark_id)
            if not state:
                return None
            return state.as_response(include_samples=include_samples)

    def get_state(self, benchmark_id: str) -> BenchmarkState | None:
        with self._lock:
            return self._states.get(benchmark_id)

    def _update_progress(self, benchmark_id: str, increment: int = 1, resolver: str | None = None) -> None:
        with self._lock:
            state = self._states[benchmark_id]
            state.progress_current += increment
            if resolver:
                state.current_resolver = resolver

    def _set_done(self, benchmark_id: str, engine: str, results: list[dict[str, Any]]) -> None:
        with self._lock:
            state = self._states[benchmark_id]
            state.status = "done"
            state.finished_at = datetime.now(UTC).isoformat()
            state.results = results
            state.engine = engine
            state.current_resolver = None
        self._persist_run(benchmark_id)

    def _set_error(self, benchmark_id: str, message: str) -> None:
        with self._lock:
            state = self._states[benchmark_id]
            state.status = "error"
            state.error = message
            state.finished_at = datetime.now(UTC).isoformat()
            state.current_resolver = None
        self._persist_run(benchmark_id)

    def _persist_run(self, benchmark_id: str) -> None:
        state = self.get_state(benchmark_id)
        if not state:
            return

        metadata_path = DATA_RUNS / f"{benchmark_id}.json"
        metadata_path.write_text(
            json.dumps(state.as_response(include_samples=False), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        if self.persist_samples and state.status == "done":
            samples_path = DATA_RUNS / f"{benchmark_id}.samples.json"
            samples_path.write_text(
                json.dumps(state.as_response(include_samples=True), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def _run(self, benchmark_id: str, config: BenchmarkConfig) -> None:
        try:
            engine = select_engine()
            results: list[dict[str, Any]] = []

            for resolver_idx, resolver in enumerate(config.resolvers):
                successful_ms: list[float] = []
                samples: list[dict[str, Any]] = []

                for run_idx in range(config.runs):
                    domain = config.queries[(run_idx + resolver_idx) % len(config.queries)]
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
                    self._update_progress(benchmark_id, increment=1, resolver=resolver)

                timeout_count = sum(1 for sample in samples if sample.get("failure_kind") == "timeout")
                stats = compute_stats(successful_ms, total_runs=config.runs, timeout_count=timeout_count)
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

            ranked = sorted(
                results,
                key=lambda item: (
                    item["stats"]["median_ms"] if item["stats"]["median_ms"] is not None else float("inf"),
                    item["stats"]["p95_ms"] if item["stats"]["p95_ms"] is not None else float("inf"),
                    item["stats"]["timeout_count"],
                ),
            )
            self._set_done(benchmark_id, engine=engine, results=ranked)
        except Exception as exc:  # noqa: BLE001
            self._set_error(benchmark_id, str(exc))


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
