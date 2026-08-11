from __future__ import annotations

import hashlib
import json
from time import sleep

from app.models import BenchmarkGoal, BenchmarkRequest
from app.runner import BenchmarkManager, _canonical_json_sha256


def _make_manager(tmp_path) -> BenchmarkManager:
    return BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        terminal_ttl_sec=600,
        data_runs_dir=tmp_path / "runs",
    )


def _wait_terminal(manager: BenchmarkManager, benchmark_id: str, timeout_sec: float = 5.0) -> dict:
    deadline = timeout_sec / 0.01
    for _ in range(int(deadline)):
        state = manager.get(benchmark_id)
        if state and state["status"] in {"done", "failed", "cancelled"}:
            return state
        sleep(0.01)
    raise AssertionError("benchmark did not reach a terminal state")


def _fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
    del timeout_sec, engine
    return {
        "ok": True,
        "ms": 15.0,
        "query": domain,
        "error": None,
        "failure_kind": None,
        "resolver": resolver,
    }


def _fake_measure_query_schedule(resolver: str, domain: str) -> dict:
    if domain in {"blocked.test", "b.com"}:
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": "blocked",
            "failure_kind": "nxdomain",
            "resolver": resolver,
            "answer_ips": [],
        }
    return {
        "ok": True,
        "ms": 15.0,
        "query": domain,
        "error": None,
        "failure_kind": None,
        "resolver": resolver,
        "answer_ips": [],
    }


def _install_mocked_dns(manager: BenchmarkManager, monkeypatch, *, schedule_aware: bool = False) -> None:
    measure = _fake_measure_query_schedule if schedule_aware else _fake_measure_query
    monkeypatch.setattr("app.runner.measure_query", measure)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")
    manager.blocking_test_queries = []


def test_manifest_round_trip_is_byte_stable_through_canonical_persistence(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    _install_mocked_dns(manager, monkeypatch)

    benchmark_id = manager.start(
        BenchmarkRequest(runs=3, timeout_sec=1.0, resolvers=["1.1.1.1"], queries=["a.com", "b.com"])
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"

    manifest = state["manifest"]
    assert manifest is not None
    assert manifest["run_manifest_version"] == 1
    assert manifest["response_semantics_version"] == "dns-response-v1"
    assert manifest["scoring_semantics_version"] == "score-v1"
    assert manifest["normal_query_schedule_version"] == "round-robin-v1"
    assert manifest["diagnostic_policy_version"] == "random-nxdomain-v1"
    assert manifest["runs"] == 3
    assert manifest["normal_query_count"] == 3
    assert manifest["protocol"] == "udp"
    assert manifest["mode"] == "standard"
    assert manifest["timeout_sec"] == 1.0
    assert manifest["scoring_profile"] == "speed"

    fresh_manager = _make_manager(tmp_path)
    restored = fresh_manager.get(benchmark_id)
    assert restored is not None
    assert restored["manifest"] == manifest
    assert json.dumps(restored["manifest"], sort_keys=True) == json.dumps(manifest, sort_keys=True)


def test_equivalent_normalized_requests_produce_identical_manifest(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    _install_mocked_dns(manager, monkeypatch)

    first = manager.start(
        BenchmarkRequest(
            runs=4,
            timeout_sec=1.0,
            resolvers=["1.1.1.1"],
            queries=["Example.com", "B.com"],
            scoring_profile=BenchmarkGoal.speed,
        )
    )
    second = manager.start(
        BenchmarkRequest(
            runs=4,
            timeout_sec=1.0,
            resolvers=["1.1.1.1"],
            queries=["example.com", "b.com"],
            scoring_profile=BenchmarkGoal.speed,
        )
    )

    first_state = _wait_terminal(manager, first)
    second_state = _wait_terminal(manager, second)
    assert first_state["manifest"] == second_state["manifest"]
    assert json.dumps(first_state["manifest"], sort_keys=True) == json.dumps(
        second_state["manifest"], sort_keys=True
    )


def test_cyclic_schedule_hash_and_count_freeze_the_effective_sequence(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    _install_mocked_dns(manager, monkeypatch, schedule_aware=True)

    benchmark_id = manager.start(
        BenchmarkRequest(runs=5, timeout_sec=1.0, resolvers=["1.1.1.1"], queries=["a.com", "b.com"])
    )
    state = _wait_terminal(manager, benchmark_id)
    manifest = state["manifest"]
    assert manifest is not None

    schedule = ["a.com", "b.com", "a.com", "b.com", "a.com"]
    expected = hashlib.sha256(
        json.dumps(schedule, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    assert manifest["normal_query_plan_sha256"] == expected
    assert manifest["normal_query_count"] == 5

    other = hashlib.sha256(
        json.dumps(["a.com", "b.com", "a.com", "b.com"], ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()
    assert expected != other


def test_manifest_hashes_loaded_blocking_domains_and_is_frozen_at_start(monkeypatch, tmp_path) -> None:
    manager = _make_manager(tmp_path)
    monkeypatch.setattr("app.runner.measure_query", _fake_measure_query_schedule)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")
    manager.blocking_test_queries = ["blocked.test", "ads.example"]

    benchmark_id = manager.start(
        BenchmarkRequest(runs=2, timeout_sec=1.0, resolvers=["1.1.1.1"], queries=["a.com"])
    )
    expected = hashlib.sha256(
        json.dumps(["blocked.test", "ads.example"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    state = _wait_terminal(manager, benchmark_id)
    manifest = state["manifest"]
    assert manifest is not None
    assert manifest["blocking_query_plan_sha256"] == expected
    assert manifest["blocking_query_count"] == 2

    manager.blocking_test_queries = ["changed.example"]
    after_change = manager.get(benchmark_id)
    assert after_change is not None
    assert after_change["manifest"]["blocking_query_plan_sha256"] == expected


def test_provider_index_serialization_is_byte_stable_and_order_sensitive() -> None:
    index = {
        "9.9.9.9": {
            "id": "quad9",
            "dns": ["9.9.9.9", "149.112.112.112"],
            "features": {"doh": "no", "dot": "yes", "dot_hostname": "dns.quad9.net"},
        },
        "1.1.1.1": {"id": "cloudflare", "dns": ["1.1.1.1"], "features": {"doh": "yes"}},
    }
    first = _canonical_json_sha256(index, sort_keys=True)
    second = _canonical_json_sha256(dict(reversed(list(index.items()))), sort_keys=True)
    assert first == second

    mutated = dict(index)
    mutated["1.1.1.1"]["features"] = {"doh": "no"}
    assert _canonical_json_sha256(mutated, sort_keys=True) != first

    changed_list = dict(index)
    changed_list["9.9.9.9"]["dns"] = ["149.112.112.112", "9.9.9.9"]
    assert _canonical_json_sha256(changed_list, sort_keys=True) != first
