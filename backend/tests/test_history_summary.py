from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import BenchmarkRequest
from app.runner import BenchmarkManager, BenchmarkState, _build_history_summary

client = TestClient(app)


@pytest.fixture()
def manager(tmp_path, monkeypatch) -> BenchmarkManager:
    instance = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        terminal_ttl_sec=600,
        data_runs_dir=tmp_path / "runs",
    )
    monkeypatch.setattr("app.main.manager", instance)
    yield instance
    with instance._lock:
        instance._states.clear()


def _runs_dir(manager: BenchmarkManager) -> object:
    return manager._data_runs_dir


def _valid_run_payload(benchmark_id: str) -> dict:
    return {
        "id": benchmark_id,
        "status": "done",
        "mode": "quick",
        "goal": "speed",
        "scoring_profile": "speed",
        "protocol": "udp",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "origin": "manual",
        "results": [
            {"provider_name": "Cloudflare", "resolver": "1.1.1.1"},
            {"provider_name": "Google", "resolver": "8.8.8.8"},
            {"provider_name": "Quad9", "resolver": "9.9.9.9"},
        ],
    }


def _done_state(benchmark_id: str, *, origin: str | None = "manual") -> BenchmarkState:
    return BenchmarkState(
        id=benchmark_id,
        status="done",
        started_at=datetime.now(UTC).isoformat(),
        finished_at=datetime.now(UTC).isoformat(),
        progress_current=1,
        progress_total=1,
        mode="quick",
        goal="speed",
        scoring_profile="speed",
        protocol="udp",
        timeout_sec=1.0,
        runs=1,
        engine="dnspython",
        origin=origin,
        results=[
            {
                "resolver": "1.1.1.1",
                "provider_id": "cloudflare",
                "provider_name": "Cloudflare",
                "engine": "dnspython",
                "stats": {
                    "avg_ms": 12.0,
                    "median_ms": 12.0,
                    "p95_ms": 12.0,
                    "min_ms": 12.0,
                    "max_ms": 12.0,
                    "ok_count": 1,
                    "timeout_count": 0,
                    "success_rate": 1.0,
                    "timeout_rate": 0.0,
                    "success_count": 1,
                    "failure_count": 0,
                    "failure_rate": 0.0,
                    "consistency_ratio": 1.0,
                    "p95_minus_median_ms": 0.0,
                    "score_latency": 12.0,
                    "score_reliability": 0.0,
                    "score_stability": 0.0,
                    "score_total": 8.4,
                    "normalized_latency": 1.0,
                    "normalized_reliability": 0.0,
                    "normalized_stability": 0.0,
                    "is_unreliable": False,
                },
                "sample_count": 0,
                "samples": [],
            }
        ],
    )


def _write_run(runs_dir: object, benchmark_id: str, payload: dict, *, summary: dict | None = None) -> None:
    runs_dir.mkdir(parents=True, exist_ok=True)
    (runs_dir / f"{benchmark_id}.json").write_text(json.dumps(payload), encoding="utf-8")
    if summary is not None:
        (runs_dir / f"{benchmark_id}.summary.json").write_text(json.dumps(summary), encoding="utf-8")


def test_summary_sidecar_written_on_persist(manager: BenchmarkManager) -> None:
    benchmark_id = uuid.uuid4().hex
    with manager._lock:
        manager._states[benchmark_id] = _done_state(benchmark_id)

    manager._persist_run(benchmark_id)

    runs_dir = _runs_dir(manager)
    summary_path = runs_dir / f"{benchmark_id}.summary.json"
    metadata_path = runs_dir / f"{benchmark_id}.json"
    assert summary_path.exists()
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    for field in ("id", "status", "protocol", "started_at", "finished_at", "origin"):
        assert summary[field] == metadata[field]
    assert summary["results_summary"] == [{"provider_name": "Cloudflare", "resolver": "1.1.1.1"}]
    assert metadata["results"][0]["stats"]["avg_ms"] == 12.0


def test_history_uses_summary_when_metadata_corrupt(manager: BenchmarkManager) -> None:
    benchmark_id = uuid.uuid4().hex
    runs_dir = _runs_dir(manager)
    runs_dir.mkdir(parents=True)
    (runs_dir / f"{benchmark_id}.json").write_bytes(b"\xff\xfe")
    (runs_dir / f"{benchmark_id}.summary.json").write_text(
        json.dumps(_build_history_summary(_valid_run_payload(benchmark_id))),
        encoding="utf-8",
    )

    history = client.get("/api/benchmarks/history")
    assert history.status_code == 200
    entries = history.json()["runs"]
    assert [entry["id"] for entry in entries] == [benchmark_id]
    assert entries[0]["status"] == "done"
    assert entries[0]["results_summary"][0]["provider_name"] == "Cloudflare"


def test_history_legacy_fallback(manager: BenchmarkManager) -> None:
    benchmark_id = uuid.uuid4().hex
    _write_run(_runs_dir(manager), benchmark_id, _valid_run_payload(benchmark_id))

    history = client.get("/api/benchmarks/history")
    assert history.status_code == 200
    entries = history.json()["runs"]
    assert [entry["id"] for entry in entries] == [benchmark_id]
    assert entries[0]["status"] == "done"
    assert entries[0]["origin"] == "manual"
    assert entries[0]["results_summary"] == [
        {"provider_name": "Cloudflare", "resolver": "1.1.1.1"},
        {"provider_name": "Google", "resolver": "8.8.8.8"},
        {"provider_name": "Quad9", "resolver": "9.9.9.9"},
    ]


def test_history_legacy_corrupt_still_skipped(manager: BenchmarkManager) -> None:
    benchmark_id = uuid.uuid4().hex
    runs_dir = _runs_dir(manager)
    runs_dir.mkdir(parents=True)
    (runs_dir / f"{benchmark_id}.json").write_bytes(b"\xff\xfe")
    (runs_dir / f"{benchmark_id}.summary.json").write_bytes(b"\xff\xfe")

    history = client.get("/api/benchmarks/history")
    assert history.status_code == 200
    assert history.json()["runs"] == []


def test_summary_sidecar_corrupt_falls_back_to_metadata(manager: BenchmarkManager) -> None:
    benchmark_id = uuid.uuid4().hex
    runs_dir = _runs_dir(manager)
    runs_dir.mkdir(parents=True)
    (runs_dir / f"{benchmark_id}.json").write_text(
        json.dumps(_valid_run_payload(benchmark_id)),
        encoding="utf-8",
    )
    (runs_dir / f"{benchmark_id}.summary.json").write_bytes(b"\xff\xfe")

    history = client.get("/api/benchmarks/history")
    assert history.status_code == 200
    entries = history.json()["runs"]
    assert [entry["id"] for entry in entries] == [benchmark_id]
    assert entries[0]["status"] == "done"
    assert entries[0]["results_summary"][1]["resolver"] == "8.8.8.8"


def test_history_sorted_and_capped_with_summaries(manager: BenchmarkManager) -> None:
    runs_dir = _runs_dir(manager)
    now = datetime.now(UTC)
    for index in range(55):
        benchmark_id = uuid.uuid4().hex
        payload = _valid_run_payload(benchmark_id)
        payload["started_at"] = (now - timedelta(seconds=index)).isoformat()
        _write_run(
            runs_dir,
            benchmark_id,
            {},
            summary=_build_history_summary(payload),
        )
    (runs_dir / "orphan.samples.json").write_text("{}", encoding="utf-8")

    history = client.get("/api/benchmarks/history")
    assert history.status_code == 200
    runs = history.json()["runs"]
    assert len(runs) == 50
    started = [entry["started_at"] for entry in runs]
    assert started == sorted(started, reverse=True)


def test_queued_run_summary_persisted(manager: BenchmarkManager, monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_submit(fn, *args, **kwargs):
        del fn, kwargs
        captured["id"] = args[0]

    monkeypatch.setattr(manager._executor, "submit", fake_submit)

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=1,
            timeout_sec=1.0,
            resolvers=["1.1.1.1"],
            queries=["example.com"],
        )
    )
    assert benchmark_id == captured["id"]

    runs_dir = _runs_dir(manager)
    summary_path = runs_dir / f"{benchmark_id}.summary.json"
    assert summary_path.exists()
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["status"] == "queued"
    assert summary["id"] == benchmark_id

    history = client.get("/api/benchmarks/history")
    assert history.status_code == 200
    entries = history.json()["runs"]
    assert [entry["id"] for entry in entries] == [benchmark_id]
    assert entries[0]["status"] == "queued"


def test_summary_does_not_affect_get_fallback(manager: BenchmarkManager) -> None:
    benchmark_id = uuid.uuid4().hex
    runs_dir = _runs_dir(manager)
    runs_dir.mkdir(parents=True)
    (runs_dir / f"{benchmark_id}.json").write_text(
        json.dumps(_valid_run_payload(benchmark_id)),
        encoding="utf-8",
    )
    misleading = _build_history_summary(_valid_run_payload(benchmark_id))
    misleading["status"] = "failed"
    (runs_dir / f"{benchmark_id}.summary.json").write_text(
        json.dumps(misleading),
        encoding="utf-8",
    )

    loaded = manager.get(benchmark_id)
    assert loaded is not None
    assert loaded["status"] == "done"
    assert loaded["results"] == _valid_run_payload(benchmark_id)["results"]
