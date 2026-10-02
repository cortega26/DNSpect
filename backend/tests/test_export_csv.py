from __future__ import annotations

import csv
import io
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import app, manager
from app.runner import BenchmarkState

client = TestClient(app)


def _make_done_state(benchmark_id: str, stats: dict) -> BenchmarkState:
    return BenchmarkState(
        id=benchmark_id,
        status="done",
        started_at=datetime.now(UTC).isoformat(),
        finished_at=datetime.now(UTC).isoformat(),
        progress_current=2,
        progress_total=2,
        mode="quick",
        timeout_sec=2.0,
        runs=2,
        engine="dnspython",
        results=[
            {
                "resolver": "1.1.1.1",
                "provider_id": "cloudflare",
                "provider_name": "Cloudflare",
                "engine": "dnspython",
                "stats": stats,
                "samples": [],
                "is_unreliable": False,
            }
        ],
    )


def _diagnostics_stats() -> dict:
    return {
        "avg_ms": 24.5,
        "median_ms": 24.1,
        "p95_ms": 35.125,
        "p99_ms": 39.4,
        "stddev_ms": 7.42,
        "min_ms": 20.0,
        "max_ms": 40.0,
        "ok_count": 2,
        "timeout_count": 0,
        "success_rate": 1.0,
        "timeout_rate": 0.0,
        "success_count": 2,
        "failure_count": 0,
        "failure_rate": 0.0,
        "consistency_ratio": 0.97,
        "p95_minus_median_ms": 11.025,
        "score_latency": 24.5,
        "score_reliability": 0.0,
        "score_stability": 11.025,
        "score_total": 11.532,
        "normalized_latency": 0.01,
        "normalized_reliability": 0.0,
        "normalized_stability": 0.02,
        "reliability_penalty": 0.0,
        "max_rel_penalty": 0.3,
        "blocking_efficacy": 87.5,
        "blocked_count": 7,
        "blocking_test_count": 9,
        "score_blocking": 12.3,
        "normalized_blocking": 0.45,
        "nxdomain_hijack_detected": False,
        "dnssec_validating": True,
    }


def test_export_csv_keeps_stable_order_and_raw_numeric_values() -> None:
    benchmark_id = "test-export-csv"
    state = _make_done_state(benchmark_id, _diagnostics_stats())

    with manager._lock:
        manager._states[benchmark_id] = state

    try:
        response = client.get(f"/api/benchmarks/{benchmark_id}/export.csv")
        assert response.status_code == 200
        rows = list(csv.reader(io.StringIO(response.text)))

        # Header contract: mirrors frontend/src/lib/reporting.ts BASE_CSV_COLUMNS
        # plus the alphabetical extra stats columns (dnssec_validating,
        # nxdomain_hijack_detected) appended last. Canonical source of truth:
        # app/export.py EXPORT_CSV_COLUMNS.
        assert rows[0] == [
            "resolver",
            "provider_id",
            "provider_name",
            "engine",
            "protocol",
            "avg_ms",
            "median_ms",
            "p95_ms",
            "p99_ms",
            "stddev_ms",
            "min_ms",
            "max_ms",
            "ok_count",
            "timeout_count",
            "success_rate",
            "timeout_rate",
            "success_count",
            "failure_count",
            "failure_rate",
            "consistency_ratio",
            "p95_minus_median_ms",
            "score_latency",
            "score_reliability",
            "score_stability",
            "score_total",
            "normalized_latency",
            "normalized_reliability",
            "normalized_stability",
            "reliability_penalty",
            "max_rel_penalty",
            "blocking_efficacy",
            "blocked_count",
            "blocking_test_count",
            "score_blocking",
            "normalized_blocking",
            "is_unreliable",
            "dnssec_validating",
            "nxdomain_hijack_detected",
        ]
        # Address cells by column name: positional indices break every time a
        # metric column is added, which is exactly what p99/stddev did.
        cells = dict(zip(rows[0], rows[1], strict=True))
        assert cells["avg_ms"] == "24.5"
        assert cells["p95_ms"] == "35.125"
        assert cells["p99_ms"] == "39.4"
        assert cells["stddev_ms"] == "7.42"
        assert "24,5" not in rows[1]
        assert cells["blocking_efficacy"] == "87.5"
        assert cells["score_blocking"] == "12.3"
        assert cells["dnssec_validating"] == "True"
        assert cells["nxdomain_hijack_detected"] == "False"
    finally:
        with manager._lock:
            manager._states.pop(benchmark_id, None)


def test_export_csv_diagnostics_none_renders_empty() -> None:
    benchmark_id = "test-export-csv-none"
    stats = _diagnostics_stats()
    stats["blocking_efficacy"] = None
    stats["nxdomain_hijack_detected"] = None
    stats["dnssec_validating"] = None
    state = _make_done_state(benchmark_id, stats)

    with manager._lock:
        manager._states[benchmark_id] = state

    try:
        response = client.get(f"/api/benchmarks/{benchmark_id}/export.csv")
        assert response.status_code == 200
        rows = list(csv.reader(io.StringIO(response.text)))

        # A None diagnostic renders empty, not "0.0" or "None".
        cells = dict(zip(rows[0], rows[1], strict=True))
        assert cells["blocking_efficacy"] == ""
        assert cells["dnssec_validating"] == ""
        assert cells["nxdomain_hijack_detected"] == ""
    finally:
        with manager._lock:
            manager._states.pop(benchmark_id, None)
