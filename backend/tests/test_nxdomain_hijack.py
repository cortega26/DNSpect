from __future__ import annotations

from time import sleep

from app.models import BenchmarkRequest
from app.runner import BenchmarkManager


def _wait_terminal(manager: BenchmarkManager, benchmark_id: str, timeout_sec: float = 5.0) -> dict:
    deadline = timeout_sec / 0.01
    for _ in range(int(deadline)):
        state = manager.get(benchmark_id)
        if state and state["status"] in {"done", "failed", "cancelled"}:
            return state
        sleep(0.01)
    raise AssertionError("benchmark did not reach a terminal state")


def test_nxdomain_hijack_detected(monkeypatch, tmp_path) -> None:
    """Resolver returns A record for a guaranteed-nonexistent domain → hijacking detected."""
    query_log: list[tuple[str, str]] = []

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        query_log.append((resolver, domain))
        # The NXDOMAIN check query goes to a random .invalid subdomain
        if domain.startswith("nxdomain-check-") and domain.endswith(".invalid"):
            # Simulate hijacking: return a fake A record
            return {
                "ok": True,
                "ms": 5.0,
                "query": domain,
                "error": None,
                "failure_kind": None,
                "resolver": resolver,
                "answer_ips": ["192.0.2.1"],
            }
        # Normal query
        return {
            "ok": True,
            "ms": 10.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
            "answer_ips": ["1.2.3.4"],
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")

    manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        data_runs_dir=tmp_path / "runs",
    )
    manager.blocking_test_queries = []

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=4,
            timeout_sec=1.0,
            resolvers=["1.1.1.1"],
            queries=["example.com"],
        ),
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"

    result = state["results"][0]
    assert result["stats"]["nxdomain_hijack_detected"] is True

    # Verify the check domain was unique (random suffix)
    check_domains = [d for _, d in query_log if d.startswith("nxdomain-check-")]
    assert len(check_domains) >= 1
    assert all(d.endswith(".invalid") for d in check_domains)


def test_nxdomain_hijack_not_detected(monkeypatch, tmp_path) -> None:
    """Resolver returns NXDOMAIN for nonexistent domain → clean."""

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        if domain.startswith("nxdomain-check-") and domain.endswith(".invalid"):
            return {
                "ok": False,
                "ms": None,
                "query": domain,
                "error": "nxdomain",
                "failure_kind": "nxdomain",
                "resolver": resolver,
            }
        return {
            "ok": True,
            "ms": 10.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
            "answer_ips": ["1.2.3.4"],
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")

    manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        data_runs_dir=tmp_path / "runs",
    )
    manager.blocking_test_queries = []

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=4,
            timeout_sec=1.0,
            resolvers=["1.1.1.1"],
            queries=["example.com"],
        ),
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"

    result = state["results"][0]
    assert result["stats"]["nxdomain_hijack_detected"] is False


def test_nxdomain_hijack_timeout(monkeypatch, tmp_path) -> None:
    """Resolver times out on check domain → inconclusive (None)."""

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        if domain.startswith("nxdomain-check-") and domain.endswith(".invalid"):
            return {
                "ok": False,
                "ms": None,
                "query": domain,
                "error": "timeout",
                "failure_kind": "timeout",
                "resolver": resolver,
            }
        return {
            "ok": True,
            "ms": 10.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
            "answer_ips": ["1.2.3.4"],
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")

    manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        data_runs_dir=tmp_path / "runs",
    )
    manager.blocking_test_queries = []

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=4,
            timeout_sec=1.0,
            resolvers=["1.1.1.1"],
            queries=["example.com"],
        ),
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"

    result = state["results"][0]
    assert result["stats"]["nxdomain_hijack_detected"] is None


def test_all_nxdomain_normal_queries_yields_no_recommendation(monkeypatch, tmp_path) -> None:
    """All normal queries return NXDOMAIN → no usable latency samples, no recommendation."""

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        if domain.startswith("nxdomain-check-") and domain.endswith(".invalid"):
            return {
                "ok": False,
                "ms": None,
                "query": domain,
                "error": "nxdomain",
                "failure_kind": "nxdomain",
                "resolver": resolver,
            }
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": "nxdomain",
            "failure_kind": "nxdomain",
            "resolver": resolver,
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")

    manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        data_runs_dir=tmp_path / "runs",
    )
    manager.blocking_test_queries = []

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=4,
            timeout_sec=1.0,
            resolvers=["1.1.1.1"],
            queries=["example.com"],
        ),
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"

    result = state["results"][0]
    assert result["stats"]["success_count"] == 0
    assert result["stats"]["score_total"] is None
    assert state["recommended_resolver"] is None
    assert state["recommendation_warning"] is not None
