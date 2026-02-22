from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import app, manager
from app.runner import BenchmarkState

client = TestClient(app)


def test_status_include_samples_toggle() -> None:
    benchmark_id = "test-include-samples"
    state = BenchmarkState(
        id=benchmark_id,
        status="done",
        started_at=datetime.now(UTC).isoformat(),
        finished_at=datetime.now(UTC).isoformat(),
        progress_current=1,
        progress_total=1,
        mode="quick",
        timeout_sec=1.0,
        runs=1,
        engine="dnspython",
        results=[
            {
                "resolver": "1.1.1.1",
                "provider_id": "cloudflare",
                "provider_name": "Cloudflare",
                "engine": "dnspython",
                "stats": {
                    "avg_ms": 12.0,
                    "median_ms": 12.0,
                    "p95_ms": 12.0,
                    "min_ms": 12.0,
                    "max_ms": 12.0,
                    "ok_count": 1,
                    "timeout_count": 0,
                    "success_rate": 1.0,
                    "timeout_rate": 0.0,
                    "success_count": 1,
                    "failure_count": 0,
                    "failure_rate": 0.0,
                    "consistency_ratio": 1.0,
                    "p95_minus_median_ms": 0.0,
                    "score_latency": 12.0,
                    "score_reliability": 0.0,
                    "score_stability": 0.0,
                    "score_total": 8.4,
                    "normalized_latency": 1.0,
                    "normalized_reliability": 0.0,
                    "normalized_stability": 0.0,
                },
                "samples": [
                    {
                        "run_index": 1,
                        "resolver": "1.1.1.1",
                        "query": "example.com",
                        "ok": True,
                        "ms": 12.0,
                        "error": None,
                        "failure_kind": None,
                    }
                ],
            }
        ],
    )

    with manager._lock:
        manager._states[benchmark_id] = state

    try:
        resp_default = client.get(f"/api/benchmarks/{benchmark_id}")
        assert resp_default.status_code == 200
        payload_default = resp_default.json()
        assert payload_default["results"][0]["samples"] == []
        assert payload_default["results"][0]["sample_count"] == 1

        resp_with_samples = client.get(f"/api/benchmarks/{benchmark_id}?include_samples=1")
        assert resp_with_samples.status_code == 200
        payload_with_samples = resp_with_samples.json()
        assert payload_with_samples["results"][0]["samples"][0]["query"] == "example.com"

        export_default = client.get(f"/api/benchmarks/{benchmark_id}/export.json")
        assert export_default.status_code == 200
        assert export_default.json()["results"][0]["samples"] == []

        export_with_samples = client.get(f"/api/benchmarks/{benchmark_id}/export.json?include_samples=1")
        assert export_with_samples.status_code == 200
        assert export_with_samples.json()["results"][0]["samples"][0]["query"] == "example.com"
    finally:
        with manager._lock:
            manager._states.pop(benchmark_id, None)
