from __future__ import annotations

import json
import os
import threading
import time
import uuid
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from platformdirs import user_data_path

from .models import (
    WATCH_METRIC_KEYS,
    BenchmarkGoal,
    BenchmarkMode,
    BenchmarkProtocol,
    BenchmarkRequest,
    TargetSnapshot,
    WatchConfigRequest,
    WatchOrigin,
)

WATCH_SCHEMA_VERSION = 1
WATCH_ALERT_RING_CAPACITY = 50
WATCH_LOOP_INTERVAL_SEC = 5

RELATIVE_METRICS = ("median_ms", "p95_ms", "blocking_efficacy", "score_total")
RATE_METRICS = ("success_rate", "failure_rate")
HIGHER_IS_BETTER = {"success_rate", "blocking_efficacy", "score_total"}

_MANIFEST_EQUALITY_FIELDS = (
    "run_manifest_version",
    "response_semantics_version",
    "scoring_semantics_version",
    "scoring_profile",
    "target_snapshot",
    "protocol",
    "mode",
    "runs",
    "timeout_sec",
    "normal_query_schedule_version",
    "normal_query_plan_sha256",
    "normal_query_count",
    "blocking_query_plan_sha256",
    "blocking_query_count",
    "diagnostic_policy_version",
    "provider_catalog_sha256",
)


def _resolve_watch_dir() -> Path:
    override = os.getenv("DNS_SPEED_LAB_WATCH_DIR")
    if override:
        return Path(override).expanduser().resolve()
    return user_data_path("dnspect", "DNSpect") / "watch"


WATCH_DIR = _resolve_watch_dir()


def _is_generated_watch_id(watch_id: Any) -> bool:
    """True only for the canonical lowercase UUIDv4 hex form (mirrors run ids)."""
    if not isinstance(watch_id, str):
        return False
    try:
        parsed = uuid.UUID(watch_id)
    except (ValueError, AttributeError, TypeError):
        return False
    return parsed.version == 4 and parsed.hex == watch_id


class WatchStore:
    """One JSON file per watch in ``WATCH_DIR``, atomic writes (plan 024 pattern)."""

    def __init__(self, watch_dir: Path | None = None) -> None:
        self._watch_dir = watch_dir or WATCH_DIR

    def file_path(self, watch_id: str) -> Path | None:
        """Return the file path only for canonical UUIDv4 hex ids contained in the dir."""
        if not _is_generated_watch_id(watch_id):
            return None
        candidate = self._watch_dir / f"{watch_id}.json"
        try:
            if not candidate.resolve().is_relative_to(self._watch_dir.resolve()):
                return None
        except OSError:
            return None
        return candidate

    def _write_json_file(self, path: Path, payload: str) -> None:
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        try:
            with tmp_path.open("w", encoding="utf-8") as f:
                f.write(payload)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, path)
        except OSError as exc:
            raise ValueError("No se pudo guardar la watch: " + str(exc)) from exc

    def list(self) -> list[str]:
        if not self._watch_dir.exists():
            return []
        return sorted(
            path.stem for path in self._watch_dir.glob("[!.]*.json") if not path.name.endswith(".tmp")
        )

    def load(self, watch_id: str) -> dict[str, Any] | None:
        path = self.file_path(watch_id)
        if path is None or not path.exists():
            return None
        try:
            data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        return data

    def save(self, watch_id: str, data: dict[str, Any]) -> None:
        path = self.file_path(watch_id)
        if path is None:
            raise ValueError("watch_id inválido")
        try:
            self._watch_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise ValueError("No se pudo guardar la watch: " + str(exc)) from exc
        self._write_json_file(path, json.dumps(data, ensure_ascii=False, indent=2))

    def delete(self, watch_id: str) -> bool:
        path = self.file_path(watch_id)
        if path is None:
            return False
        try:
            path.unlink()
        except OSError:
            return False
        with suppress(OSError):
            tmp = path.with_suffix(path.suffix + ".tmp")
            if tmp.exists():
                tmp.unlink()
        return True


class SchedulerClock:
    """Testable now()/sleep() seam for the scheduler loop."""

    def now(self) -> float:
        return time.time()

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)


def _manifests_equal(
    baseline_manifest: dict[str, Any] | None, candidate_manifest: dict[str, Any] | None
) -> bool:
    if baseline_manifest is None or candidate_manifest is None:
        return False
    return all(
        baseline_manifest.get(field) == candidate_manifest.get(field) for field in _MANIFEST_EQUALITY_FIELDS
    )


class WatchScheduler:
    """Production scheduler: one daemon thread, per-watch intervals, threshold alerts.

    Duck-typed against the BenchmarkManager surface (``start``, ``get``,
    ``list_history``, ``compare_runs``) so tests drive it with a facade.
    """

    def __init__(
        self,
        manager: Any,
        watch_dir: Path | None = None,
        clock: SchedulerClock | None = None,
    ) -> None:
        self._manager = manager
        self._store = WatchStore(watch_dir=watch_dir)
        self._clock = clock or SchedulerClock()
        self._lock = threading.Lock()
        self._last_tick_at: dict[str, float] = {}
        self._stop_event: threading.Event | None = None
        self._thread: threading.Thread | None = None

    # -- store-backed manager API -----------------------------------------

    def create(self, config: WatchConfigRequest) -> str:
        watch_id = uuid.uuid4().hex
        data = {
            "watch_schema_version": WATCH_SCHEMA_VERSION,
            "config": config.model_dump(),
            "runtime": {
                "active_run_id": None,
                "last_run_id": None,
                "last_evaluated_at": None,
                "last_alert_at": None,
                "alert_events": [],
            },
        }
        self._store.save(watch_id, data)
        return watch_id

    def delete(self, watch_id: str) -> bool:
        with self._lock:
            self._last_tick_at.pop(watch_id, None)
            return self._store.delete(watch_id)

    def list_watches(self) -> dict[str, list[dict[str, Any]]]:
        watches: list[dict[str, Any]] = []
        for watch_id in self._store.list():
            data = self._store.load(watch_id)
            if data is None:
                continue
            watches.append(
                {
                    "watch_id": watch_id,
                    "config": data.get("config") or {},
                    "runtime": data.get("runtime") or {},
                }
            )
        return {"watches": watches}

    def get_status(self, watch_id: str) -> dict[str, Any] | None:
        data = self._store.load(watch_id)
        if data is None:
            return None
        runtime = data.get("runtime") or {}
        return {
            "watch_id": watch_id,
            "config": data.get("config") or {},
            "active_run_id": runtime.get("active_run_id"),
            "last_run_id": runtime.get("last_run_id"),
            "last_evaluated_at": runtime.get("last_evaluated_at"),
            "last_alert_at": runtime.get("last_alert_at"),
            "alert_events": runtime.get("alert_events") or [],
        }

    # -- scheduler loop -----------------------------------------------------

    def _run_loop(self, stop_event: threading.Event) -> None:
        while not stop_event.is_set():
            with suppress(Exception):
                self.tick_all()
            self._clock.sleep(WATCH_LOOP_INTERVAL_SEC)

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            stop_event = threading.Event()
            thread = threading.Thread(
                target=self._run_loop, name="dnswatch", daemon=True, args=(stop_event,)
            )
            thread.start()
            self._stop_event = stop_event
            self._thread = thread

    def stop(self) -> None:
        with self._lock:
            stop_event = self._stop_event
            thread = self._thread
        if stop_event is not None:
            stop_event.set()
        if thread is None:
            return
        thread.join(timeout=10)
        with self._lock:
            if not thread.is_alive():
                if self._thread is thread:
                    self._thread = None
                if self._stop_event is stop_event:
                    self._stop_event = None

    def tick_all(self) -> None:
        now = self._clock.now()
        for watch_id in self._store.list():
            data = self._store.load(watch_id)
            if data is None:
                self._last_tick_at.pop(watch_id, None)
                continue
            config = data.get("config") or {}
            interval_sec = float(config.get("interval_min", 30)) * 60
            last_tick = self._last_tick_at.get(watch_id)
            if last_tick is None:
                persisted = (data.get("runtime") or {}).get("last_tick_at")
                if isinstance(persisted, (int, float)):
                    last_tick = float(persisted)
                    self._last_tick_at[watch_id] = last_tick
                else:
                    last_tick = now - interval_sec + self._startup_offset_sec(watch_id, interval_sec)
                    self._last_tick_at[watch_id] = last_tick
            if now - last_tick < interval_sec:
                continue
            self._last_tick_at[watch_id] = now
            data.setdefault("runtime", {})["last_tick_at"] = now
            try:
                self.tick(watch_id, data)
            except Exception as exc:  # noqa: BLE001
                self._record_error_event(watch_id, data, exc)
            self._persist(watch_id, data)

    def _startup_offset_sec(self, watch_id: str, interval_sec: float) -> float:
        try:
            seed = int(watch_id, 16)
        except ValueError:
            seed = 0
        return float(seed % max(1, int(interval_sec // 60))) * 60.0

    def tick(self, watch_id: str, data: dict[str, Any]) -> None:
        data.setdefault("runtime", {})
        runtime = data["runtime"]
        active_run_id = runtime.get("active_run_id")

        if active_run_id:
            run = self._manager.get(active_run_id)
            if run is None:
                runtime["active_run_id"] = None
            elif run.get("status") in {"queued", "running"}:
                return
            else:
                runtime["active_run_id"] = None
                if run.get("status") != "done":
                    self._record_events(
                        watch_id,
                        data,
                        [
                            {
                                "type": "watch_run_not_done",
                                "run_id": active_run_id,
                                "status": run.get("status"),
                            }
                        ],
                    )
                    return
                self.evaluate(watch_id, data, run)
                return

        request = self._build_request(data.get("config") or {})
        try:
            run_id = self._manager.start(request)
        except ValueError:
            return
        runtime["active_run_id"] = run_id
        self._persist(watch_id, data)

    def evaluate(self, watch_id: str, data: dict[str, Any], candidate: dict[str, Any]) -> None:
        config = data.get("config") or {}
        runtime = data.setdefault("runtime", {})
        candidate_id = str(candidate.get("id", ""))
        runtime["last_run_id"] = candidate_id

        events: list[dict[str, Any]] = []
        baseline_id, newest_done_id = self._find_baseline(candidate, candidate_id)
        if baseline_id is None:
            reason_codes: list[str] = []
            if newest_done_id is not None:
                comparison = self._manager.compare_runs(newest_done_id, candidate_id)
                if comparison is not None:
                    reason_codes = [
                        code.value if hasattr(code, "value") else str(code)
                        for code in comparison.reason_codes
                    ]
            events.append(
                {
                    "type": "no_comparable_baseline",
                    "run_id": candidate_id,
                    "reason_codes": reason_codes,
                }
            )
        else:
            baseline = self._manager.get(baseline_id)
            if baseline is not None:
                events.extend(self._evaluate_thresholds(config, baseline, candidate))

        self._record_events(watch_id, data, events, evaluated_at=datetime.now(UTC).isoformat())

    def _find_baseline(self, candidate: dict[str, Any], candidate_id: str) -> tuple[str | None, str | None]:
        history = self._manager.list_history()
        entries = history.get("runs", []) if isinstance(history, dict) else []
        newest_done_id: str | None = None
        for entry in entries:
            entry_id = str(entry.get("id", ""))
            if entry_id == candidate_id:
                continue
            if entry.get("status") != "done":
                continue
            if newest_done_id is None:
                newest_done_id = entry_id
            other = self._manager.get(entry_id)
            if other is None:
                continue
            if _manifests_equal(other.get("manifest"), candidate.get("manifest")):
                return entry_id, newest_done_id
        return None, newest_done_id

    def _evaluate_thresholds(
        self, config: dict[str, Any], baseline: dict[str, Any], candidate: dict[str, Any]
    ) -> list[dict[str, Any]]:
        thresholds = config.get("thresholds") or {}
        events: list[dict[str, Any]] = []
        baseline_results = {str(item.get("resolver", "")): item for item in (baseline.get("results") or [])}
        candidate_results = {str(item.get("resolver", "")): item for item in (candidate.get("results") or [])}
        candidate_id = str(candidate.get("id", ""))
        for resolver in sorted(set(baseline_results) & set(candidate_results)):
            baseline_stats = baseline_results[resolver].get("stats") or {}
            candidate_stats = candidate_results[resolver].get("stats") or {}
            for metric in WATCH_METRIC_KEYS:
                threshold = thresholds.get(metric)
                if threshold is None:
                    continue
                baseline_value = baseline_stats.get(metric)
                candidate_value = candidate_stats.get(metric)
                if baseline_value is None or candidate_value is None:
                    continue
                alert, delta = _crosses_threshold(metric, threshold, baseline_value, candidate_value)
                if not alert:
                    continue
                events.append(
                    {
                        "type": "threshold_alert",
                        "baseline_id": str(baseline.get("id", "")),
                        "run_id": candidate_id,
                        "resolver": resolver,
                        "metric": metric,
                        "baseline_value": baseline_value,
                        "candidate_value": candidate_value,
                        "delta": delta,
                        "threshold": threshold,
                    }
                )
        return events

    def _record_error_event(self, watch_id: str, data: dict[str, Any], exc: Exception) -> None:
        with suppress(Exception):
            self._record_events(
                watch_id,
                data,
                [{"type": "watch_config_error", "message": str(exc)[:300]}],
            )

    def _record_events(
        self,
        watch_id: str,
        data: dict[str, Any],
        events: list[dict[str, Any]],
        *,
        evaluated_at: str | None = None,
    ) -> None:
        runtime = data.setdefault("runtime", {})
        if evaluated_at is not None:
            runtime["last_evaluated_at"] = evaluated_at
        if events:
            ring = runtime.get("alert_events") or []
            ring = ring + events
            runtime["alert_events"] = ring[-WATCH_ALERT_RING_CAPACITY:]
            if any(event.get("type") == "threshold_alert" for event in events):
                runtime["last_alert_at"] = datetime.now(UTC).isoformat()
        self._persist(watch_id, data)

    def _persist(self, watch_id: str, data: dict[str, Any]) -> None:
        if not _is_generated_watch_id(watch_id):
            return
        with self._lock:
            path = self._store.file_path(watch_id)
            if path is None or not path.exists():
                return
            with suppress(OSError, ValueError):
                self._store.save(watch_id, data)

    def _build_request(self, config: dict[str, Any]) -> BenchmarkRequest:
        return BenchmarkRequest(
            mode=BenchmarkMode(config.get("mode") or "quick"),
            scoring_profile=BenchmarkGoal(config.get("scoring_profile") or "speed"),
            protocol=BenchmarkProtocol(config.get("protocol") or "udp"),
            runs=config.get("runs"),
            timeout_sec=float(config.get("timeout_sec") or 2.0),
            queries=config.get("queries"),
            target_snapshot=TargetSnapshot.model_validate(config["target_snapshot"]),
            origin=WatchOrigin.watch,
        )


def _crosses_threshold(
    metric: str, threshold: float, baseline_value: float, candidate_value: float
) -> tuple[bool, float]:
    """Return (alert, delta). Relative metrics use % delta; rates use absolute 0-1 points."""
    if metric in RELATIVE_METRICS:
        if baseline_value == 0:
            return False, 0.0
        delta = (candidate_value - baseline_value) / baseline_value * 100.0
        if metric in HIGHER_IS_BETTER:
            return delta <= -threshold, delta
        return delta >= threshold, delta
    delta = candidate_value - baseline_value
    bound = threshold / 100.0
    if metric in HIGHER_IS_BETTER:
        return delta <= -bound, delta
    return delta >= bound, delta
