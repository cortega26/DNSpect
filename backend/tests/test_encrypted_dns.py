from __future__ import annotations

from time import sleep
from typing import Any

import pytest

from app.models import BenchmarkRequest
from app.runner import BenchmarkManager, run_doh_query, run_dot_query


def _mock_dot_response(**overrides: Any) -> dict[str, Any]:
    return {
        "ok": True,
        "ms": 25.0,
        "query": "example.com",
        "error": None,
        "failure_kind": None,
        "answer_ips": ["93.184.216.34"],
        **overrides,
    }


def _mock_doh_response(**overrides: Any) -> dict[str, Any]:
    return {
        "ok": True,
        "ms": 30.0,
        "query": "example.com",
        "error": None,
        "failure_kind": None,
        "answer_ips": ["93.184.216.34"],
        **overrides,
    }


def _wait_terminal(manager: BenchmarkManager, benchmark_id: str, timeout_sec: float = 5.0) -> dict:
    attempts = int(timeout_sec / 0.01)
    for _ in range(attempts):
        state = manager.get(benchmark_id)
        if state and state["status"] in {"done", "failed", "cancelled"}:
            return state
        sleep(0.01)
    raise AssertionError("benchmark did not finish in time")


def test_run_dot_query_success(monkeypatch) -> None:
    """DoT query returns a valid response."""

    def fake_tls(q, where, **kwargs):
        del q, where, kwargs

        class FakeRR:
            rdtype = 1  # A record
            address = "93.184.216.34"

        class FakeAnswer:
            name = None
            rdtype = 1

            def __init__(self):
                self.answer = [[FakeRR()]]

        return FakeAnswer()

    monkeypatch.setattr("dns.query.tls", fake_tls)
    result = run_dot_query("1.1.1.1", "example.com", 2.0, "one.one.one.one")
    assert result["ok"] is True
    assert result["ms"] is not None
    assert "93.184.216.34" in result["answer_ips"]


def test_run_dot_query_failure(monkeypatch) -> None:
    """DoT query handles exceptions gracefully."""

    def fake_tls(q, where, **kwargs):
        raise TimeoutError("TLS timeout")

    monkeypatch.setattr("dns.query.tls", fake_tls)
    result = run_dot_query("1.1.1.1", "example.com", 2.0, "one.one.one.one")
    assert result["ok"] is False
    assert result["failure_kind"] is not None


def test_run_doh_query_success(monkeypatch) -> None:
    """DoH query returns a valid response."""

    def fake_https(q, url, **kwargs):
        del q, url, kwargs

        class FakeRR:
            rdtype = 1
            address = "93.184.216.34"

        class FakeAnswer:
            name = None
            rdtype = 1

            def __init__(self):
                self.answer = [[FakeRR()]]

        return FakeAnswer()

    monkeypatch.setattr("dns.query.https", fake_https)
    result = run_doh_query("1.1.1.1", "example.com", 2.0, "https://cloudflare-dns.com/dns-query")
    assert result["ok"] is True
    assert result["ms"] is not None
    assert "93.184.216.34" in result["answer_ips"]


def test_run_doh_query_no_url() -> None:
    """DoH query without a URL returns an error."""
    result = run_doh_query("1.1.1.1", "example.com", 2.0, None)
    assert result["ok"] is False
    assert result["failure_kind"] == "other"


def test_run_doh_query_failure(monkeypatch) -> None:
    """DoH query handles exceptions gracefully."""

    def fake_https(q, url, **kwargs):
        raise ConnectionError("HTTP connection failed")

    monkeypatch.setattr("dns.query.https", fake_https)
    result = run_doh_query("1.1.1.1", "example.com", 2.0, "https://dns.google/dns-query")
    assert result["ok"] is False


def test_benchmark_with_dot_protocol(monkeypatch, tmp_path) -> None:
    """Full benchmark run with DoT protocol succeeds."""
    manager = BenchmarkManager(max_concurrent_jobs=1, max_queued_jobs=1, data_runs_dir=tmp_path / "runs")

    def fake_measure(*, resolver, domain, timeout_sec, engine):
        del timeout_sec, engine
        return {
            "ok": True,
            "ms": 22.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")
    manager.blocking_test_queries = []

    # Only cloudflare (1.1.1.1) has dot_hostname in the provider index
    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=2,
            timeout_sec=2.0,
            resolvers=["1.1.1.1", "8.8.8.8"],
            queries=["example.com"],
            protocol="dot",
        )
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"
    assert state["protocol"] == "dot"
    # 8.8.8.8 does not support DoT (no dot_hostname), only 1.1.1.1 should remain
    for result in state["results"]:
        assert result["protocol"] == "dot"


def test_benchmark_with_doh_protocol(monkeypatch, tmp_path) -> None:
    """Full benchmark run with DoH protocol succeeds."""
    manager = BenchmarkManager(max_concurrent_jobs=1, max_queued_jobs=1, data_runs_dir=tmp_path / "runs")

    def fake_measure(*, resolver, domain, timeout_sec, engine):
        del timeout_sec, engine
        return {
            "ok": True,
            "ms": 28.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")
    manager.blocking_test_queries = []

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=2,
            timeout_sec=2.0,
            resolvers=["1.1.1.1", "9.9.9.9"],
            queries=["example.com"],
            protocol="doh",
        )
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"
    assert state["protocol"] == "doh"
    for result in state["results"]:
        assert result["protocol"] == "doh"


def test_protocol_filters_unsupported_resolvers(monkeypatch, tmp_path) -> None:
    """Protocol filtering excludes resolvers without the required protocol support."""
    manager = BenchmarkManager(max_concurrent_jobs=1, max_queued_jobs=1, data_runs_dir=tmp_path / "runs")

    def fake_measure(*, resolver, domain, timeout_sec, engine):
        del timeout_sec, engine
        return {
            "ok": True,
            "ms": 15.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")
    manager.blocking_test_queries = []

    # 1.1.1.1 has DoT, 8.8.8.8 has DoT too. Use a resolver without DoT to test filtering.
    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=1,
            timeout_sec=2.0,
            resolvers=["1.1.1.1"],
            queries=["example.com"],
            protocol="dot",
        )
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"
    # Should have exactly one result (1.1.1.1)
    assert len(state["results"]) == 1


def test_protocol_udp_default(monkeypatch, tmp_path) -> None:
    """Default protocol is UDP when not specified."""
    manager = BenchmarkManager(max_concurrent_jobs=1, max_queued_jobs=1, data_runs_dir=tmp_path / "runs")

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
    manager.blocking_test_queries = []

    benchmark_id = manager.start(
        BenchmarkRequest(runs=1, timeout_sec=1.0, resolvers=["1.1.1.1"], queries=["example.com"])
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"
    assert state["protocol"] == "udp"


def test_protocol_no_resolvers_available(monkeypatch, tmp_path) -> None:
    """Raises ValueError when no resolvers support the requested protocol."""
    manager = BenchmarkManager(max_concurrent_jobs=1, max_queued_jobs=1, data_runs_dir=tmp_path / "runs")

    # Patch provider_index to be empty so no resolver has protocol metadata
    monkeypatch.setattr(manager, "provider_index", {})

    with pytest.raises(ValueError, match="No hay resolvers disponibles para el protocolo seleccionado"):
        manager.start(
            BenchmarkRequest(
                runs=1,
                timeout_sec=1.0,
                resolvers=["1.1.1.1"],
                queries=["example.com"],
                protocol="dot",
            )
        )


def test_protocol_reflected_in_history(monkeypatch, tmp_path) -> None:
    """Protocol is stored and returned in run history."""
    manager = BenchmarkManager(max_concurrent_jobs=1, max_queued_jobs=1, data_runs_dir=tmp_path / "runs")

    def fake_measure(*, resolver, domain, timeout_sec, engine):
        del timeout_sec, engine
        return {
            "ok": True,
            "ms": 20.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")
    manager.blocking_test_queries = []

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=1,
            timeout_sec=1.0,
            resolvers=["1.1.1.1"],
            queries=["example.com"],
            protocol="dot",
        )
    )
    _wait_terminal(manager, benchmark_id)

    history = manager.list_history()
    assert len(history["runs"]) > 0
    matching = [r for r in history["runs"] if r["id"] == benchmark_id]
    assert len(matching) == 1
    assert matching[0]["protocol"] == "dot"
