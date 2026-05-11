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


def test_dnssec_validating(monkeypatch, tmp_path) -> None:
    """Resolver returns SERVFAIL for badsig domain → DNSSEC validating."""

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        if domain == "badsig.go.dnscheck.tools":
            return {
                "ok": False,
                "ms": None,
                "query": domain,
                "error": "servfail",
                "failure_kind": "servfail",
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
    assert result["stats"]["dnssec_validating"] is True


def test_dnssec_not_validating(monkeypatch, tmp_path) -> None:
    """Resolver returns A record for badsig domain → not validating."""

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        if domain == "badsig.go.dnscheck.tools":
            return {
                "ok": True,
                "ms": 12.0,
                "query": domain,
                "error": None,
                "failure_kind": None,
                "resolver": resolver,
                "answer_ips": ["1.2.3.4"],
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
    assert result["stats"]["dnssec_validating"] is False


def test_dnssec_timeout(monkeypatch, tmp_path) -> None:
    """Resolver times out on badsig domain → inconclusive."""

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        if domain == "badsig.go.dnscheck.tools":
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
    assert result["stats"]["dnssec_validating"] is None
