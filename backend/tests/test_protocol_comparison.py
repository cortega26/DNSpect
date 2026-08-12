from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import (
    BenchmarkRequest,
    ProtocolComparisonRequest,
    TargetSnapshot,
)
from app.runner import BenchmarkManager, ProtocolComparisonState, _canonical_json_sha256

client = TestClient(app)

CLOUDFLARE = "1.1.1.1"
QUAD9 = "9.9.9.9"
COMODO = "8.20.247.20"

FEATURED_INDEX = {
    CLOUDFLARE: {
        "id": "cloudflare",
        "features": {
            "dot_hostname": "one.one.one.one",
            "doh_url": "https://cloudflare-dns.com/dns-query",
        },
    },
    QUAD9: {
        "id": "quad9",
        "features": {
            "dot_hostname": "dns.quad9.net",
            "doh_url": "https://dns.quad9.net/dns-query",
            "doq_hostname": "dns.quad9.net",
        },
    },
    COMODO: {
        "id": "comodo",
        "features": {
            "dot_hostname": "dot.example.com",
        },
    },
}


def _make_manager(tmp_path) -> BenchmarkManager:
    manager = BenchmarkManager(
        max_concurrent_jobs=2,
        max_queued_jobs=2,
        terminal_ttl_sec=600,
        data_runs_dir=tmp_path / "runs",
    )
    manager.provider_index = dict(FEATURED_INDEX)
    manager.blocking_test_queries = []
    return manager


def _target(resolver_ips: list[str] | None = None) -> TargetSnapshot:
    return TargetSnapshot(
        resolver_ips=resolver_ips or [CLOUDFLARE, QUAD9],
        selection_source="manual",
        provider_ids={ip: FEATURED_INDEX[ip]["id"] for ip in (resolver_ips or [CLOUDFLARE, QUAD9])},
    )


def _request(**overrides) -> dict:
    payload = {
        "protocols": ["udp", "dot"],
        "target_snapshot": _target().model_dump(),
        "scoring_profile": "speed",
        "mode": "standard",
        "queries": ["a.com", "b.com"],
        "runs": 2,
        "timeout_sec": 1.0,
    }
    payload.update(overrides)
    return payload


def _sample(resolver: str, domain: str, ms: float, *, failure_kind: str | None = None) -> dict:
    sample = {
        "ok": failure_kind is None,
        "ms": None if failure_kind is not None else ms,
        "query": domain,
        "error": None if failure_kind is None else "failure",
        "failure_kind": failure_kind,
        "resolver": resolver,
        "answer_ips": [] if failure_kind is not None else ["203.0.113.1"],
    }
    return sample


def _install_mocks(monkeypatch, *, latency: float = 15.0, fail_protocol: str | None = None) -> None:
    """Mock all three transports; optional transport-level failure for one protocol."""

    def fail_for(protocol: str, domain: str) -> bool:
        return fail_protocol == protocol and not domain.endswith(".dnspect.invalid")

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        if domain.endswith(".dnspect.invalid"):
            return _sample(resolver, domain, 0.0, failure_kind="nxdomain")
        if domain == "badsig.go.dnscheck.tools":
            return _sample(resolver, domain, 0.0, failure_kind="servfail")
        if fail_for("udp", domain):
            raise RuntimeError("udp transport exploded")
        return _sample(resolver, domain, latency)

    def fake_dot(resolver: str, domain: str, timeout_sec: float, dot_hostname: str) -> dict:
        del timeout_sec, dot_hostname
        if domain.endswith(".dnspect.invalid"):
            return _sample(resolver, domain, 0.0, failure_kind="nxdomain")
        if domain == "badsig.go.dnscheck.tools":
            return _sample(resolver, domain, 0.0, failure_kind="servfail")
        if fail_for("dot", domain):
            raise RuntimeError("dot transport exploded")
        return _sample(resolver, domain, latency * 0.8)

    def fake_doh(resolver: str, domain: str, timeout_sec: float, doh_url: str) -> dict:
        del timeout_sec, doh_url
        if domain.endswith(".dnspect.invalid"):
            return _sample(resolver, domain, 0.0, failure_kind="nxdomain")
        if domain == "badsig.go.dnscheck.tools":
            return _sample(resolver, domain, 0.0, failure_kind="servfail")
        if fail_for("doh", domain):
            raise RuntimeError("doh transport exploded")
        return _sample(resolver, domain, latency * 1.4)

    def fake_doq(resolver: str, domain: str, timeout_sec: float, doq_hostname: str | None) -> dict:
        del timeout_sec, doq_hostname
        if domain.endswith(".dnspect.invalid"):
            return _sample(resolver, domain, 0.0, failure_kind="nxdomain")
        if domain == "badsig.go.dnscheck.tools":
            return _sample(resolver, domain, 0.0, failure_kind="servfail")
        if fail_for("doq", domain):
            raise RuntimeError("doq transport exploded")
        return _sample(resolver, domain, latency * 1.7)

    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr("app.runner.run_dot_query", fake_dot)
    monkeypatch.setattr("app.runner.run_doh_query", fake_doh)
    monkeypatch.setattr("app.runner.run_doq_query", fake_doq)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")


def _sync_executor(manager: BenchmarkManager, monkeypatch) -> list:
    """Capture executor tasks and run them synchronously; asserts one submission."""
    tasks: list = []

    def fake_submit(fn, *args, **kwargs):
        tasks.append((fn, args, kwargs))
        return None

    monkeypatch.setattr(manager._executor, "submit", fake_submit)
    return tasks


def _run_tasks(tasks: list) -> None:
    for fn, args, kwargs in tasks:
        fn(*args, **kwargs)


def _install_manager(monkeypatch, tmp_path) -> BenchmarkManager:
    manager = _make_manager(tmp_path)
    monkeypatch.setattr("app.main.manager", manager)
    return manager


# ---- Request validation (422) -------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {"protocols": ["udp", "udp", "dot"]},
        {"protocols": ["udp"]},
        {"protocols": ["udp", "dot", "doh", "udp"]},
        {"protocols": ["tcp"]},
        {"target_snapshot": {"resolver_ips": ["not-an-ip"], "selection_source": "manual"}},
        {"target_snapshot": {"resolver_ips": [], "selection_source": "manual"}},
        {"queries": ["bad domain!"]},
        {"runs": 0},
        {"timeout_sec": 20},
        {"resolvers": ["1.1.1.1"]},
    ],
)
def test_protocol_comparison_request_schema_rejects(payload: dict) -> None:
    body = _request()
    body.update(payload)
    response = client.post("/api/protocol-comparisons/preflight", json=body)
    assert response.status_code == 422, payload


def test_protocol_comparison_request_accepts_canonical_payload() -> None:
    response = client.post("/api/protocol-comparisons/preflight", json=_request())
    assert response.status_code == 200


def test_comparison_canonical_order_with_doq() -> None:
    request = ProtocolComparisonRequest.model_validate(
        {
            "protocols": ["doq", "udp", "doh", "dot"],
            "target_snapshot": _target().model_dump(),
            "scoring_profile": "speed",
        }
    )
    assert [protocol.value for protocol in request.protocols] == ["udp", "dot", "doh", "doq"]


# ---- Preflight contract --------------------------------------------------------


def test_preflight_normalizes_protocol_order_and_common_snapshot(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)
    body = _request(protocols=["doh", "udp"], target_snapshot=_target([CLOUDFLARE, QUAD9]).model_dump())

    response = client.post("/api/protocol-comparisons/preflight", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["canonical_protocols"] == ["udp", "doh"]
    assert payload["requested_target_snapshot"]["resolver_ips"] == [CLOUDFLARE, QUAD9]
    assert payload["common_eligible_target_snapshot"]["resolver_ips"] == [CLOUDFLARE, QUAD9]
    assert payload["common_eligible_target_snapshot"]["provider_ids"] == {
        CLOUDFLARE: "cloudflare",
        QUAD9: "quad9",
    }
    assert payload["endpoint_identities"] == [
        {
            "resolver": CLOUDFLARE,
            "udp_resolver_ip": CLOUDFLARE,
            "dot_hostname": None,
            "doh_url": "https://cloudflare-dns.com/dns-query",
        },
        {
            "resolver": QUAD9,
            "udp_resolver_ip": QUAD9,
            "dot_hostname": None,
            "doh_url": "https://dns.quad9.net/dns-query",
        },
    ]
    assert payload["admissible"] is True
    assert payload["admission_reason_codes"] == []
    assert payload["effective_runs"] == 2
    assert payload["normal_query_count"] == 2
    assert manager._protocol_comparison_states == {}
    assert not (tmp_path / "runs" / "protocol-comparisons").exists()


def test_preflight_excludes_in_target_then_protocol_order(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    body = _request(
        target_snapshot=_target([CLOUDFLARE, COMODO, QUAD9]).model_dump(),
        protocols=["udp", "dot", "doh"],
    )

    response = client.post("/api/protocol-comparisons/preflight", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["common_eligible_target_snapshot"]["resolver_ips"] == [CLOUDFLARE, QUAD9]
    assert payload["exclusions"] == [
        {"resolver": COMODO, "protocol": "doh", "code": "doh_url_missing"},
    ]
    assert payload["endpoint_identities"] == [
        {
            "resolver": CLOUDFLARE,
            "udp_resolver_ip": CLOUDFLARE,
            "dot_hostname": "one.one.one.one",
            "doh_url": "https://cloudflare-dns.com/dns-query",
        },
        {
            "resolver": QUAD9,
            "udp_resolver_ip": QUAD9,
            "dot_hostname": "dns.quad9.net",
            "doh_url": "https://dns.quad9.net/dns-query",
        },
    ]


def test_preflight_unrequested_transport_endpoint_is_null(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    response = client.post("/api/protocol-comparisons/preflight", json=_request(protocols=["udp", "dot"]))
    assert response.status_code == 200
    payload = response.json()
    identity = payload["endpoint_identities"][0]
    assert identity["dot_hostname"] == "one.one.one.one"
    assert identity["doh_url"] is None


def test_comparison_doq_excludes_resolvers_without_endpoint(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: True)
    body = _request(
        protocols=["udp", "doq"],
        target_snapshot=_target([QUAD9, COMODO]).model_dump(),
    )

    response = client.post("/api/protocol-comparisons/preflight", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["canonical_protocols"] == ["udp", "doq"]
    assert payload["common_eligible_target_snapshot"]["resolver_ips"] == [QUAD9]
    assert payload["common_eligible_target_snapshot"]["provider_ids"] == {QUAD9: "quad9"}
    assert payload["exclusions"] == [
        {"resolver": COMODO, "protocol": "doq", "code": "doq_hostname_missing"},
    ]
    assert payload["endpoint_identities"] == [
        {
            "resolver": QUAD9,
            "udp_resolver_ip": QUAD9,
            "dot_hostname": None,
            "doh_url": None,
        },
    ]
    assert payload["admissible"] is True
    assert manager._protocol_comparison_states == {}


def test_comparison_doq_unavailable_excludes_all(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: False)
    body = _request(
        protocols=["udp", "doq"],
        target_snapshot=_target([CLOUDFLARE, QUAD9]).model_dump(),
    )

    response = client.post("/api/protocol-comparisons/preflight", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["common_eligible_target_snapshot"] is None
    assert payload["endpoint_identities"] == []
    assert payload["exclusions"] == [
        {"resolver": CLOUDFLARE, "protocol": "doq", "code": "doq_unavailable"},
        {"resolver": QUAD9, "protocol": "doq", "code": "doq_unavailable"},
    ]
    assert payload["admissible"] is False
    assert payload["admission_reason_codes"] == ["no_common_targets"]
    assert manager._protocol_comparison_states == {}


def test_preflight_no_common_targets_is_admissible_false(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)
    manager.provider_index = {}
    body = _request(protocols=["udp", "dot"], target_snapshot=_target([CLOUDFLARE, QUAD9]).model_dump())

    response = client.post("/api/protocol-comparisons/preflight", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["common_eligible_target_snapshot"] is None
    assert payload["endpoint_identities"] == []
    assert payload["admissible"] is False
    assert payload["admission_reason_codes"] == ["no_common_targets"]


def test_preflight_no_common_reason_code_alone(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)
    manager.provider_index = {}
    body = _request(protocols=["udp", "dot"], target_snapshot=_target([CLOUDFLARE, QUAD9]).model_dump())

    response = client.post("/api/protocol-comparisons/preflight", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["admissible"] is False
    assert payload["admission_reason_codes"] == ["no_common_targets"]


def test_preflight_budget_reason_codes(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)
    manager.max_query_attempts = 5
    response = client.post("/api/protocol-comparisons/preflight", json=_request())
    assert response.status_code == 200
    assert response.json()["admission_reason_codes"] == ["attempt_budget_exceeded"]

    manager.max_query_attempts = 100000
    manager.max_estimated_duration_sec = 1
    response = client.post("/api/protocol-comparisons/preflight", json=_request())
    assert response.status_code == 200
    assert response.json()["admission_reason_codes"] == ["duration_budget_exceeded"]


# ---- Start admission -----------------------------------------------------------


def test_start_rejects_inadmissible_before_enqueueing(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)
    manager.provider_index = {}
    body = _request(protocols=["udp", "dot"], target_snapshot=_target([CLOUDFLARE, QUAD9]).model_dump())

    response = client.post("/api/protocol-comparisons", json=body)
    assert response.status_code == 400
    assert manager._protocol_comparison_states == {}
    assert not (tmp_path / "runs" / "protocol-comparisons").exists()


def test_start_rolls_back_when_executor_submission_fails(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)

    def failing_submit(*args, **kwargs):
        del args, kwargs
        raise RuntimeError("executor closed")

    monkeypatch.setattr(manager._executor, "submit", failing_submit)
    response = client.post("/api/protocol-comparisons", json=_request())
    assert response.status_code == 400
    assert manager._protocol_comparison_states == {}
    assert not (tmp_path / "runs" / "protocol-comparisons").exists()


def test_comparison_and_benchmark_share_queue_capacity(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    manager.max_concurrent_jobs = 1
    manager.max_queued_jobs = 1
    tasks = _sync_executor(manager, monkeypatch)
    _install_mocks(monkeypatch)

    benchmark_id = manager.start(
        BenchmarkRequest(runs=1, timeout_sec=1.0, resolvers=[CLOUDFLARE], queries=["a.com"])
    )
    assert benchmark_id
    comparison_id = manager.start_protocol_comparison(ProtocolComparisonRequest.model_validate(_request()))
    assert comparison_id

    with pytest.raises(ValueError, match="Capacidad de benchmark agotada"):
        manager.start_protocol_comparison(ProtocolComparisonRequest.model_validate(_request()))
    with pytest.raises(ValueError, match="Capacidad de benchmark agotada"):
        manager.start(BenchmarkRequest(runs=1, timeout_sec=1.0, resolvers=[CLOUDFLARE], queries=["a.com"]))
    assert len(tasks) == 2


# ---- Execution -----------------------------------------------------------------


def test_comparison_runs_canonical_order_and_completes(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    tasks = _sync_executor(manager, monkeypatch)
    _install_mocks(monkeypatch)

    comparison_id = manager.start_protocol_comparison(
        ProtocolComparisonRequest.model_validate(_request(protocols=["doh", "udp"]))
    )
    assert len(tasks) == 1
    assert manager.get_protocol_comparison(comparison_id).status == "queued"
    assert not (tmp_path / "runs" / "protocol-comparisons" / f"{comparison_id}.json").exists()

    _run_tasks(tasks)
    state = manager.get_protocol_comparison(comparison_id)
    assert state.status == "done"
    assert state.complete is True
    assert state.error is None
    assert [subrun["protocol"] for subrun in state.subruns] == ["udp", "doh"]
    assert all(subrun["status"] == "done" for subrun in state.subruns)
    assert state.progress_current == state.progress_total
    assert state.progress_current > 0
    assert len(state.delta_pairs) == 1
    pair = state.delta_pairs[0]
    assert pair["baseline_protocol"] == "udp"
    assert pair["candidate_protocol"] == "doh"
    assert [row["resolver"] for row in pair["rows"]] == [CLOUDFLARE, QUAD9]
    cloudflare_row = pair["rows"][0]
    assert cloudflare_row["baseline"] is not None
    assert cloudflare_row["candidate"] is not None
    assert cloudflare_row["deltas"]["median_ms"] == round(15.0 * 1.4 - 15.0, 4)
    assert cloudflare_row["deltas"]["score_total"] is not None
    assert state.manifest["diagnostic_policy_version"] == "protocol-v1"
    assert state.manifest["canonical_protocols"] == ["udp", "doh"]


def test_comparison_full_cycle_with_doq(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    tasks = _sync_executor(manager, monkeypatch)
    _install_mocks(monkeypatch)
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: True)

    comparison_id = manager.start_protocol_comparison(
        ProtocolComparisonRequest.model_validate(
            _request(protocols=["doq", "udp", "doh", "dot"], target_snapshot=_target([QUAD9]).model_dump())
        )
    )
    assert len(tasks) == 1
    _run_tasks(tasks)
    state = manager.get_protocol_comparison(comparison_id)
    assert state.status == "done"
    assert state.complete is True
    assert [subrun["protocol"] for subrun in state.subruns] == ["udp", "dot", "doh", "doq"]
    assert all(subrun["status"] == "done" for subrun in state.subruns)
    assert state.manifest["manifest_version"] == 2
    assert state.manifest["canonical_protocols"] == ["udp", "dot", "doh", "doq"]
    assert [pair["candidate_protocol"] for pair in state.delta_pairs] == ["dot", "doh", "doq"]
    udp_doh_pair = state.delta_pairs[1]
    assert udp_doh_pair["baseline_protocol"] == "udp"
    assert udp_doh_pair["candidate_protocol"] == "doh"
    udp_doq_pair = state.delta_pairs[2]
    assert udp_doq_pair["baseline_protocol"] == "udp"
    assert udp_doq_pair["candidate_protocol"] == "doq"
    row = udp_doq_pair["rows"][0]
    assert row["resolver"] == QUAD9
    assert row["baseline"] is not None
    assert row["candidate"] is not None
    assert row["deltas"]["median_ms"] == round(15.0 * 1.7 - 15.0, 4)


def test_manifest_version_bumped_to_2(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    tasks = _sync_executor(manager, monkeypatch)
    _install_mocks(monkeypatch)
    monkeypatch.setattr("app.runner.dns_quic_available", lambda: True)

    comparison_id = manager.start_protocol_comparison(
        ProtocolComparisonRequest.model_validate(
            _request(protocols=["udp", "doq"], target_snapshot=_target([QUAD9]).model_dump())
        )
    )
    _run_tasks(tasks)

    path = tmp_path / "runs" / "protocol-comparisons" / f"{comparison_id}.json"
    assert path.exists()
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["manifest"]["manifest_version"] == 2
    assert raw["manifest"]["canonical_protocols"] == ["udp", "doq"]
    assert [subrun["protocol"] for subrun in raw["subruns"]] == ["udp", "doq"]


def test_comparison_uses_fixed_diagnostic_domain_across_subruns(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    tasks = _sync_executor(manager, monkeypatch)
    seen_domains: dict[str, set] = {"udp": set(), "doh": set()}

    def fake_doh(resolver, domain, timeout_sec, doh_url):
        del resolver, timeout_sec, doh_url
        if domain.endswith(".dnspect.invalid"):
            seen_domains["doh"].add(domain)
            return _sample("x", domain, 0.0, failure_kind="nxdomain")
        if domain == "badsig.go.dnscheck.tools":
            return _sample("x", domain, 0.0, failure_kind="servfail")
        return _sample("x", domain, 20.0)

    def fake_measure_query(*, resolver, domain, timeout_sec, engine):
        del resolver, timeout_sec, engine
        if domain.endswith(".dnspect.invalid"):
            seen_domains["udp"].add(domain)
            return _sample("x", domain, 0.0, failure_kind="nxdomain")
        if domain == "badsig.go.dnscheck.tools":
            return _sample("x", domain, 0.0, failure_kind="servfail")
        return _sample("x", domain, 15.0)

    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr(
        "app.runner.run_dot_query", lambda *a, **k: _sample("x", "q", 0.0, failure_kind="nxdomain")
    )
    monkeypatch.setattr("app.runner.run_doh_query", fake_doh)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")

    comparison_id = manager.start_protocol_comparison(
        ProtocolComparisonRequest.model_validate(_request(protocols=["udp", "doh"]))
    )
    _run_tasks(tasks)
    assert len(seen_domains["udp"]) == 1
    assert len(seen_domains["doh"]) == 1
    assert seen_domains["udp"] == seen_domains["doh"]
    domain = seen_domains["udp"].pop()
    assert domain.endswith(".dnspect.invalid")
    state = manager.get_protocol_comparison(comparison_id)
    assert state.manifest["diagnostic_plan_sha256"] == _canonical_json_sha256(domain)


def test_transport_failure_continues_later_protocols_with_null_deltas(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    tasks = _sync_executor(manager, monkeypatch)
    _install_mocks(monkeypatch, fail_protocol="dot")

    comparison_id = manager.start_protocol_comparison(
        ProtocolComparisonRequest.model_validate(_request(protocols=["udp", "dot", "doh"]))
    )
    _run_tasks(tasks)
    state = manager.get_protocol_comparison(comparison_id)
    assert state.status == "done"
    assert state.complete is False
    assert [subrun["status"] for subrun in state.subruns] == ["done", "failed", "done"]
    failed = state.subruns[1]
    assert failed["error"] == {"code": "transport_execution_failed", "message": "dot transport exploded"}
    assert state.progress_current < state.progress_total

    pairs = state.delta_pairs
    assert [pair["candidate_protocol"] for pair in pairs] == ["dot", "doh"]
    dot_pair = pairs[0]
    assert dot_pair["baseline_protocol"] == "udp"
    for row in dot_pair["rows"]:
        assert row["baseline"] is not None
        assert row["candidate"] is None
        assert all(value is None for value in row["deltas"].values())
    doh_pair = pairs[1]
    for row in doh_pair["rows"]:
        assert row["baseline"] is not None
        assert row["candidate"] is not None
        assert row["deltas"]["median_ms"] is not None


# ---- Persistence ---------------------------------------------------------------


def test_terminal_persistence_reload_and_history_exclusion(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    tasks = _sync_executor(manager, monkeypatch)
    _install_mocks(monkeypatch)

    comparison_id = manager.start_protocol_comparison(ProtocolComparisonRequest.model_validate(_request()))
    _run_tasks(tasks)

    path = tmp_path / "runs" / "protocol-comparisons" / f"{comparison_id}.json"
    assert path.exists()
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["status"] == "done"
    for subrun in raw["subruns"]:
        for result in subrun["results"]:
            assert result["samples"] == []
            assert result["sample_count"] == 2

    fresh = _make_manager(tmp_path)
    reloaded = fresh.get_protocol_comparison(comparison_id)
    assert reloaded is not None
    assert reloaded.status == "done"
    assert reloaded.complete is True
    assert len(reloaded.delta_pairs) == 1
    assert fresh.list_history()["runs"] == []


def test_invalid_comparison_ids_never_reach_disk(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    for invalid in ("preflight", "not-a-uuid", str(uuid.uuid4()), str(uuid.uuid4()).upper(), "g" * 32):
        assert manager.get_protocol_comparison(invalid) is None, invalid
    assert not (tmp_path / "runs" / "protocol-comparisons").exists()


def test_terminal_write_failure_is_non_fatal_storage_warning(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    tasks = _sync_executor(manager, monkeypatch)
    _install_mocks(monkeypatch)

    def failing_write(path, payload):
        del path, payload
        raise PermissionError("read-only file system")

    monkeypatch.setattr(manager, "_write_json_file", failing_write)
    comparison_id = manager.start_protocol_comparison(ProtocolComparisonRequest.model_validate(_request()))
    _run_tasks(tasks)
    state = manager.get_protocol_comparison(comparison_id)
    assert state.status == "done"
    assert state.complete is True
    assert state.run_storage_warning is not None
    assert "PermissionError" in state.run_storage_warning


# ---- Routes --------------------------------------------------------------------


def test_routes_preflight_start_status_flow(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)
    tasks = _sync_executor(manager, monkeypatch)
    _install_mocks(monkeypatch)

    preflight = client.post("/api/protocol-comparisons/preflight", json=_request())
    assert preflight.status_code == 200
    preflight_body = preflight.json()
    for field in (
        "canonical_protocols",
        "requested_target_snapshot",
        "common_eligible_target_snapshot",
        "exclusions",
        "endpoint_identities",
        "normal_query_plan_sha256",
        "normal_query_count",
        "blocking_query_plan_sha256",
        "blocking_query_count",
        "effective_runs",
        "timeout_sec",
        "total_attempts",
        "estimated_duration_sec",
        "admissible",
        "admission_reason_codes",
    ):
        assert field in preflight_body, field

    start = client.post("/api/protocol-comparisons", json=_request())
    assert start.status_code == 200
    comparison_id = start.json()["comparison_id"]
    assert uuid.UUID(comparison_id).version == 4

    status = client.get(f"/api/protocol-comparisons/{comparison_id}")
    assert status.status_code == 200
    status_body = status.json()
    assert status_body["status"] == "queued"
    for field in (
        "comparison_id",
        "status",
        "complete",
        "error",
        "run_storage_warning",
        "progress",
        "manifest",
        "exclusions",
        "subruns",
        "delta_pairs",
    ):
        assert field in status_body, field

    _run_tasks(tasks)
    done = client.get(f"/api/protocol-comparisons/{comparison_id}")
    assert done.status_code == 200
    done_body = done.json()
    assert done_body["status"] == "done"
    assert done_body["complete"] is True
    assert done_body["progress"]["current"] == done_body["progress"]["total"]
    assert done_body["subruns"][0]["protocol"] == "udp"
    assert done_body["delta_pairs"][0]["baseline_protocol"] == "udp"


def test_static_preflight_route_never_captured_as_comparison_id(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    response = client.get("/api/protocol-comparisons/preflight")
    assert response.status_code == 404

    invalid = client.get(f"/api/protocol-comparisons/{uuid.uuid4()}")
    assert invalid.status_code == 404


def test_comparison_terminal_cleanup_bounds_in_memory_states(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    manager.terminal_ttl_sec = 1
    manager.max_retained_states = 1
    old_finished = (datetime.now(UTC) - timedelta(seconds=120)).isoformat()
    recent_finished = datetime.now(UTC).isoformat()
    with manager._lock:
        manager._protocol_comparison_states["old"] = ProtocolComparisonState(
            comparison_id="old",
            status="done",
            started_at=old_finished,
            finished_at=old_finished,
            progress_total=1,
        )
        manager._protocol_comparison_states["fresh"] = ProtocolComparisonState(
            comparison_id="fresh",
            status="done",
            started_at=recent_finished,
            finished_at=recent_finished,
            progress_total=1,
        )
    manager._cleanup_protocol_comparison_states_locked()
    assert manager.get_protocol_comparison("old") is None
    assert manager.get_protocol_comparison("fresh") is not None
