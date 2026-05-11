from __future__ import annotations

from datetime import UTC, datetime, timedelta
from time import sleep

import pytest

from app.models import BenchmarkRequest
from app.runner import BenchmarkManager, BenchmarkState


def _wait_terminal(manager: BenchmarkManager, benchmark_id: str, timeout_sec: float = 5.0) -> dict:
    attempts = int(timeout_sec / 0.01)
    for _ in range(attempts):
        state = manager.get(benchmark_id)
        if state and state["status"] in {"done", "failed", "cancelled"}:
            return state
        sleep(0.01)
    raise AssertionError("benchmark did not finish in time")


def test_start_succeeds_when_run_storage_is_not_writable(monkeypatch, tmp_path) -> None:
    manager = BenchmarkManager(max_concurrent_jobs=1, max_queued_jobs=1, data_runs_dir=tmp_path / "runs")

    def fake_write_json_file(*args, **kwargs) -> None:
        del args, kwargs
        raise PermissionError("read-only file system")

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        return {
            "ok": True,
            "ms": 15.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
        }

    monkeypatch.setattr(manager, "_write_json_file", fake_write_json_file)
    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")
    manager.blocking_test_queries = []

    benchmark_id = manager.start(
        BenchmarkRequest(runs=1, timeout_sec=1.0, resolvers=["1.1.1.1"], queries=["example.com"])
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"
    assert state["run_storage_warning"] is not None
    assert "PermissionError" in state["run_storage_warning"]


def test_queue_limit_is_enforced_and_queued_state_is_visible(monkeypatch, tmp_path) -> None:
    manager = BenchmarkManager(max_concurrent_jobs=1, max_queued_jobs=1, data_runs_dir=tmp_path / "runs")

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str) -> dict:
        del timeout_sec, engine
        sleep(0.2)
        return {
            "ok": True,
            "ms": 12.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")
    manager.blocking_test_queries = []

    req = BenchmarkRequest(runs=1, timeout_sec=1.0, resolvers=["1.1.1.1"], queries=["example.com"])
    first = manager.start(req)
    second = manager.start(req)

    second_state = manager.get(second)
    assert second_state is not None
    assert second_state["status"] == "queued"

    with pytest.raises(ValueError, match="Capacidad de benchmark agotada"):
        manager.start(req)

    assert _wait_terminal(manager, first)["status"] == "done"
    assert _wait_terminal(manager, second)["status"] == "done"


def test_terminal_ttl_cleanup_removes_old_states(tmp_path) -> None:
    manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        terminal_ttl_sec=1,
        max_retained_states=10,
        data_runs_dir=tmp_path / "runs",
    )

    old_finished = (datetime.now(UTC) - timedelta(seconds=120)).isoformat()
    recent_finished = datetime.now(UTC).isoformat()
    with manager._lock:
        manager._states["old"] = BenchmarkState(
            id="old",
            status="done",
            started_at=old_finished,
            finished_at=old_finished,
            progress_total=1,
            progress_current=1,
            runs=1,
        )
        manager._states["fresh"] = BenchmarkState(
            id="fresh",
            status="done",
            started_at=recent_finished,
            finished_at=recent_finished,
            progress_total=1,
            progress_current=1,
            runs=1,
        )

    manager._cleanup_terminal_states()
    assert manager.get_state("old") is None
    assert manager.get_state("fresh") is not None
