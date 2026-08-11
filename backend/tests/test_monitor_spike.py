"""Plan-021 spike tests: deterministic scheduler behaviour on recorded fixtures.

Runs against the in-tests prototype (watch_scheduler_spike) — no network, no
real timers, no production code. Plain ``import watch_scheduler_spike`` works
because pytest runs from backend/ with ``pythonpath = ["."]`` and tests/ has
no ``__init__.py``.
"""

from watch_scheduler_spike import (
    FIXTURE_RUN_A_BASELINE,
    FIXTURE_RUN_B_DEGRADED,
    FIXTURE_RUN_C_MISMATCHED,
    FakeClock,
    RunnerFacade,
    WatchConfig,
    WatchScheduler,
)


def _watch_config(**overrides: object) -> WatchConfig:
    fields: dict[str, object] = {
        "watch_id": "watch-1",
        "target_snapshot": {"resolver_ips": ["1.1.1.1"], "selection_source": "manual"},
        "protocol": "udp",
        "scoring_profile": "speed",
        "mode": "quick",
        "runs": 2,
        "timeout_sec": 2.0,
        "interval_min": 30,
        "thresholds": {"median_ms": 25.0, "failure_rate": 5.0},
    }
    fields.update(overrides)
    return WatchConfig(**fields)  # type: ignore[arg-type]


def _scheduler(
    facade: RunnerFacade,
    clock: FakeClock,
    **overrides: object,
) -> WatchScheduler:
    return WatchScheduler(config=_watch_config(**overrides), runner=facade, clock=clock)


def test_tick_skips_when_run_active() -> None:
    clock = FakeClock()
    facade = RunnerFacade(records={}, template=FIXTURE_RUN_B_DEGRADED, clock=clock)
    scheduler = _scheduler(facade, clock)

    assert scheduler.tick() == []
    run_id = scheduler.active_run_id
    assert run_id is not None
    assert facade.get(run_id)["status"] == "queued"

    assert scheduler.tick() == []
    assert scheduler.active_run_id == run_id
    assert len(facade.list_history()["runs"]) == 1


def test_tick_starts_run_when_idle_and_capacity_available() -> None:
    clock = FakeClock()
    facade = RunnerFacade(records={}, template=FIXTURE_RUN_B_DEGRADED, clock=clock)
    scheduler = _scheduler(facade, clock)

    events = scheduler.tick()
    assert events == []
    run_id = scheduler.active_run_id
    assert run_id is not None
    run = facade.get(run_id)
    assert run["status"] == "queued"
    assert run["manifest"] == FIXTURE_RUN_B_DEGRADED["manifest"]
    assert len(facade.list_history()["runs"]) == 1


def test_tick_skips_when_capacity_full() -> None:
    clock = FakeClock()
    facade = RunnerFacade(
        records={},
        template=FIXTURE_RUN_B_DEGRADED,
        clock=clock,
        capacity_full=True,
    )
    scheduler = _scheduler(facade, clock)

    assert scheduler.tick() == []
    assert scheduler.active_run_id is None
    assert facade.list_history()["runs"] == []


def test_tick_on_done_finds_manifest_matching_baseline() -> None:
    clock = FakeClock()
    records = {
        FIXTURE_RUN_A_BASELINE["id"]: FIXTURE_RUN_A_BASELINE,
        FIXTURE_RUN_C_MISMATCHED["id"]: FIXTURE_RUN_C_MISMATCHED,
    }
    facade = RunnerFacade(records=records, template=FIXTURE_RUN_B_DEGRADED, clock=clock)
    scheduler = _scheduler(facade, clock, thresholds={"failure_rate": 2.0})

    assert scheduler.tick() == []
    run_id = scheduler.active_run_id
    assert run_id is not None
    facade.complete(run_id)

    events = scheduler.tick()
    assert len(events) == 1
    event = events[0]
    assert event["kind"] == "threshold_alert"
    # Baseline is the manifest-matching A (2026-08-01), NOT the newer but
    # manifest-mismatched C (2026-08-03).
    assert event["baseline_id"] == FIXTURE_RUN_A_BASELINE["id"]
    assert event["run_id"] == run_id
    assert event["metric"] == "failure_rate"


def test_tick_no_matching_baseline_emits_no_comparable_event() -> None:
    clock = FakeClock()
    records = {
        FIXTURE_RUN_A_BASELINE["id"]: FIXTURE_RUN_A_BASELINE,
        FIXTURE_RUN_B_DEGRADED["id"]: FIXTURE_RUN_B_DEGRADED,
    }
    facade = RunnerFacade(records=records, template=FIXTURE_RUN_C_MISMATCHED, clock=clock)
    scheduler = _scheduler(facade, clock)

    assert scheduler.tick() == []
    run_id = scheduler.active_run_id
    assert run_id is not None
    facade.complete(run_id)

    events = scheduler.tick()
    assert len(events) == 1
    event = events[0]
    assert event["kind"] == "no_comparable_baseline"
    assert event["run_id"] == run_id
    # Candidate's manifest (runs=3) matches no done run; reason codes come
    # from comparing against the newest done run (B).
    assert event["reason_codes"] == ["runs_mismatch"]


def test_tick_threshold_crossing_emits_alert() -> None:
    clock = FakeClock()
    records = {FIXTURE_RUN_A_BASELINE["id"]: FIXTURE_RUN_A_BASELINE}
    facade = RunnerFacade(records=records, template=FIXTURE_RUN_B_DEGRADED, clock=clock)
    scheduler = _scheduler(facade, clock, thresholds={"median_ms": 25.0})

    assert scheduler.tick() == []
    run_id = scheduler.active_run_id
    assert run_id is not None
    facade.complete(run_id)

    events = scheduler.tick()
    assert len(events) == 1
    event = events[0]
    assert event["kind"] == "threshold_alert"
    assert event["baseline_id"] == FIXTURE_RUN_A_BASELINE["id"]
    assert event["run_id"] == run_id
    assert event["resolver"] == "1.1.1.1"
    assert event["metric"] == "median_ms"
    assert event["baseline_value"] == 24.1
    assert event["candidate_value"] == 33.74
    assert event["delta"] == 40.0
    assert event["threshold"] == 25.0


def test_tick_no_threshold_crossing_emits_no_alert() -> None:
    clock = FakeClock()
    records = {FIXTURE_RUN_A_BASELINE["id"]: FIXTURE_RUN_A_BASELINE}
    facade = RunnerFacade(records=records, template=FIXTURE_RUN_B_DEGRADED, clock=clock)
    scheduler = _scheduler(facade, clock, thresholds={"median_ms": 100.0})

    assert scheduler.tick() == []
    run_id = scheduler.active_run_id
    assert run_id is not None
    facade.complete(run_id)

    assert scheduler.tick() == []


def test_tick_idempotent_no_double_start() -> None:
    clock = FakeClock()
    records = {FIXTURE_RUN_A_BASELINE["id"]: FIXTURE_RUN_A_BASELINE}
    facade = RunnerFacade(records=records, template=FIXTURE_RUN_B_DEGRADED, clock=clock)
    scheduler = _scheduler(facade, clock)

    assert scheduler.tick() == []
    run_id = scheduler.active_run_id
    assert run_id is not None

    for _ in range(3):
        assert scheduler.tick() == []
        assert scheduler.active_run_id == run_id

    assert len(facade.list_history()["runs"]) == 2  # baseline A + one watch run
