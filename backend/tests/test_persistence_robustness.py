from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import BenchmarkRequest
from app.runner import BenchmarkManager, BenchmarkState

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
        "results": [],
    }


def _corrupt_file_matrix() -> list[tuple[str, bytes]]:
    return [
        ("invalid utf-8", b"\xff\xfe\xfa"),
        ("truncated json", b'{"results": ['),
        ("list root", b"[1, 2, 3]"),
        ("string root", b'"x"'),
    ]


def test_invalid_utf8_run_file_is_skipped_not_500(manager: BenchmarkManager) -> None:
    benchmark_id = uuid.uuid4().hex
    _runs_dir(manager).mkdir(parents=True)
    (_runs_dir(manager) / f"{benchmark_id}.json").write_bytes(b"\xff\xfe\xfa")

    history = client.get("/api/benchmarks/history")
    assert history.status_code == 200
    assert history.json()["runs"] == []

    status = client.get(f"/api/benchmarks/{benchmark_id}")
    assert status.status_code == 404


def test_truncated_json_run_file_skipped(manager: BenchmarkManager) -> None:
    benchmark_id = uuid.uuid4().hex
    _runs_dir(manager).mkdir(parents=True)
    (_runs_dir(manager) / f"{benchmark_id}.json").write_bytes(b'{"results": [')

    history = client.get("/api/benchmarks/history")
    assert history.status_code == 200
    assert history.json()["runs"] == []

    status = client.get(f"/api/benchmarks/{benchmark_id}")
    assert status.status_code == 404


def test_non_dict_root_skipped(manager: BenchmarkManager) -> None:
    runs_dir = _runs_dir(manager)
    runs_dir.mkdir(parents=True)
    for raw in (b"[1, 2, 3]", b'"x"'):
        benchmark_id = uuid.uuid4().hex
        (runs_dir / f"{benchmark_id}.json").write_bytes(raw)

        history = client.get("/api/benchmarks/history")
        assert history.status_code == 200
        assert history.json()["runs"] == []

        status = client.get(f"/api/benchmarks/{benchmark_id}")
        assert status.status_code == 404


def test_history_survives_mixed_good_and_bad_files(manager: BenchmarkManager) -> None:
    runs_dir = _runs_dir(manager)
    runs_dir.mkdir(parents=True)
    good_id = uuid.uuid4().hex
    (runs_dir / f"{good_id}.json").write_text(
        json.dumps(_valid_run_payload(good_id)),
        encoding="utf-8",
    )
    bad_utf8 = uuid.uuid4().hex
    (runs_dir / f"{bad_utf8}.json").write_bytes(b"\xff\xfe\xfa")
    bad_truncated = uuid.uuid4().hex
    (runs_dir / f"{bad_truncated}.json").write_bytes(b'{"results": [')

    history = client.get("/api/benchmarks/history")
    assert history.status_code == 200
    entries = history.json()["runs"]
    assert [entry["id"] for entry in entries] == [good_id]


def test_ghost_queued_run_removed_on_submit_failure(manager: BenchmarkManager, monkeypatch, tmp_path) -> None:
    captured: dict[str, str] = {}

    def fake_submit(fn, *args, **kwargs):
        del fn, kwargs
        captured["id"] = args[0]
        raise RuntimeError("executor shut down")

    monkeypatch.setattr(manager._executor, "submit", fake_submit)
    runs_dir = _runs_dir(manager)

    with pytest.raises(ValueError, match="No se pudo iniciar benchmark"):
        manager.start(
            BenchmarkRequest(
                runs=1,
                timeout_sec=1.0,
                resolvers=["1.1.1.1"],
                queries=["example.com"],
            )
        )

    benchmark_id = captured["id"]
    assert benchmark_id
    assert not (runs_dir / f"{benchmark_id}.json").exists()
    assert list(runs_dir.glob("*.json")) == []
    assert manager.get(benchmark_id) is None


def test_atomic_write_leaves_no_tmp_and_readable(manager: BenchmarkManager) -> None:
    runs_dir = _runs_dir(manager)
    runs_dir.mkdir(parents=True)
    target = runs_dir / "some.json"
    payload = json.dumps({"a": 1, "b": [True, None]})

    manager._write_json_file(target, payload)

    assert target.read_text(encoding="utf-8") == payload
    assert list(runs_dir.glob("*.tmp")) == []
    assert json.loads(target.read_text(encoding="utf-8")) == {"a": 1, "b": [True, None]}


def _done_state_with_samples(benchmark_id: str) -> BenchmarkState:
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
        timeout_sec=1.0,
        runs=1,
        engine="dnspython",
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
                "samples": [
                    {
                        "run_index": 1,
                        "resolver": "1.1.1.1",
                        "query": "example.com",
                        "ok": True,
                        "ms": 12.0,
                        "error": None,
                        "failure_kind": None,
                    }
                ],
            }
        ],
    )


def test_persisted_samples_round_trip(manager: BenchmarkManager) -> None:
    benchmark_id = uuid.uuid4().hex
    manager.persist_samples = True
    with manager._lock:
        manager._states[benchmark_id] = _done_state_with_samples(benchmark_id)

    manager._persist_run(benchmark_id)
    with manager._lock:
        manager._states.pop(benchmark_id, None)

    with_samples = manager.get(benchmark_id, include_samples=True)
    assert with_samples is not None
    assert with_samples["results"][0]["samples"][0]["query"] == "example.com"

    without_samples = manager.get(benchmark_id, include_samples=False)
    assert without_samples is not None
    assert without_samples["results"][0]["samples"] == []
    assert without_samples["results"][0]["sample_count"] == 1


def test_disk_fallback_404_for_missing(manager: BenchmarkManager) -> None:
    missing_id = uuid.uuid4().hex
    assert manager.get(missing_id) is None
    status = client.get(f"/api/benchmarks/{missing_id}")
    assert status.status_code == 404
