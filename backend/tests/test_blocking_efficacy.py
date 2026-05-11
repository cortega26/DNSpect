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


def test_blocking_efficacy_integration(monkeypatch, tmp_path) -> None:
    query_responses: dict[tuple[str, str], dict] = {
        ("1.1.1.1", "doubleclick.net"): {
            "ok": False,
            "ms": None,
            "query": "doubleclick.net",
            "error": "nxdomain",
            "failure_kind": "nxdomain",
        },
        ("1.1.1.1", "adsrvr.org"): {
            "ok": False,
            "ms": None,
            "query": "adsrvr.org",
            "error": "nxdomain",
            "failure_kind": "nxdomain",
        },
        ("1.1.1.1", "criteo.com"): {
            "ok": True,
            "ms": 15.0,
            "query": "criteo.com",
            "error": None,
            "failure_kind": None,
            "answer_ips": ["64.233.186.102"],
        },
        ("1.1.1.1", "outbrain.com"): {
            "ok": True,
            "ms": 12.0,
            "query": "outbrain.com",
            "error": None,
            "failure_kind": None,
            "answer_ips": ["0.0.0.0"],
        },
        ("1.1.1.1", "pubmatic.com"): {
            "ok": True,
            "ms": 18.0,
            "query": "pubmatic.com",
            "error": None,
            "failure_kind": None,
            "answer_ips": ["0.0.0.0"],
        },
        ("1.1.1.1", "pixel.quantserve.com"): {
            "ok": False,
            "ms": None,
            "query": "pixel.quantserve.com",
            "error": "refused",
            "failure_kind": "refused",
        },
        ("1.1.1.1", "0.gp"): {
            "ok": True,
            "ms": 20.0,
            "query": "0.gp",
            "error": None,
            "failure_kind": None,
            "answer_ips": ["157.90.66.230"],
        },
        ("1.1.1.1", "0-0.fr"): {
            "ok": True,
            "ms": 22.0,
            "query": "0-0.fr",
            "error": None,
            "failure_kind": None,
            "answer_ips": ["178.32.4.53"],
        },
        ("1.1.1.1", "0-105.com"): {
            "ok": True,
            "ms": 19.0,
            "query": "0-105.com",
            "error": None,
            "failure_kind": None,
            "answer_ips": ["51.178.187.206"],
        },
    }

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        key = (resolver, domain)
        if key in query_responses:
            return {**query_responses[key], "resolver": resolver}
        return {
            "ok": True,
            "ms": 10.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
            "answer_ips": [],
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")

    manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        data_runs_dir=tmp_path / "runs",
    )
    # Override blocking test queries for deterministic test
    manager.blocking_test_queries = [
        "doubleclick.net",
        "adsrvr.org",
        "criteo.com",
        "outbrain.com",
        "pubmatic.com",
        "pixel.quantserve.com",
        "0.gp",
        "0-0.fr",
        "0-105.com",
    ]

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
    stats = result["stats"]

    # Blocked: doubleclick.net (nxdomain), adsrvr.org (nxdomain),
    #          outbrain.com (0.0.0.0 sinkhole), pubmatic.com (0.0.0.0),
    #          pixel.quantserve.com (refused)
    # Not blocked: criteo.com (resolved normally), 0.gp (resolved),
    #              0-0.fr (resolved), 0-105.com (resolved)
    assert stats["blocking_test_count"] == 9, f"expected 9, got {stats['blocking_test_count']}"
    assert stats["blocked_count"] == 5, f"expected 5, got {stats['blocked_count']}"
    assert stats["blocking_efficacy"] == round(5.0 / 9.0, 4)
