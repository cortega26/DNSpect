from __future__ import annotations

from time import sleep

from fastapi.testclient import TestClient

from app.main import app
from app.runner import BenchmarkManager

client = TestClient(app)


def test_api_exposes_run_storage_warning_when_persistence_fails(monkeypatch, tmp_path) -> None:
    isolated_manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        terminal_ttl_sec=600,
        data_runs_dir=tmp_path / "runs",
    )

    def fake_write_json_file(*args, **kwargs) -> None:
        del args, kwargs
        raise PermissionError("read-only file system")

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        return {
            "ok": True,
            "ms": 10.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
        }

    monkeypatch.setattr("app.main.manager", isolated_manager)
    monkeypatch.setattr(isolated_manager, "_write_json_file", fake_write_json_file)
    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")

    start = client.post(
        "/api/benchmarks",
        json={
            "runs": 1,
            "timeout_sec": 1,
            "resolvers": ["1.1.1.1"],
            "queries": ["example.com"],
            "mode": "quick",
        },
    )
    assert start.status_code == 200
    benchmark_id = start.json()["benchmark_id"]

    final_payload = None
    for _ in range(200):
        payload = client.get(f"/api/benchmarks/{benchmark_id}").json()
        if payload["status"] in {"done", "failed", "cancelled"}:
            final_payload = payload
            break
        sleep(0.01)

    assert final_payload is not None
    assert final_payload["status"] == "done"
    assert "run_storage_warning" in final_payload
    assert "PermissionError" in str(final_payload["run_storage_warning"])
