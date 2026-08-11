from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.runner import BenchmarkManager, BenchmarkState

client = TestClient(app)

MANIFEST_VERSION = 1
RESPONSE_SEMANTICS_VERSION = "dns-response-v1"
SCORING_SEMANTICS_VERSION = "score-v1"
NORMAL_QUERY_SCHEDULE_VERSION = "round-robin-v1"
DIAGNOSTIC_POLICY_VERSION = "random-nxdomain-v1"

CLOUDFLARE = "1.1.1.1"
QUAD9 = "9.9.9.9"


def _make_manager(tmp_path) -> BenchmarkManager:
    return BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        terminal_ttl_sec=600,
        data_runs_dir=tmp_path / "runs",
    )


def _manifest(**overrides) -> dict:
    manifest = {
        "run_manifest_version": MANIFEST_VERSION,
        "response_semantics_version": RESPONSE_SEMANTICS_VERSION,
        "scoring_semantics_version": SCORING_SEMANTICS_VERSION,
        "scoring_profile": "speed",
        "target_snapshot": {
            "resolver_ips": [CLOUDFLARE, QUAD9],
            "selection_source": "manual",
            "provider_ids": None,
        },
        "protocol": "udp",
        "mode": "standard",
        "runs": 30,
        "timeout_sec": 2.0,
        "normal_query_schedule_version": NORMAL_QUERY_SCHEDULE_VERSION,
        "normal_query_plan_sha256": "a" * 64,
        "normal_query_count": 30,
        "blocking_query_plan_sha256": "b" * 64,
        "blocking_query_count": 9,
        "diagnostic_policy_version": DIAGNOSTIC_POLICY_VERSION,
        "provider_catalog_sha256": "c" * 64,
    }
    manifest.update(overrides)
    return manifest


def _stats(median: float, score_total: float, **overrides) -> dict:
    stats = {
        "avg_ms": median,
        "median_ms": median,
        "p95_ms": round(median * 1.4, 3),
        "min_ms": round(median * 0.7, 3),
        "max_ms": round(median * 1.8, 3),
        "ok_count": 30,
        "timeout_count": 0,
        "success_rate": 1.0,
        "timeout_rate": 0.0,
        "success_count": 30,
        "failure_count": 0,
        "failure_rate": 0.0,
        "consistency_ratio": 0.9,
        "p95_minus_median_ms": round(median * 0.4, 3),
        "score_latency": median,
        "score_reliability": 0.0,
        "score_stability": round(median * 0.4, 3),
        "score_total": score_total,
        "blocking_efficacy": None,
        "blocked_count": 0,
        "blocking_test_count": 0,
        "score_blocking": None,
        "normalized_blocking": None,
    }
    stats.update(overrides)
    return stats


def _result(resolver: str, stats: dict) -> dict:
    provider = (
        {"provider_id": "cloudflare", "provider_name": "Cloudflare"}
        if resolver == CLOUDFLARE
        else {"provider_id": "quad9", "provider_name": "Quad9"}
    )
    return {
        "resolver": resolver,
        **provider,
        "engine": "drill",
        "protocol": "udp",
        "stats": stats,
        "samples": [],
    }


def _baseline_results() -> list[dict]:
    return [
        _result(CLOUDFLARE, _stats(12.3, 0.91)),
        _result(QUAD9, _stats(26.4, 0.97)),
    ]


def _candidate_results() -> list[dict]:
    return [
        _result(CLOUDFLARE, _stats(15.2, 0.95)),
        _result(QUAD9, _stats(20.1, 0.90)),
    ]


def _write_run(
    tmp_path, run_id: str, *, status: str = "done", manifest: dict | None = None, results: list | None = None
) -> None:
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    data: dict = {"id": run_id, "status": status}
    if manifest is not None:
        data["manifest"] = manifest
    if results is not None:
        data["results"] = results
    (runs_dir / f"{run_id}.json").write_text(json.dumps(data), encoding="utf-8")


def _write_comparable_pair(tmp_path) -> tuple[str, str]:
    baseline_id = uuid.uuid4().hex
    candidate_id = uuid.uuid4().hex
    _write_run(tmp_path, baseline_id, manifest=_manifest(), results=_baseline_results())
    # Candidate results are stored in reverse order: ranking must not trust stored order.
    _write_run(tmp_path, candidate_id, manifest=_manifest(), results=_candidate_results()[::-1])
    return baseline_id, candidate_id


def _install_manager(monkeypatch, tmp_path) -> BenchmarkManager:
    manager = _make_manager(tmp_path)
    monkeypatch.setattr("app.main.manager", manager)
    return manager


# ---- Route regression ---------------------------------------------------------


def test_compare_static_route_wins_over_dynamic_benchmark_id(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)
    state = BenchmarkState(
        id="compare",
        status="done",
        started_at=datetime.now(UTC).isoformat(),
        finished_at=datetime.now(UTC).isoformat(),
        progress_current=1,
        progress_total=1,
        mode="quick",
        timeout_sec=1.0,
        runs=1,
        engine="dnspython",
        results=[],
    )
    with manager._lock:
        manager._states["compare"] = state

    response = client.get("/api/benchmarks/compare")
    assert response.status_code == 404

    called: list[tuple[str, str]] = []
    original_compare = manager.compare_runs
    manager.compare_runs = lambda baseline, candidate: called.append(
        (baseline, candidate)
    ) or original_compare(baseline, candidate)
    baseline_id, candidate_id = _write_comparable_pair(tmp_path)
    response = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert response.status_code == 200
    assert called == [(baseline_id, candidate_id)]


@pytest.mark.parametrize(
    "invalid_id",
    [
        "",
        "not-a-uuid",
        str(uuid.uuid4()),
        str(uuid.uuid4()).upper(),
        uuid.uuid1().hex,
        "g" * 32,
        "1" * 32,
    ],
)
def test_compare_invalid_ids_return_404_before_any_manager_lookup(
    monkeypatch, tmp_path, invalid_id: str
) -> None:
    manager = _install_manager(monkeypatch, tmp_path)

    def unexpected_lookup(*args, **kwargs):
        raise AssertionError("manager lookup must not happen for invalid comparison ids")

    manager.get = unexpected_lookup  # type: ignore[method-assign]
    valid = uuid.uuid4().hex
    response = client.get(f"/api/benchmarks/compare?baseline_id={invalid_id}&candidate_id={valid}")
    assert response.status_code == 404, invalid_id


def test_compare_missing_run_returns_404(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    baseline_id, candidate_id = _write_comparable_pair(tmp_path)

    missing = client.get(
        f"/api/benchmarks/compare?baseline_id={uuid.uuid4().hex}&candidate_id={candidate_id}"
    )
    assert missing.status_code == 404
    valid = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert valid.status_code == 200


def test_compare_non_done_runs_return_409(monkeypatch, tmp_path) -> None:
    manager = _install_manager(monkeypatch, tmp_path)
    queued_id = uuid.uuid4().hex
    running_id = uuid.uuid4().hex
    done_id = uuid.uuid4().hex
    _write_run(tmp_path, done_id, manifest=_manifest(), results=_baseline_results())
    with manager._lock:
        manager._states[queued_id] = BenchmarkState(
            id=queued_id,
            status="queued",
            started_at=datetime.now(UTC).isoformat(),
            progress_current=0,
            progress_total=10,
            runs=10,
        )
        manager._states[running_id] = BenchmarkState(
            id=running_id,
            status="running",
            started_at=datetime.now(UTC).isoformat(),
            progress_current=2,
            progress_total=10,
            runs=10,
        )

    for non_done in (queued_id, running_id):
        response = client.get(f"/api/benchmarks/compare?baseline_id={non_done}&candidate_id={done_id}")
        assert response.status_code == 409, non_done
        response = client.get(f"/api/benchmarks/compare?baseline_id={done_id}&candidate_id={non_done}")
        assert response.status_code == 409, non_done

    failed_id = uuid.uuid4().hex
    _write_run(tmp_path, failed_id, status="failed")
    response = client.get(f"/api/benchmarks/compare?baseline_id={failed_id}&candidate_id={done_id}")
    assert response.status_code == 409


# ---- Typed response contract --------------------------------------------------


def test_comparable_pair_returns_fully_typed_200(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    baseline_id, candidate_id = _write_comparable_pair(tmp_path)

    response = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert response.status_code == 200
    body = response.json()

    assert body["baseline_id"] == baseline_id
    assert body["candidate_id"] == candidate_id
    assert body["baseline_manifest"] == _manifest()
    assert body["candidate_manifest"] == _manifest()
    assert body["comparable"] is True
    assert body["reason_codes"] == []
    assert body["missing_baseline_results"] == []
    assert body["missing_candidate_results"] == []

    rows = body["rows"]
    assert [row["resolver"] for row in rows] == [CLOUDFLARE, QUAD9]

    cloudflare_row = rows[0]
    assert cloudflare_row["baseline_rank"] == 1
    assert cloudflare_row["candidate_rank"] == 2
    assert cloudflare_row["baseline"] == {
        "median_ms": 12.3,
        "p95_ms": 17.22,
        "success_rate": 1.0,
        "failure_rate": 0.0,
        "blocking_efficacy": None,
        "score_total": 0.91,
    }
    assert cloudflare_row["deltas"] == {
        "median_ms": 2.9,
        "p95_ms": round(15.2 * 1.4 - 12.3 * 1.4, 4),
        "success_rate": 0.0,
        "failure_rate": 0.0,
        "blocking_efficacy": None,
        "score_total": 0.04,
        "rank": 1,
    }

    quad9_row = rows[1]
    assert quad9_row["baseline_rank"] == 2
    assert quad9_row["candidate_rank"] == 1
    assert quad9_row["deltas"]["median_ms"] == -6.3
    assert quad9_row["deltas"]["rank"] == -1


def test_missing_result_rows_are_reported_not_deltas(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    baseline_id = uuid.uuid4().hex
    candidate_id = uuid.uuid4().hex
    _write_run(tmp_path, baseline_id, manifest=_manifest(), results=_baseline_results())
    _write_run(
        tmp_path, candidate_id, manifest=_manifest(), results=[_result(CLOUDFLARE, _stats(12.3, 0.97))]
    )

    response = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["comparable"] is True
    assert [row["resolver"] for row in body["rows"]] == [CLOUDFLARE]
    assert body["missing_baseline_results"] == []
    assert body["missing_candidate_results"] == [QUAD9]


def test_null_metrics_produce_null_deltas_not_zero(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    baseline_id = uuid.uuid4().hex
    candidate_id = uuid.uuid4().hex
    _write_run(tmp_path, baseline_id, manifest=_manifest(), results=_baseline_results())
    no_samples = _result(
        CLOUDFLARE,
        {
            "avg_ms": None,
            "median_ms": None,
            "p95_ms": None,
            "success_rate": 0.0,
            "failure_rate": 1.0,
            "score_total": None,
            "score_stability": None,
            "blocking_efficacy": None,
            "blocked_count": 0,
            "blocking_test_count": 0,
        },
    )
    _write_run(
        tmp_path, candidate_id, manifest=_manifest(), results=[no_samples, _result(QUAD9, _stats(20.1, 0.95))]
    )

    response = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert response.status_code == 200
    body = response.json()
    cloudflare_row = next(row for row in body["rows"] if row["resolver"] == CLOUDFLARE)
    assert cloudflare_row["candidate"]["median_ms"] is None
    assert cloudflare_row["deltas"]["median_ms"] is None
    assert cloudflare_row["deltas"]["success_rate"] is not None
    assert isinstance(cloudflare_row["deltas"]["rank"], int)


# ---- Non-comparability reason codes -------------------------------------------


def test_reason_codes_are_ordered_and_exact(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    baseline_id = uuid.uuid4().hex
    candidate_id = uuid.uuid4().hex
    divergent = _manifest(
        response_semantics_version="dns-response-v9",
        scoring_profile="security",
        target_snapshot={
            "resolver_ips": [CLOUDFLARE],
            "selection_source": "system",
            "provider_ids": None,
        },
        protocol="dot",
        mode="quick",
        runs=12,
        timeout_sec=1.5,
    )
    _write_run(tmp_path, baseline_id, manifest=divergent, results=_baseline_results())
    _write_run(tmp_path, candidate_id, manifest=_manifest(), results=_candidate_results())

    response = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["comparable"] is False
    assert body["reason_codes"] == [
        "response_semantics_mismatch",
        "scoring_profile_mismatch",
        "target_snapshot_mismatch",
        "protocol_mismatch",
        "mode_mismatch",
        "runs_mismatch",
        "timeout_mismatch",
    ]
    assert body["rows"] == []
    assert body["missing_baseline_results"] == []
    assert body["missing_candidate_results"] == []
    assert body["baseline_manifest"] == divergent
    assert body["candidate_manifest"] == _manifest()


def test_target_snapshot_mismatch_never_produces_partial_union(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    baseline_id = uuid.uuid4().hex
    candidate_id = uuid.uuid4().hex
    _write_run(tmp_path, baseline_id, manifest=_manifest(), results=_baseline_results())
    other_target = _manifest(
        target_snapshot={
            "resolver_ips": [CLOUDFLARE],
            "selection_source": "manual",
            "provider_ids": None,
        }
    )
    _write_run(tmp_path, candidate_id, manifest=other_target, results=_candidate_results())

    response = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["comparable"] is False
    assert body["reason_codes"] == ["target_snapshot_mismatch"]
    assert body["rows"] == []


@pytest.mark.parametrize(
    ("overrides", "expected_code"),
    [
        ({"run_manifest_version": 2}, "manifest_version_mismatch"),
        ({"scoring_semantics_version": "score-v2"}, "scoring_semantics_mismatch"),
        ({"normal_query_plan_sha256": "d" * 64}, "query_plan_mismatch"),
        ({"normal_query_count": 12}, "query_plan_mismatch"),
        ({"blocking_query_plan_sha256": "e" * 64}, "query_plan_mismatch"),
        ({"diagnostic_policy_version": "random-nxdomain-v2"}, "diagnostic_policy_mismatch"),
        ({"provider_catalog_sha256": "f" * 64}, "provider_catalog_mismatch"),
    ],
)
def test_single_manifest_field_mismatch_emits_exact_code(
    monkeypatch, tmp_path, overrides: dict, expected_code: str
) -> None:
    _install_manager(monkeypatch, tmp_path)
    baseline_id = uuid.uuid4().hex
    candidate_id = uuid.uuid4().hex
    _write_run(tmp_path, baseline_id, manifest=_manifest(), results=_baseline_results())
    _write_run(tmp_path, candidate_id, manifest=_manifest(**overrides), results=_candidate_results())

    response = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["comparable"] is False
    assert body["reason_codes"] == [expected_code]


def test_legacy_run_without_manifest_returns_manifest_missing(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    baseline_id = uuid.uuid4().hex
    candidate_id = uuid.uuid4().hex
    _write_run(tmp_path, baseline_id, manifest=None, results=_baseline_results())
    _write_run(tmp_path, candidate_id, manifest=_manifest(), results=_candidate_results())

    response = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["comparable"] is False
    assert body["reason_codes"] == ["manifest_missing"]
    assert body["baseline_manifest"] is None
    assert body["candidate_manifest"] == _manifest()
    assert body["rows"] == []


def test_invalid_manifest_payload_returns_manifest_invalid(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    baseline_id = uuid.uuid4().hex
    candidate_id = uuid.uuid4().hex
    _write_run(tmp_path, baseline_id, manifest={"bogus": "payload"}, results=_baseline_results())
    _write_run(tmp_path, candidate_id, manifest=_manifest(), results=_candidate_results())

    response = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["comparable"] is False
    assert body["reason_codes"] == ["manifest_invalid"]
    assert body["baseline_manifest"] is None


def test_both_sides_invalid_and_missing_codes_stay_canonical(monkeypatch, tmp_path) -> None:
    _install_manager(monkeypatch, tmp_path)
    baseline_id = uuid.uuid4().hex
    candidate_id = uuid.uuid4().hex
    _write_run(tmp_path, baseline_id, manifest={"bogus": "payload"}, results=_baseline_results())
    _write_run(tmp_path, candidate_id, manifest=None, results=_candidate_results())

    response = client.get(f"/api/benchmarks/compare?baseline_id={baseline_id}&candidate_id={candidate_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["reason_codes"] == ["manifest_missing", "manifest_invalid"]
