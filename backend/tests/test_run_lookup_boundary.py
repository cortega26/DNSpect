from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import app
from app.runner import BenchmarkManager, BenchmarkState

client = TestClient(app)


def _make_manager(tmp_path) -> BenchmarkManager:
    return BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        terminal_ttl_sec=600,
        data_runs_dir=tmp_path / "runs",
    )


def test_valid_persisted_uuid4_hex_restores_from_disk(tmp_path) -> None:
    manager = _make_manager(tmp_path)
    benchmark_id = uuid.uuid4().hex
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True)
    (runs_dir / f"{benchmark_id}.json").write_text(
        json.dumps({"id": benchmark_id, "status": "done"}),
        encoding="utf-8",
    )

    restored = manager.get(benchmark_id)
    assert restored is not None
    assert restored["id"] == benchmark_id
    assert restored["status"] == "done"


def test_invalid_ids_never_reach_disk_and_leave_sentinel_untouched(tmp_path) -> None:
    manager = _make_manager(tmp_path)
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True)
    sentinel = tmp_path / "outside.json"
    sentinel.write_text(json.dumps({"sentinel": True}), encoding="utf-8")
    original = sentinel.read_text(encoding="utf-8")

    hyphenated = str(uuid.uuid4())
    invalid_ids = [
        "not-a-uuid",
        "",
        "../outside",
        "..\\outside",
        hyphenated,
        hyphenated.upper(),
        uuid.uuid1().hex,
        f"{{{hyphenated}}}",
        "deadbeef",
    ]
    for invalid_id in invalid_ids:
        assert manager.get(invalid_id) is None, invalid_id

    assert sentinel.read_text(encoding="utf-8") == original
    assert not (runs_dir / "outside.json").exists()


def test_symlinked_metadata_outside_runs_dir_is_rejected(tmp_path) -> None:
    manager = _make_manager(tmp_path)
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True)
    sentinel = tmp_path / "outside.json"
    sentinel.write_text(json.dumps({"sentinel": True}), encoding="utf-8")
    benchmark_id = uuid.uuid4().hex
    (runs_dir / f"{benchmark_id}.json").symlink_to(sentinel)

    assert manager.get(benchmark_id) is None
    assert sentinel.read_text(encoding="utf-8") == json.dumps({"sentinel": True})


def test_legacy_in_memory_non_uuid_id_still_resolves(tmp_path) -> None:
    manager = _make_manager(tmp_path)
    state = BenchmarkState(
        id="legacy-run-1",
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
        manager._states["legacy-run-1"] = state

    response = manager.get("legacy-run-1")
    assert response is not None
    assert response["id"] == "legacy-run-1"


def test_invalid_lookup_ids_return_404_on_public_routes(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("app.main.manager", _make_manager(tmp_path))

    for path in (
        "/api/benchmarks/not-a-uuid",
        "/api/benchmarks/not-a-uuid/export.json",
        "/api/benchmarks/not-a-uuid/export.csv",
    ):
        response = client.get(path)
        assert response.status_code == 404, path
