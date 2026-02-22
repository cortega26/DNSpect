from datetime import UTC, datetime
from time import sleep

from app.runner import BenchmarkManager, BenchmarkState


def test_last_sample_at_updates_monotonically() -> None:
    manager = BenchmarkManager()
    benchmark_id = "test-last-sample-at"

    state = BenchmarkState(
        id=benchmark_id,
        status="running",
        started_at=datetime.now(UTC).isoformat(),
        progress_total=2,
        mode="quick",
        timeout_sec=1.0,
        runs=2,
    )
    with manager._lock:
        manager._states[benchmark_id] = state

    try:
        manager._update_progress(benchmark_id, increment=1, resolver="1.1.1.1", observed_latency_ms=20.0)
        first = manager.get_state(benchmark_id)
        assert first is not None
        assert first.last_sample_at is not None

        sleep(0.002)
        manager._update_progress(benchmark_id, increment=1, resolver="1.1.1.1", observed_latency_ms=21.0)
        second = manager.get_state(benchmark_id)
        assert second is not None
        assert second.last_sample_at is not None
        assert second.last_sample_at >= first.last_sample_at

        payload = manager.get(benchmark_id)
        assert payload is not None
        assert payload["progress"]["last_sample_at"] == second.last_sample_at
    finally:
        with manager._lock:
            manager._states.pop(benchmark_id, None)
