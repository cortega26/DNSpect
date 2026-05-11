from __future__ import annotations

import csv
import io
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import app, manager
from app.runner import BenchmarkState

client = TestClient(app)


def test_export_csv_keeps_stable_order_and_raw_numeric_values() -> None:
    benchmark_id = "test-export-csv"
    state = BenchmarkState(
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
                "stats": {
                    "avg_ms": 24.5,
                    "median_ms": 24.1,
                    "p95_ms": 35.125,
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
                },
                "samples": [],
                "is_unreliable": False,
            }
        ],
    )

    with manager._lock:
        manager._states[benchmark_id] = state

    try:
        response = client.get(f"/api/benchmarks/{benchmark_id}/export.csv")
        assert response.status_code == 200
        rows = list(csv.reader(io.StringIO(response.text)))

        assert rows[0] == [
            "resolver",
            "provider_id",
            "provider_name",
            "engine",
            "protocol",
            "avg_ms",
            "median_ms",
            "p95_ms",
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
            "is_unreliable",
        ]
        assert rows[1][5] == "24.5"
        assert rows[1][7] == "35.125"
        assert "24,5" not in rows[1]
    finally:
        with manager._lock:
            manager._states.pop(benchmark_id, None)
