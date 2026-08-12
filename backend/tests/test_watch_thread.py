from __future__ import annotations

import json
import threading
import time
import uuid

import pytest

from app import watch as watch_module
from app.models import BenchmarkRequest
from app.watch import WatchScheduler

from test_watch import Facade, FakeClock, _watch_config


class BlockingFacade(Facade):
    """Facade whose ``start`` can block so tests can interleave with a tick."""

    def __init__(self) -> None:
        super().__init__()
        self.block = False
        self.start_calls = 0
        self.entered = threading.Event()
        self.release = threading.Event()

    def start(self, request: BenchmarkRequest) -> str:
        self.start_calls += 1
        if self.block:
            self.entered.set()
            self.release.wait(timeout=30)
        return uuid.uuid4().hex


def _dnswatch_threads() -> list[threading.Thread]:
    return [t for t in threading.enumerate() if t.name == "dnswatch"]


def _bad_watch_payload() -> dict:
    return {
        "watch_schema_version": 1,
        "config": {
            "target_snapshot": {"resolver_ips": ["1.1.1.1"], "selection_source": "manual"},
            "mode": "bogus",
            "interval_min": 1,
        },
        "runtime": {},
    }


def test_start_runs_ticks(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(watch_module, "WATCH_LOOP_INTERVAL_SEC", 0.05)
    facade = BlockingFacade()
    scheduler = WatchScheduler(facade, watch_dir=tmp_path / "watch")
    scheduler.create(_watch_config(interval_min=1))

    tick_runs: list[int] = []
    original_list = scheduler._store.list

    def counting_list():
        tick_runs.append(1)
        return original_list()

    monkeypatch.setattr(scheduler._store, "list", counting_list)

    scheduler.start()
    try:
        deadline = time.monotonic() + 5
        while len(tick_runs) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert len(tick_runs) >= 2
        assert facade.start_calls >= 1
    finally:
        scheduler.stop()


def test_stop_is_idempotent(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(watch_module, "WATCH_LOOP_INTERVAL_SEC", 0.05)
    scheduler = WatchScheduler(BlockingFacade(), watch_dir=tmp_path / "watch")
    scheduler.start()
    scheduler.stop()
    scheduler.stop()
    assert scheduler._thread is None


def test_restart_after_stop_no_double_thread(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(watch_module, "WATCH_LOOP_INTERVAL_SEC", 0.05)
    scheduler = WatchScheduler(BlockingFacade(), watch_dir=tmp_path / "watch")
    scheduler.start()
    scheduler.stop()
    assert scheduler._thread is None
    scheduler.start()
    try:
        threads = _dnswatch_threads()
        assert len(threads) == 1
        assert threads[0].is_alive()
    finally:
        scheduler.stop()


def test_stop_timeout_keeps_zombie_and_start_does_not_respawn(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(watch_module, "WATCH_LOOP_INTERVAL_SEC", 0.05)
    monkeypatch.setattr(threading.Thread, "join", lambda self, timeout=None: None)
    facade = BlockingFacade()
    facade.block = True
    scheduler = WatchScheduler(facade, watch_dir=tmp_path / "watch")
    scheduler.create(_watch_config(interval_min=1))

    scheduler.start()
    assert facade.entered.wait(timeout=5)
    scheduler.stop()
    assert scheduler._thread is not None and scheduler._thread.is_alive()
    assert scheduler._stop_event is not None and scheduler._stop_event.is_set()

    scheduler.start()
    assert len(_dnswatch_threads()) == 1

    facade.release.set()
    deadline = time.monotonic() + 5
    while scheduler._thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not scheduler._thread.is_alive()

    scheduler.start()
    threads = _dnswatch_threads()
    assert len(threads) == 1
    assert threads[0].is_alive()

    deadline = time.monotonic() + 5
    while scheduler._thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.01)
    scheduler.stop()


def test_delete_during_tick_does_not_resurrect(tmp_path) -> None:
    facade = BlockingFacade()
    facade.block = True
    scheduler = WatchScheduler(facade, watch_dir=tmp_path / "watch", clock=FakeClock())
    watch_id = scheduler.create(_watch_config(interval_min=1))
    path = tmp_path / "watch" / f"{watch_id}.json"

    driver = threading.Thread(target=scheduler.tick_all, name="tick-driver")
    driver.start()
    try:
        assert facade.entered.wait(timeout=5)
        assert scheduler.delete(watch_id) is True
        assert not path.exists()
    finally:
        facade.release.set()
        driver.join(timeout=5)

    assert not driver.is_alive()
    assert facade.start_calls == 1
    assert not path.exists()
    assert scheduler.get_status(watch_id) is None
    assert watch_id not in scheduler._last_tick_at


def test_bad_config_isolated_from_other_watches(tmp_path) -> None:
    facade = Facade()
    scheduler = WatchScheduler(facade, watch_dir=tmp_path / "watch", clock=FakeClock())
    good_id = scheduler.create(_watch_config(interval_min=1))
    bad_id = uuid.uuid4().hex
    (tmp_path / "watch" / f"{bad_id}.json").write_text(
        json.dumps(_bad_watch_payload()), encoding="utf-8"
    )

    scheduler.tick_all()

    assert len(facade.started) == 1
    persisted = scheduler._store.load(bad_id)
    assert persisted is not None
    events = persisted["runtime"]["alert_events"]
    assert events[-1]["type"] == "watch_config_error"
    assert "bogus" in events[-1]["message"]
    assert scheduler._store.load(good_id) is not None


def test_first_tick_after_restart_is_staggered(tmp_path) -> None:
    watch_dir = tmp_path / "watch"
    facade_a = Facade()
    scheduler_a = WatchScheduler(facade_a, watch_dir=watch_dir, clock=FakeClock())
    first_id = scheduler_a.create(_watch_config(interval_min=1))
    second_id = scheduler_a.create(_watch_config(interval_min=1))
    fresh_id = uuid.uuid4().hex
    while int(fresh_id, 16) % 10 != 7:
        fresh_id = uuid.uuid4().hex
    payload = _bad_watch_payload()
    payload["config"]["mode"] = "quick"
    payload["config"]["interval_min"] = 10
    (watch_dir / f"{fresh_id}.json").write_text(json.dumps(payload), encoding="utf-8")

    scheduler_a.tick_all()
    assert len(facade_a.started) == 2
    for watch_id in (first_id, second_id):
        data = scheduler_a._store.load(watch_id)
        assert data is not None
        assert data["runtime"]["last_tick_at"] == 1000.0
    fresh_data = scheduler_a._store.load(fresh_id)
    assert fresh_data is not None
    assert "last_tick_at" not in fresh_data["runtime"]

    facade_b = Facade()
    clock_b = FakeClock()
    restarted = WatchScheduler(facade_b, watch_dir=watch_dir, clock=clock_b)
    restarted.tick_all()
    assert facade_b.started == []
    assert restarted._last_tick_at[first_id] == 1000.0
    assert restarted._last_tick_at[second_id] == 1000.0

    clock_b.advance(30)
    restarted.tick_all()
    assert facade_b.started == []

    clock_b.advance(390)
    restarted.tick_all()
    assert len(facade_b.started) == 3
