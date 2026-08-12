from __future__ import annotations

import json
from pathlib import Path
from time import sleep
from typing import Any

import dns.exception
import dns.query
import dns.rcode
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import BenchmarkRequest
from app.providers import load_providers
from app.runner import (
    BenchmarkManager,
    _resolver_protocol_endpoint,
    dns_quic_available,
    run_doq_query,
)

client = TestClient(app)


def _write_fixture(tmp_path: Path, content: list[dict]) -> Path:
    path = tmp_path / "test_doq_providers.json"
    path.write_text(json.dumps(content), encoding="utf-8")
    return path


def _wait_terminal(manager: BenchmarkManager, benchmark_id: str, timeout_sec: float = 5.0) -> dict:
    attempts = int(timeout_sec / 0.01)
    for _ in range(attempts):
        state = manager.get(benchmark_id)
        if state and state["status"] in {"done", "failed", "cancelled"}:
            return state
        sleep(0.01)
    raise AssertionError("benchmark did not finish in time")


def _fake_quic_response(rcode_value: int = dns.rcode.NOERROR) -> Any:
    class FakeRR:
        rdtype = 1  # A record
        address = "93.184.216.34"

    class FakeAnswer:
        def __init__(self) -> None:
            self.answer = [[FakeRR()]]

        def rcode(self) -> int:
            return rcode_value

    return FakeAnswer()


def test_catalog_cleanup() -> None:
    """Unverifiable DoQ claims removed; adguard uses the documented endpoints."""
    providers = {p["id"]: p["features"] for p in load_providers()}
    assert providers["cloudflare"].get("doq") != "yes"
    assert "doq_hostname" not in providers["cloudflare"]
    assert providers["google"].get("doq") != "yes"
    assert "doq_hostname" not in providers["google"]
    assert providers["adguard"]["doq_hostname"] == "dns.adguard-dns.com"
    assert providers["adguard"]["dot_hostname"] == "dns.adguard-dns.com"
    assert providers["adguard"]["doh_url"] == "https://dns.adguard-dns.com/dns-query"
    assert providers["quad9"]["doq_hostname"] == "dns.quad9.net"
    assert providers["quad9-unsecured"]["doq_hostname"] == "dns10.quad9.net"


def test_providers_validate_doq_hostname(monkeypatch, tmp_path) -> None:
    base = {
        "id": "test",
        "name": "Test",
        "dns": ["1.1.1.1"],
        "tags": [],
        "region": "global",
        "country": None,
        "goals": [],
        "notes_es": "",
    }

    no_hostname = {**base, "features": {"doq": "yes"}}
    path = _write_fixture(tmp_path, [no_hostname])
    monkeypatch.setattr("app.providers.PROVIDERS_PATH", path)
    with pytest.raises(ValueError, match="doq=yes sin doq_hostname"):
        load_providers()

    invalid_hostname = {**base, "features": {"doq": "yes", "doq_hostname": "not a hostname"}}
    path = _write_fixture(tmp_path, [invalid_hostname])
    monkeypatch.setattr("app.providers.PROVIDERS_PATH", path)
    with pytest.raises(ValueError, match="doq_hostname inválido"):
        load_providers()

    valid = {**base, "features": {"doq": "yes", "doq_hostname": "dns.quad9.net", "doh": "no"}}
    path = _write_fixture(tmp_path, [valid])
    monkeypatch.setattr("app.providers.PROVIDERS_PATH", path)
    assert load_providers()[0]["id"] == "test"


def test_doq_eligibility_codes(monkeypatch) -> None:
    """_resolver_protocol_endpoint gates doq on the flag, availability and hostname validity."""
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: True)

    provider_index = {
        "1.1.1.1": {
            "id": "cf",
            "name": "Cloudflare",
            "features": {"doq": "yes", "doq_hostname": "one.one.one.one"},
        }
    }
    endpoint, code = _resolver_protocol_endpoint("1.1.1.1", "doq", provider_index)
    assert endpoint == "one.one.one.one"
    assert code is None

    missing = {"id": "m", "name": "M", "features": {"doq": "yes"}}
    endpoint, code = _resolver_protocol_endpoint("1.1.1.1", "doq", {"1.1.1.1": missing})
    assert endpoint is None
    assert code == "doq_hostname_missing"

    invalid = {"id": "i", "name": "I", "features": {"doq": "yes", "doq_hostname": "bad hostname"}}
    endpoint, code = _resolver_protocol_endpoint("1.1.1.1", "doq", {"1.1.1.1": invalid})
    assert endpoint is None
    assert code == "doq_hostname_invalid"

    monkeypatch.setattr("app.runner.dns_quic_available", lambda: False)
    endpoint, code = _resolver_protocol_endpoint("1.1.1.1", "doq", provider_index)
    assert endpoint is None
    assert code == "doq_unavailable"


def test_doq_flag_required_in_plain_benchmark(monkeypatch) -> None:
    """A provider with a doq_hostname but doq != "yes" is filtered from a plain doq run."""
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: True)
    manager = BenchmarkManager()
    manager.provider_index = {
        "1.1.1.1": {
            "id": "cf",
            "name": "Cloudflare",
            "features": {"doq": "no", "doq_hostname": "one.one.one.one"},
        },
        "9.9.9.9": {
            "id": "q9",
            "name": "Quad9",
            "features": {"doq": "yes", "doq_hostname": "dns.quad9.net"},
        },
    }
    assert not manager._resolver_supports_protocol("1.1.1.1", "doq")
    assert manager._resolver_supports_protocol("9.9.9.9", "doq")
    endpoint, code = _resolver_protocol_endpoint("1.1.1.1", "doq", manager.provider_index)
    assert endpoint is None
    assert code == "doq_unsupported"


def test_unknown_protocol_returns_invalid_protocol(monkeypatch) -> None:
    """The old fallthrough returned a wrong dot code; the unified gate must not."""
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: True)
    provider_index = {
        "1.1.1.1": {"id": "cf", "name": "Cloudflare", "features": {"doq": "yes"}},
    }
    endpoint, code = _resolver_protocol_endpoint("1.1.1.1", "unknown_protocol", provider_index)
    assert endpoint is None
    assert code == "invalid_protocol"


def test_run_doq_query_success(monkeypatch) -> None:
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: True)
    monkeypatch.setattr(
        "dns.query.quic",
        lambda q, where, timeout, port, server_hostname: _fake_quic_response(),
    )
    result = run_doq_query("1.1.1.1", "example.com", 2.0, "dns.quad9.net")
    assert result["ok"] is True
    assert result["ms"] is not None
    assert result["failure_kind"] is None
    assert result["answer_ips"] == ["93.184.216.34"]


def test_run_doq_query_timeout(monkeypatch) -> None:
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: True)

    def fake_quic(q, where, **kwargs):
        del q, where, kwargs
        raise dns.exception.Timeout("DoQ timeout")

    monkeypatch.setattr("dns.query.quic", fake_quic)
    result = run_doq_query("1.1.1.1", "example.com", 2.0, "dns.quad9.net")
    assert result["ok"] is False
    assert result["ms"] is None
    assert result["failure_kind"] == "timeout"


def test_run_doq_query_no_quic(monkeypatch) -> None:
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: False)
    result = run_doq_query("1.1.1.1", "example.com", 2.0, "dns.quad9.net")
    assert result["ok"] is False
    assert result["ms"] is None
    assert result["failure_kind"] == "doq_unavailable"


def test_run_doq_query_no_doq_exception(monkeypatch) -> None:
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: True)

    def fake_quic(q, where, **kwargs):
        del q, where, kwargs
        raise dns.query.NoDOQ()

    monkeypatch.setattr("dns.query.quic", fake_quic)
    result = run_doq_query("1.1.1.1", "example.com", 2.0, "dns.quad9.net")
    assert result["ok"] is False
    assert result["failure_kind"] == "doq_unavailable"


def test_build_config_rejects_doq_without_quic(monkeypatch, tmp_path) -> None:
    manager = BenchmarkManager(max_concurrent_jobs=1, max_queued_jobs=1, data_runs_dir=tmp_path / "runs")
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: False)
    with pytest.raises(ValueError, match="DoQ"):
        manager.start(
            BenchmarkRequest(
                runs=1,
                timeout_sec=1.0,
                resolvers=["1.1.1.1"],
                queries=["example.com"],
                protocol="doq",
            )
        )


def test_benchmark_run_doq_protocol(monkeypatch, tmp_path) -> None:
    """Full benchmark run with DoQ protocol succeeds and records protocol+engine."""
    manager = BenchmarkManager(max_concurrent_jobs=1, max_queued_jobs=1, data_runs_dir=tmp_path / "runs")

    def fake_measure(self, *, resolver, domain, config, engine):
        del self, config, engine
        return {
            "ok": True,
            "ms": 19.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "answer_ips": ["93.184.216.34"],
            "resolver": resolver,
        }

    monkeypatch.setattr("app.runner.dns_quic_available", lambda: True)
    monkeypatch.setattr(BenchmarkManager, "_measure_with_protocol", fake_measure)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")
    manager.blocking_test_queries = []

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=2,
            timeout_sec=2.0,
            resolvers=["9.9.9.9"],
            queries=["example.com"],
            protocol="doq",
        )
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"
    assert state["protocol"] == "doq"
    assert len(state["results"]) == 1
    for result in state["results"]:
        assert result["protocol"] == "doq"
        assert result["engine"] == "dnspython"


def test_health_reports_capabilities() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert "capabilities" in body
    assert body["capabilities"]["doq"] is dns_quic_available()
