from __future__ import annotations

import json
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import (
    BenchmarkRequest,
    ComparisonReasonCode,
    WatchConfigRequest,
    WatchOrigin,
)
from app.runner import BenchmarkManager
from app.watch import SchedulerClock, WatchScheduler

client = TestClient(app)


@pytest.fixture()
def manager(tmp_path, monkeypatch) -> BenchmarkManager:
    instance = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        terminal_ttl_sec=600,
        data_runs_dir=tmp_path / "runs",
        watch_dir=tmp_path / "watch",
    )
    monkeypatch.setattr("app.main.manager", instance)
    yield instance
    with instance._lock:
        instance._states.clear()


class FakeClock:
    def __init__(self) -> None:
        self._now = 1000.0

    def now(self) -> float:
        return self._now

    def sleep(self, seconds: float) -> None:
        pass

    def advance(self, seconds: float) -> None:
        self._now += seconds


class Facade:
    """Duck-typed BenchmarkManager surface for deterministic scheduler tests."""

    def __init__(self) -> None:
        self.next_run_id = uuid.uuid4().hex
        self.runs: dict[str, dict] = {}
        self.history_entries: list[dict] = []
        self.started: list[BenchmarkRequest] = []
        self.start_error: Exception | None = None
        self.comparison_codes: list[ComparisonReasonCode] = []

    def start(self, request: BenchmarkRequest) -> str:
        if self.start_error is not None:
            raise self.start_error
        self.started.append(request)
        self.runs.setdefault(self.next_run_id, {"id": self.next_run_id, "status": "queued"})
        return self.next_run_id

    def get(self, run_id: str, include_samples: bool = False) -> dict | None:
        return self.runs.get(run_id)

    def list_history(self) -> dict:
        return {"runs": list(self.history_entries)}

    def compare_runs(self, baseline_id: str, candidate_id: str) -> SimpleNamespace:
        return SimpleNamespace(reason_codes=self.comparison_codes)


class NoopExecutor:
    def submit(self, fn, *args, **kwargs):
        return None


def _stats(median: float) -> dict:
    return {
        "median_ms": median,
        "p95_ms": median,
        "success_rate": 1.0,
        "failure_rate": 0.0,
        "blocking_efficacy": 0.0,
        "score_total": 1.0,
    }


def _manifest(protocol: str = "udp") -> dict:
    return {
        "run_manifest_version": 1,
        "response_semantics_version": "dns-response-v1",
        "scoring_semantics_version": "score-v1",
        "scoring_profile": "speed",
        "target_snapshot": {
            "resolver_ips": ["1.1.1.1"],
            "selection_source": "manual",
            "provider_ids": None,
        },
        "protocol": protocol,
        "mode": "quick",
        "runs": 12,
        "timeout_sec": 2.0,
        "normal_query_schedule_version": "round-robin-v1",
        "normal_query_plan_sha256": "a" * 64,
        "normal_query_count": 12,
        "blocking_query_plan_sha256": "b" * 64,
        "blocking_query_count": 8,
        "diagnostic_policy_version": "random-nxdomain-v1",
        "provider_catalog_sha256": "c" * 64,
    }


def _run_payload(run_id: str, manifest: dict, median: float, status: str = "done") -> dict:
    return {
        "id": run_id,
        "status": status,
        "manifest": dict(manifest),
        "results": [
            {
                "resolver": "1.1.1.1",
                "provider_name": "Cloudflare",
                "stats": _stats(median),
                "samples": [],
            }
        ],
    }


def _watch_config(interval_min: int = 1, **overrides) -> WatchConfigRequest:
    payload: dict = {
        "target_snapshot": {"resolver_ips": ["1.1.1.1"], "selection_source": "manual"},
        "protocol": "udp",
        "scoring_profile": "speed",
        "mode": "quick",
        "interval_min": interval_min,
    }
    payload.update(overrides)
    return WatchConfigRequest.model_validate(payload)


def _create_payload() -> dict:
    return {
        "target_snapshot": {"resolver_ips": ["1.1.1.1"], "selection_source": "manual"},
        "protocol": "udp",
        "scoring_profile": "speed",
        "mode": "quick",
        "interval_min": 10,
    }


def test_watch_create_persists_and_lists(manager: BenchmarkManager, tmp_path) -> None:
    response = client.post("/api/watch", json=_create_payload())
    assert response.status_code == 200
    watch_id = response.json()["watch_id"]

    listed = client.get("/api/watch").json()
    assert [item["watch_id"] for item in listed["watches"]] == [watch_id]
    assert listed["watches"][0]["config"]["interval_min"] == 10

    path = tmp_path / "watch" / f"{watch_id}.json"
    assert path.exists()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["watch_schema_version"] == 1
    assert data["config"]["target_snapshot"]["resolver_ips"] == ["1.1.1.1"]


def test_watch_create_rejects_bad_thresholds(manager: BenchmarkManager) -> None:
    payload = _create_payload()
    payload["thresholds"] = {"bogus_metric": 5}
    response = client.post("/api/watch", json=payload)
    assert response.status_code == 422

    payload["thresholds"] = {"failure_rate": -1}
    response = client.post("/api/watch", json=payload)
    assert response.status_code == 422

    assert client.get("/api/watch").json() == {"watches": []}


def test_watch_delete_removes_file_and_routes_404(manager: BenchmarkManager, tmp_path) -> None:
    watch_id = client.post("/api/watch", json=_create_payload()).json()["watch_id"]
    path = tmp_path / "watch" / f"{watch_id}.json"
    assert path.exists()

    assert client.delete(f"/api/watch/{watch_id}").status_code == 200
    assert not path.exists()
    assert client.get(f"/api/watch/{watch_id}/status").status_code == 404
    assert client.get("/api/watch").json() == {"watches": []}


def test_watch_start_skips_on_capacity_full(tmp_path) -> None:
    facade = Facade()
    facade.start_error = ValueError("Capacidad de benchmark agotada")
    scheduler = WatchScheduler(facade, watch_dir=tmp_path / "watch", clock=FakeClock())
    watch_id = scheduler.create(_watch_config())

    scheduler.tick_all()

    status = scheduler.get_status(watch_id)
    assert status["active_run_id"] is None
    assert status["last_run_id"] is None
    assert status["alert_events"] == []
    assert facade.started == []


def test_watch_cycle_runs_evaluate_and_alerts(tmp_path) -> None:
    clock = FakeClock()
    facade = Facade()
    scheduler = WatchScheduler(facade, watch_dir=tmp_path / "watch", clock=clock)

    manifest = _manifest()
    baseline_id = uuid.uuid4().hex
    run_id = facade.next_run_id
    facade.runs[baseline_id] = _run_payload(baseline_id, manifest, median=50.0)
    facade.runs[run_id] = _run_payload(run_id, manifest, median=70.0, status="running")
    facade.history_entries = [
        {"id": baseline_id, "status": "done", "started_at": "2026-01-01T00:00:00Z"},
        {"id": run_id, "status": "done", "started_at": "2026-01-02T00:00:00Z"},
    ]

    watch_id = scheduler.create(_watch_config())
    scheduler.tick_all()
    assert len(facade.started) == 1
    assert facade.started[0].origin == WatchOrigin.watch
    assert scheduler.get_status(watch_id)["active_run_id"] == run_id

    clock.advance(61)
    scheduler.tick_all()
    assert len(facade.started) == 1

    facade.runs[run_id]["status"] = "done"
    clock.advance(61)
    scheduler.tick_all()
    assert len(facade.started) == 1

    status = scheduler.get_status(watch_id)
    assert status["active_run_id"] is None
    assert status["last_run_id"] == run_id
    assert status["last_evaluated_at"] is not None
    assert status["last_alert_at"] is not None
    events = status["alert_events"]
    assert len(events) == 1
    event = events[0]
    assert event["type"] == "threshold_alert"
    assert event["baseline_id"] == baseline_id
    assert event["run_id"] == run_id
    assert event["metric"] == "median_ms"
    assert event["baseline_value"] == 50.0
    assert event["candidate_value"] == 70.0
    assert event["delta"] == 40.0
    assert event["threshold"] == 25.0


def test_watch_no_matching_baseline_emits_no_comparable(tmp_path) -> None:
    clock = FakeClock()
    facade = Facade()
    facade.comparison_codes = [ComparisonReasonCode.protocol_mismatch]
    scheduler = WatchScheduler(facade, watch_dir=tmp_path / "watch", clock=clock)

    run_id = facade.next_run_id
    other_id = uuid.uuid4().hex
    facade.runs[other_id] = _run_payload(other_id, _manifest(protocol="dot"), median=50.0)
    facade.runs[run_id] = _run_payload(run_id, _manifest(protocol="udp"), median=70.0, status="running")
    facade.history_entries = [
        {"id": other_id, "status": "done", "started_at": "2026-01-01T00:00:00Z"},
        {"id": run_id, "status": "done", "started_at": "2026-01-02T00:00:00Z"},
    ]

    watch_id = scheduler.create(_watch_config())
    scheduler.tick_all()
    facade.runs[run_id]["status"] = "done"
    clock.advance(61)
    scheduler.tick_all()

    events = scheduler.get_status(watch_id)["alert_events"]
    assert len(events) == 1
    event = events[0]
    assert event["type"] == "no_comparable_baseline"
    assert event["run_id"] == run_id
    assert event["reason_codes"] == ["protocol_mismatch"]


def test_watch_rate_threshold_uses_point_scale(tmp_path) -> None:
    clock = FakeClock()
    facade = Facade()
    scheduler = WatchScheduler(facade, watch_dir=tmp_path / "watch", clock=clock)

    manifest = _manifest()
    baseline_id = uuid.uuid4().hex
    run_id = facade.next_run_id
    baseline_stats = _stats(50.0)
    baseline_stats["failure_rate"] = 0.0
    candidate_stats = _stats(50.0)
    candidate_stats["failure_rate"] = 0.06
    facade.runs[baseline_id] = _run_payload(baseline_id, manifest, median=50.0)
    facade.runs[baseline_id]["results"][0]["stats"] = baseline_stats
    facade.runs[run_id] = _run_payload(run_id, manifest, median=50.0, status="running")
    facade.runs[run_id]["results"][0]["stats"] = candidate_stats
    facade.history_entries = [
        {"id": baseline_id, "status": "done", "started_at": "2026-01-01T00:00:00Z"},
        {"id": run_id, "status": "done", "started_at": "2026-01-02T00:00:00Z"},
    ]

    watch_id = scheduler.create(_watch_config(thresholds={"failure_rate": 5.0}))
    scheduler.tick_all()
    facade.runs[run_id]["status"] = "done"
    clock.advance(61)
    scheduler.tick_all()

    events = scheduler.get_status(watch_id)["alert_events"]
    assert len(events) == 1
    event = events[0]
    assert event["metric"] == "failure_rate"
    assert event["baseline_value"] == 0.0
    assert event["candidate_value"] == 0.06
    assert event["delta"] == pytest.approx(0.06)
    assert event["threshold"] == 5.0
    assert event["delta"] < 5.0


def test_watch_alert_ring_buffer_capped_at_50(tmp_path) -> None:
    facade = Facade()
    scheduler = WatchScheduler(facade, watch_dir=tmp_path / "watch", clock=FakeClock())
    watch_id = scheduler.create(_watch_config())

    data = scheduler._store.load(watch_id)
    assert data is not None
    for index in range(55):
        scheduler._record_events(
            watch_id,
            data,
            [{"type": "threshold_alert", "metric": "median_ms", "run_id": str(index)}],
        )

    persisted = scheduler._store.load(watch_id)
    events = (persisted or {})["runtime"]["alert_events"]
    assert len(events) == 50
    assert events[0]["run_id"] == "5"
    assert events[-1]["run_id"] == "54"


def test_watch_run_is_tagged_origin_watch(tmp_path) -> None:
    runs_dir = tmp_path / "runs"
    manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        terminal_ttl_sec=600,
        data_runs_dir=runs_dir,
        watch_dir=tmp_path / "watch",
    )
    manager._executor = NoopExecutor()
    watch_id = manager.create_watch(_watch_config())

    data = manager._watch_scheduler._store.load(watch_id)
    assert data is not None
    manager._watch_scheduler.tick(watch_id, data)
    run_id = data["runtime"]["active_run_id"]
    assert run_id is not None

    persisted = json.loads((runs_dir / f"{run_id}.json").read_text(encoding="utf-8"))
    assert persisted.get("origin") == "watch"
    assert "origin" not in (persisted.get("manifest") or {})

    entry = manager.list_history()["runs"][0]
    assert entry.get("origin") == "watch"

    with manager._lock:
        manager._states.clear()


def test_watch_status_shape(tmp_path) -> None:
    facade = Facade()
    scheduler = WatchScheduler(facade, watch_dir=tmp_path / "watch", clock=FakeClock())
    watch_id = scheduler.create(_watch_config(interval_min=15))

    status = scheduler.get_status(watch_id)
    assert status is not None
    assert status["watch_id"] == watch_id
    assert status["config"]["interval_min"] == 15
    assert status["config"]["thresholds"] == {
        "median_ms": 25.0,
        "failure_rate": 5.0,
        "success_rate": 5.0,
    }
    assert status["active_run_id"] is None
    assert status["last_run_id"] is None
    assert status["last_evaluated_at"] is None
    assert status["last_alert_at"] is None
    assert status["alert_events"] == []


def test_watch_id_lookup_containment(manager: BenchmarkManager, tmp_path) -> None:
    store = manager._watch_scheduler._store
    assert store.file_path("../evil") is None
    assert store.file_path("../../etc/passwd") is None
    assert store.file_path("not-a-uuid") is None
    assert manager.delete_watch("../evil") is False
    assert manager.get_watch_status("../evil") is None

    assert client.delete("/api/watch/../evil").status_code == 405
    assert client.get("/api/watch/../evil/status").status_code == 404
    assert not (tmp_path / "evil.json").exists()
    assert client.get("/api/watch").json() == {"watches": []}
