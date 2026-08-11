"""Deterministic spike prototype for the plan-021 monitoring-mode scheduler.

Evidence module for the design review of docs/MONITORING_MODE.md. Not
production code: it lives under tests/ and is meant to be deleted once the
design is approved.

The ``RunnerFacade`` method names mirror ``BenchmarkManager`` exactly
(``start``, ``get``, ``list_history``, ``compare_runs`` — backend/app/runner.py),
so a future build plan replaces the facade with the real manager
mechanically. ``SchedulerClock`` isolates time so the loop is testable with a
fake clock; no real sleeping happens in tests.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

# The manifest fields a monitor baseline must match, in the order they appear
# in RunManifest (backend/app/models.py:157-179).
WATCH_MANIFEST_FIELDS: tuple[str, ...] = (
    "run_manifest_version",
    "response_semantics_version",
    "scoring_semantics_version",
    "scoring_profile",
    "target_snapshot",
    "protocol",
    "mode",
    "runs",
    "timeout_sec",
    "normal_query_schedule_version",
    "normal_query_plan_sha256",
    "normal_query_count",
    "blocking_query_plan_sha256",
    "blocking_query_count",
    "diagnostic_policy_version",
    "provider_catalog_sha256",
)

# Mismatch reason codes in the same stable order as COMPARISON_REASON_ORDER
# (backend/app/runner.py:79-94).
WATCH_REASON_CODES: tuple[str, ...] = (
    "manifest_missing",
    "manifest_invalid",
    "manifest_version_mismatch",
    "response_semantics_mismatch",
    "scoring_semantics_mismatch",
    "scoring_profile_mismatch",
    "target_snapshot_mismatch",
    "protocol_mismatch",
    "query_plan_mismatch",
    "mode_mismatch",
    "runs_mismatch",
    "timeout_mismatch",
    "diagnostic_policy_mismatch",
    "provider_catalog_mismatch",
)

# The six deltas available for thresholding, mirroring COMPARISON_METRIC_KEYS
# (backend/app/runner.py:96-103).
WATCH_METRIC_KEYS: tuple[str, ...] = (
    "median_ms",
    "p95_ms",
    "success_rate",
    "failure_rate",
    "blocking_efficacy",
    "score_total",
)

# Threshold units are fixed per metric: latencies, blocking efficacy and score
# degrade as relative percent deltas; the rates as absolute percentage points
# (config values are points; stored rate scale is 0-1, so the effective bound
# is threshold / 100).
RELATIVE_PERCENT_METRICS = frozenset({"median_ms", "p95_ms", "blocking_efficacy", "score_total"})
ABSOLUTE_POINTS_METRICS = frozenset({"success_rate", "failure_rate"})
HIGHER_IS_BETTER_METRICS = frozenset({"success_rate", "blocking_efficacy", "score_total"})

_DEFAULT_EPOCH_MS = 1_786_406_400.0  # 2026-08-11T00:00:00Z


@dataclass(frozen=True)
class WatchConfig:
    """One watch: a pinned measurement contract re-run on an interval."""

    watch_id: str
    target_snapshot: dict[str, object] | None
    protocol: str
    scoring_profile: str
    mode: str
    runs: int
    timeout_sec: float
    interval_min: int
    thresholds: dict[str, float] = field(default_factory=dict)
    queries: tuple[str, ...] = ()


class SchedulerClock(Protocol):
    """Time seam: the loop only learns time and sleeps through the clock."""

    def now(self) -> float: ...

    def sleep(self, seconds: float) -> None: ...


class FakeClock:
    """Deterministic clock for tests: explicit now, sleep() advances time."""

    def __init__(self, now: float = _DEFAULT_EPOCH_MS) -> None:
        self._now = now

    def now(self) -> float:
        return self._now

    def sleep(self, seconds: float) -> None:
        self._now += seconds


def _iso_now(clock: SchedulerClock | None) -> str:
    if clock is None:
        return datetime.now(UTC).isoformat()
    return datetime.fromtimestamp(clock.now(), UTC).isoformat()


def _manifest_equals(baseline: dict[str, Any], candidate: dict[str, Any]) -> bool:
    """Field-wise manifest equality over the RunManifest field set."""
    return all(baseline.get(item) == candidate.get(item) for item in WATCH_MANIFEST_FIELDS)


def _mismatch_reason_codes(baseline: dict[str, Any], candidate: dict[str, Any]) -> list[str]:
    """Mirror _manifest_mismatch_reason_codes (runner.py:207-263): the four
    query-plan fields collapse into query_plan_mismatch."""
    checks: list[tuple[bool, str]] = [
        (
            baseline.get("run_manifest_version") != candidate.get("run_manifest_version"),
            "manifest_version_mismatch",
        ),
        (
            baseline.get("response_semantics_version") != candidate.get("response_semantics_version"),
            "response_semantics_mismatch",
        ),
        (
            baseline.get("scoring_semantics_version") != candidate.get("scoring_semantics_version"),
            "scoring_semantics_mismatch",
        ),
        (baseline.get("scoring_profile") != candidate.get("scoring_profile"), "scoring_profile_mismatch"),
        (baseline.get("target_snapshot") != candidate.get("target_snapshot"), "target_snapshot_mismatch"),
        (baseline.get("protocol") != candidate.get("protocol"), "protocol_mismatch"),
        (
            baseline.get("normal_query_schedule_version") != candidate.get("normal_query_schedule_version")
            or baseline.get("normal_query_plan_sha256") != candidate.get("normal_query_plan_sha256")
            or baseline.get("normal_query_count") != candidate.get("normal_query_count")
            or baseline.get("blocking_query_plan_sha256") != candidate.get("blocking_query_plan_sha256")
            or baseline.get("blocking_query_count") != candidate.get("blocking_query_count"),
            "query_plan_mismatch",
        ),
        (baseline.get("mode") != candidate.get("mode"), "mode_mismatch"),
        (baseline.get("runs") != candidate.get("runs"), "runs_mismatch"),
        (baseline.get("timeout_sec") != candidate.get("timeout_sec"), "timeout_mismatch"),
        (
            baseline.get("diagnostic_policy_version") != candidate.get("diagnostic_policy_version"),
            "diagnostic_policy_mismatch",
        ),
        (
            baseline.get("provider_catalog_sha256") != candidate.get("provider_catalog_sha256"),
            "provider_catalog_mismatch",
        ),
    ]
    return [code for matched, code in checks if matched]


def _build_comparison(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    baseline_manifest = baseline.get("manifest")
    candidate_manifest = candidate.get("manifest")
    reason_codes: list[str] = []
    if baseline_manifest is None:
        reason_codes.append("manifest_missing")
    if candidate_manifest is None:
        reason_codes.append("manifest_missing")
    if baseline_manifest is not None and candidate_manifest is not None:
        reason_codes.extend(_mismatch_reason_codes(baseline_manifest, candidate_manifest))
    reason_codes.sort(key=WATCH_REASON_CODES.index)
    comparable = baseline_manifest is not None and candidate_manifest is not None and not reason_codes
    return {
        "baseline_id": str(baseline.get("id", "")),
        "candidate_id": str(candidate.get("id", "")),
        "comparable": comparable,
        "reason_codes": reason_codes,
    }


class RunnerFacade:
    """Stand-in for BenchmarkManager (backend/app/runner.py).

    Records use the persisted-run JSON shape produced by
    BenchmarkState.as_response() (runner.py:514-548). ``start`` mirrors the
    manager's capacity behaviour exactly: it raises ValueError when capacity
    is full (runner.py:799-800). ``list_history`` mirrors the reduced,
    manifest-free view (runner.py:924-939), so baseline finding must load
    full records through ``get``.
    """

    def __init__(
        self,
        records: dict[str, dict[str, Any]] | None = None,
        template: dict[str, Any] | None = None,
        *,
        capacity_full: bool = False,
        clock: SchedulerClock | None = None,
    ) -> None:
        self._records: dict[str, dict[str, Any]] = copy.deepcopy(records or {})
        self._template: dict[str, Any] | None = copy.deepcopy(template)
        self._capacity_full = capacity_full
        self._clock = clock
        self._next_run_counter = 0

    def start(self, request: dict[str, Any]) -> str:
        """Mirror BenchmarkManager.start (runner.py:753-809)."""
        if self._capacity_full:
            raise ValueError("Capacidad de benchmark agotada. Intenta nuevamente en unos minutos.")
        if self._template is None:
            raise ValueError("No se pudo iniciar benchmark en este momento.")
        self._next_run_counter += 1
        run_id = f"watch-{self._next_run_counter:04d}"
        record = copy.deepcopy(self._template)
        record["id"] = run_id
        record["status"] = "queued"
        record["started_at"] = _iso_now(self._clock)
        record["finished_at"] = None
        self._records[run_id] = record
        return run_id

    def complete(self, run_id: str, status: str = "done") -> None:
        """Test helper: simulate elapsed time moving a run to a terminal status."""
        record = self._records[run_id]
        record["status"] = status
        record["finished_at"] = _iso_now(self._clock)

    def get(self, benchmark_id: str) -> dict[str, Any] | None:
        """Mirror BenchmarkManager.get (runner.py:893-908)."""
        record = self._records.get(benchmark_id)
        return copy.deepcopy(record) if record is not None else None

    def list_history(self) -> dict[str, list[dict[str, Any]]]:
        """Mirror BenchmarkManager.list_history (runner.py:915-953): reduced
        view, newest first, capped at 50 entries, no manifest included."""
        entries: list[dict[str, Any]] = []
        for record in self._records.values():
            results = record.get("results") or []
            entries.append(
                {
                    "id": record.get("id"),
                    "mode": record.get("mode"),
                    "goal": record.get("goal") or record.get("scoring_profile"),
                    "scoring_profile": record.get("scoring_profile") or record.get("goal"),
                    "protocol": record.get("protocol"),
                    "started_at": record.get("started_at"),
                    "finished_at": record.get("finished_at"),
                    "status": record.get("status"),
                    "target_snapshot": record.get("target_snapshot"),
                    "results_summary": [
                        {"provider_name": result.get("provider_name"), "resolver": result.get("resolver")}
                        for result in results[:3]
                    ],
                }
            )

        def _sort_key(entry: dict[str, Any]) -> tuple[float, int, str]:
            started_raw = entry.get("started_at")
            try:
                parsed = datetime.fromisoformat(str(started_raw))
                return (parsed.timestamp(), 0, str(entry.get("id", "")))
            except (ValueError, TypeError):
                return (0, 1, str(entry.get("id", "")))

        entries.sort(key=_sort_key, reverse=True)
        return {"runs": entries[:50]}

    def compare_runs(self, baseline_id: str, candidate_id: str) -> dict[str, Any] | None:
        """Mirror BenchmarkManager.compare_runs (runner.py:1495-1511)."""
        baseline = self.get(baseline_id)
        candidate = self.get(candidate_id)
        if baseline is None or candidate is None:
            return None
        if baseline.get("status") != "done" or candidate.get("status") != "done":
            raise ValueError("benchmark aún en ejecución")
        return _build_comparison(baseline, candidate)


@dataclass
class WatchScheduler:
    """One scheduler iteration per tick(); paced externally through the clock."""

    config: WatchConfig
    runner: RunnerFacade
    clock: SchedulerClock

    def __post_init__(self) -> None:
        self._active_run_id: str | None = None

    @property
    def active_run_id(self) -> str | None:
        return self._active_run_id

    def tick(self) -> list[dict[str, Any]]:
        """One iteration: poll the active run or start the next one.

        Returns the alert events emitted this tick. Never starts a second run
        while one is active (idempotent); skips the cycle when capacity is
        full.
        """
        if self._active_run_id is not None:
            return self._poll_active_run()
        return self._start_next_run()

    def run_forever(self) -> None:
        """The scheduler loop: tick once per interval through the clock."""
        while True:
            self.tick()
            self.clock.sleep(float(self.config.interval_min) * 60.0)

    def _start_next_run(self) -> list[dict[str, Any]]:
        request: dict[str, Any] = {
            "target_snapshot": self.config.target_snapshot,
            "protocol": self.config.protocol,
            "scoring_profile": self.config.scoring_profile,
            "mode": self.config.mode,
            "runs": self.config.runs,
            "timeout_sec": self.config.timeout_sec,
            "queries": list(self.config.queries) or None,
        }
        try:
            run_id = self.runner.start(request)
        except ValueError:
            return []
        self._active_run_id = run_id
        return []

    def _poll_active_run(self) -> list[dict[str, Any]]:
        run = self.runner.get(self._active_run_id)
        if run is None or run.get("status") in {"queued", "running"}:
            return []
        run_id = self._active_run_id
        self._active_run_id = None
        if run.get("status") != "done":
            return [
                {
                    "kind": "watch_run_not_done",
                    "watch_id": self.config.watch_id,
                    "run_id": run_id,
                    "status": run.get("status"),
                }
            ]
        return self._evaluate(run)

    def _evaluate(self, candidate: dict[str, Any]) -> list[dict[str, Any]]:
        candidate_manifest = candidate.get("manifest") or {}
        candidate_id = str(candidate.get("id", ""))
        baseline_id = _find_matching_baseline(self.runner, candidate_id, candidate_manifest)
        if baseline_id is None:
            return [_no_comparable_baseline_event(self.config, candidate_id, self.runner)]
        return _threshold_events(self.config, baseline_id, candidate_id, self.runner)


def _find_matching_baseline(
    runner: RunnerFacade,
    candidate_id: str,
    candidate_manifest: dict[str, Any],
) -> str | None:
    """Newest done history entry whose manifest equals the candidate's."""
    for entry in runner.list_history()["runs"]:
        entry_id = str(entry.get("id", ""))
        if entry_id == candidate_id or entry.get("status") != "done":
            continue
        full = runner.get(entry_id)
        if full is not None and _manifest_equals(full.get("manifest") or {}, candidate_manifest):
            return entry_id
    return None


def _no_comparable_baseline_event(
    config: WatchConfig,
    candidate_id: str,
    runner: RunnerFacade,
) -> dict[str, Any]:
    reason_codes: list[str] = []
    for entry in runner.list_history()["runs"]:
        entry_id = str(entry.get("id", ""))
        if entry_id == candidate_id or entry.get("status") != "done":
            continue
        comparison = runner.compare_runs(entry_id, candidate_id)
        if comparison is not None:
            reason_codes = comparison["reason_codes"]
        break
    return {
        "kind": "no_comparable_baseline",
        "watch_id": config.watch_id,
        "run_id": candidate_id,
        "reason_codes": reason_codes,
    }


def _metric_value(result: dict[str, Any], metric: str) -> float | None:
    value = (result.get("stats") or {}).get(metric)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _metric_delta(baseline_value: float, candidate_value: float, metric: str) -> float | None:
    if metric in RELATIVE_PERCENT_METRICS:
        if baseline_value == 0.0:
            return None
        return (candidate_value - baseline_value) / baseline_value * 100.0
    return candidate_value - baseline_value


def _crosses_threshold(delta: float, metric: str, threshold: float) -> bool:
    bound = threshold / 100.0 if metric in ABSOLUTE_POINTS_METRICS else threshold
    if metric in HIGHER_IS_BETTER_METRICS:
        return delta <= -bound
    return delta >= bound


def _threshold_events(
    config: WatchConfig,
    baseline_id: str,
    candidate_id: str,
    runner: RunnerFacade,
) -> list[dict[str, Any]]:
    baseline = runner.get(baseline_id)
    candidate = runner.get(candidate_id)
    events: list[dict[str, Any]] = []
    if baseline is None or candidate is None:
        return events
    baseline_by_resolver = {
        str(result.get("resolver", "")): result for result in (baseline.get("results") or [])
    }
    candidate_by_resolver = {
        str(result.get("resolver", "")): result for result in (candidate.get("results") or [])
    }
    for resolver in sorted(set(baseline_by_resolver) & set(candidate_by_resolver)):
        for metric in WATCH_METRIC_KEYS:
            threshold = config.thresholds.get(metric)
            if threshold is None:
                continue
            baseline_value = _metric_value(baseline_by_resolver[resolver], metric)
            candidate_value = _metric_value(candidate_by_resolver[resolver], metric)
            if baseline_value is None or candidate_value is None:
                continue
            delta = _metric_delta(baseline_value, candidate_value, metric)
            if delta is None or not _crosses_threshold(delta, metric, threshold):
                continue
            events.append(
                {
                    "kind": "threshold_alert",
                    "watch_id": config.watch_id,
                    "run_id": candidate_id,
                    "baseline_id": baseline_id,
                    "resolver": resolver,
                    "metric": metric,
                    "baseline_value": baseline_value,
                    "candidate_value": candidate_value,
                    "delta": delta,
                    "threshold": threshold,
                }
            )
    return events


def _fixture_stats(
    *,
    median_ms: float,
    p95_ms: float,
    success_rate: float,
    failure_rate: float,
    blocking_efficacy: float,
    score_total: float,
) -> dict[str, Any]:
    """Realistic stats dict, same shape as tests/test_export_csv.py:41-73."""
    return {
        "avg_ms": median_ms,
        "median_ms": median_ms,
        "p95_ms": p95_ms,
        "min_ms": round(median_ms * 0.9, 3),
        "max_ms": p95_ms,
        "ok_count": 2,
        "timeout_count": 0,
        "success_rate": success_rate,
        "timeout_rate": 0.0,
        "success_count": 2,
        "failure_count": 0,
        "failure_rate": failure_rate,
        "consistency_ratio": 0.97,
        "p95_minus_median_ms": round(p95_ms - median_ms, 3),
        "score_latency": 24.5,
        "score_reliability": 0.0,
        "score_stability": 11.025,
        "score_total": score_total,
        "normalized_latency": 0.01,
        "normalized_reliability": 0.0,
        "normalized_stability": 0.02,
        "reliability_penalty": 0.0,
        "max_rel_penalty": 0.3,
        "blocking_efficacy": blocking_efficacy,
        "blocked_count": 7,
        "blocking_test_count": 9,
        "score_blocking": 12.3,
        "normalized_blocking": 0.45,
        "nxdomain_hijack_detected": False,
        "dnssec_validating": True,
    }


def _fixture_run(
    *,
    run_id: str,
    started_at: str,
    manifest: dict[str, Any],
    stats: dict[str, Any],
    status: str = "done",
) -> dict[str, Any]:
    return {
        "id": run_id,
        "status": status,
        "progress": {
            "current": 2,
            "total": 2,
            "current_resolver": None,
            "last_sample_at": 0,
            "avg_latency_ms": stats["median_ms"],
        },
        "started_at": started_at,
        "finished_at": "2026-08-11T01:00:00+00:00" if status == "done" else None,
        "mode": manifest["mode"],
        "goal": manifest["scoring_profile"],
        "scoring_profile": manifest["scoring_profile"],
        "protocol": manifest["protocol"],
        "timeout_sec": manifest["timeout_sec"],
        "runs": manifest["runs"],
        "engine": "dnspython",
        "error": None,
        "run_storage_warning": None,
        "results": [
            {
                "resolver": "1.1.1.1",
                "provider_id": "cloudflare",
                "provider_name": "Cloudflare",
                "engine": "dnspython",
                "protocol": manifest["protocol"],
                "stats": stats,
                "samples": [],
                "is_unreliable": False,
            }
        ],
        "recommended_resolver": None,
        "recommendation_warning": None,
        "target_snapshot": manifest["target_snapshot"],
        "manifest": manifest,
    }


FIXTURE_MANIFEST_ALPHA: dict[str, Any] = {
    "run_manifest_version": 1,
    "response_semantics_version": "dns-response-v1",
    "scoring_semantics_version": "score-v1",
    "scoring_profile": "speed",
    "target_snapshot": {
        "resolver_ips": ["1.1.1.1"],
        "selection_source": "manual",
        "provider_ids": {"1.1.1.1": "cloudflare"},
    },
    "protocol": "udp",
    "mode": "quick",
    "runs": 2,
    "timeout_sec": 2.0,
    "normal_query_schedule_version": "round-robin-v1",
    "normal_query_plan_sha256": "plan-alpha",
    "normal_query_count": 2,
    "blocking_query_plan_sha256": "blocking-alpha",
    "blocking_query_count": 9,
    "diagnostic_policy_version": "random-nxdomain-v1",
    "provider_catalog_sha256": "catalog-alpha",
}

# Same measurement contract as ALPHA except ``runs``: baseline matching must
# reject this run and report runs_mismatch.
FIXTURE_MANIFEST_BETA: dict[str, Any] = dict(FIXTURE_MANIFEST_ALPHA, runs=3)

FIXTURE_RUN_A_BASELINE: dict[str, Any] = _fixture_run(
    run_id="a1b2c3d4e5f60718293a4b5c6d7e8f90",
    started_at="2026-08-01T00:00:00+00:00",
    manifest=FIXTURE_MANIFEST_ALPHA,
    stats=_fixture_stats(
        median_ms=24.1,
        p95_ms=35.125,
        success_rate=1.0,
        failure_rate=0.0,
        blocking_efficacy=87.5,
        score_total=11.532,
    ),
)

FIXTURE_RUN_B_DEGRADED: dict[str, Any] = _fixture_run(
    run_id="b2c3d4e5f60718293a4b5c6d7e8f90a1",
    started_at="2026-08-02T00:00:00+00:00",
    manifest=FIXTURE_MANIFEST_ALPHA,
    stats=_fixture_stats(
        median_ms=33.74,  # +40% over the baseline median
        p95_ms=45.0,
        success_rate=0.98,
        failure_rate=0.02,
        blocking_efficacy=86.0,
        score_total=10.9,
    ),
)

FIXTURE_RUN_C_MISMATCHED: dict[str, Any] = _fixture_run(
    run_id="c3d4e5f60718293a4b5c6d7e8f90a1b2",
    started_at="2026-08-03T00:00:00+00:00",
    manifest=FIXTURE_MANIFEST_BETA,
    stats=_fixture_stats(
        median_ms=25.0,
        p95_ms=36.0,
        success_rate=1.0,
        failure_rate=0.0,
        blocking_efficacy=87.5,
        score_total=11.5,
    ),
)
