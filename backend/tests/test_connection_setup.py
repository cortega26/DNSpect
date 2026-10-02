from __future__ import annotations

import time
from pathlib import Path

import pytest

from app.models import BenchmarkRequest
from app.runner import BenchmarkManager, measure_connection_setup_ms


def _wait_terminal(manager: BenchmarkManager, benchmark_id: str, timeout_sec: float = 15.0) -> dict:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        state = manager.get(benchmark_id)
        if state and state["status"] in {"done", "failed", "cancelled", "error"}:
            return state
        time.sleep(0.01)
    raise AssertionError("benchmark did not reach a terminal state")


def test_udp_has_no_connection_setup() -> None:
    # UDP is stateless, so there is no setup cost to report. None here means
    # "not applicable", which is why it must not be confused with a failure.
    assert measure_connection_setup_ms("1.1.1.1", "udp", 2.0) is None


def test_setup_returns_none_when_it_cannot_be_measured() -> None:
    # A setup that cannot complete must report None rather than a fake number.
    assert measure_connection_setup_ms("1.1.1.1", "doh", 2.0, doh_url=None) is None
    assert measure_connection_setup_ms("1.1.1.1", "doh", 2.0, doh_url="not-a-url") is None


def test_setup_returns_none_on_unreachable_endpoint() -> None:
    # TEST-NET-3 is reserved and unroutable, so the connect cannot succeed.
    value = measure_connection_setup_ms("203.0.113.1", "dot", 1.0, dot_hostname="x.example")
    assert value is None


def test_setup_is_never_scored() -> None:
    """Setup is a path cost, not a resolver property. It must not reach the
    stats block, the scoring inputs or the comparison metric keys."""
    from app.runner import COMPARISON_METRIC_KEYS
    from app.stats import compute_stats

    stats = compute_stats([10.0, 11.0, 12.0], total_runs=3, timeout_count=0, failure_count=0)

    assert "connection_setup_ms" not in stats
    assert not any("setup" in key for key in COMPARISON_METRIC_KEYS)
    # The scored latency must stay the plain mean of the query samples.
    assert stats["avg_ms"] == 11.0


def test_result_carries_setup_as_a_separate_field(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        data_runs_dir=tmp_path / "runs",
        query_pace_ms=0,
    )
    manager.blocking_test_queries = []

    def fake_measure(*, resolver, domain, timeout_sec, engine):
        del timeout_sec, engine
        return {
            "ok": True,
            "ms": 12.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")
    monkeypatch.setattr("app.runner.measure_connection_setup_ms", lambda *a, **k: 41.5)

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=2,
            timeout_sec=2.0,
            resolvers=["1.1.1.1"],
            queries=["example.com"],
            protocol="udp",
        )
    )
    state = _wait_terminal(manager, benchmark_id)

    assert state["status"] == "done"
    result = state["results"][0]
    assert result["connection_setup_ms"] == 41.5
    # It sits beside the stats, not inside them.
    assert "connection_setup_ms" not in result["stats"]


def test_work_estimate_accounts_for_the_setup_probe(tmp_path: Path) -> None:
    manager = BenchmarkManager(data_runs_dir=tmp_path / "runs", query_pace_ms=0)

    estimate = manager._estimate_benchmark_work(resolver_count=1, runs=10, timeout_sec=2.0)

    # One extra attempt per resolver is budgeted for the setup measurement, so
    # the total must be runs + blocking + diagnostics + that one setup attempt,
    # and the estimate must scale with the resolver count.
    assert estimate.total_attempts == (
        10 + estimate.blocking_attempts_per_resolver + estimate.diagnostic_attempts_per_resolver + 1
    )
    two_resolvers = manager._estimate_benchmark_work(resolver_count=2, runs=10, timeout_sec=2.0)
    assert two_resolvers.total_attempts == 2 * estimate.total_attempts
