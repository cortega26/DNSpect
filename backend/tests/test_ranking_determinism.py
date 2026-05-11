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


def test_benchmark_ranking_is_independent_from_resolver_input_order(monkeypatch) -> None:
    resolver_a = "1.1.1.1"
    resolver_b = "8.8.8.8"
    queries = ["a.com", "b.com", "c.com", "d.com", "e.com"]
    latency_map = {
        (resolver_a, "a.com"): 90.0,
        (resolver_a, "b.com"): 28.0,
        (resolver_a, "c.com"): 115.0,
        (resolver_a, "d.com"): 91.0,
        (resolver_a, "e.com"): 86.0,
        (resolver_b, "a.com"): 78.0,
        (resolver_b, "b.com"): 33.0,
        (resolver_b, "c.com"): 104.0,
        (resolver_b, "d.com"): 40.0,
        (resolver_b, "e.com"): 120.0,
    }

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        key = (resolver, domain)
        if key in latency_map:
            return {
                "ok": True,
                "ms": latency_map[key],
                "query": domain,
                "error": None,
                "failure_kind": None,
                "resolver": resolver,
                "answer_ips": [],
            }
        # Unknown domains (e.g. blocking test domains): simulate NXDOMAIN
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": "blocked",
            "failure_kind": "nxdomain",
            "resolver": resolver,
            "answer_ips": [],
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")

    manager = BenchmarkManager(max_concurrent_jobs=2, max_queued_jobs=2, terminal_ttl_sec=600)

    req_a = BenchmarkRequest(runs=12, timeout_sec=1.0, resolvers=[resolver_a, resolver_b], queries=queries)
    req_b = BenchmarkRequest(runs=12, timeout_sec=1.0, resolvers=[resolver_b, resolver_a], queries=queries)

    benchmark_a = manager.start(req_a)
    benchmark_b = manager.start(req_b)

    state_a = _wait_terminal(manager, benchmark_a)
    state_b = _wait_terminal(manager, benchmark_b)
    assert state_a["status"] == "done"
    assert state_b["status"] == "done"

    ranking_a = [item["resolver"] for item in state_a["results"]]
    ranking_b = [item["resolver"] for item in state_b["results"]]
    assert ranking_a == ranking_b
    assert state_a["recommended_resolver"] == state_b["recommended_resolver"]
