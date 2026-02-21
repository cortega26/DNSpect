from __future__ import annotations

import math
import re
import statistics

QUERY_TIME_RE = re.compile(r"Query time:\s*(\d+(?:\.\d+)?)\s*msec", re.IGNORECASE)


def parse_drill_query_time(output: str) -> float | None:
    match = QUERY_TIME_RE.search(output)
    if not match:
        return None
    return float(match.group(1))


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    sorted_vals = sorted(values)
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    rank = (p / 100.0) * (len(sorted_vals) - 1)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return sorted_vals[low]
    low_v = sorted_vals[low]
    high_v = sorted_vals[high]
    return low_v + (high_v - low_v) * (rank - low)


def compute_stats(success_samples_ms: list[float], total_runs: int, timeout_count: int) -> dict:
    ok_count = len(success_samples_ms)
    timeout_count = max(min(timeout_count, total_runs), 0)
    success_rate = round(ok_count / total_runs, 4) if total_runs else 0.0
    timeout_rate = round(timeout_count / total_runs, 4) if total_runs else 0.0
    if not success_samples_ms:
        return {
            "avg_ms": None,
            "median_ms": None,
            "p95_ms": None,
            "min_ms": None,
            "max_ms": None,
            "ok_count": ok_count,
            "timeout_count": timeout_count,
            "success_rate": success_rate,
            "timeout_rate": timeout_rate,
            "consistency_ratio": None,
            "p95_minus_median_ms": None,
        }

    median_ms = round(float(statistics.median(success_samples_ms)), 3)
    p95_ms = round(float(percentile(success_samples_ms, 95) or 0.0), 3)
    consistency_ratio = round(p95_ms / median_ms, 4) if median_ms > 0 else None
    jitter_ms = round(p95_ms - median_ms, 3)

    return {
        "avg_ms": round(sum(success_samples_ms) / ok_count, 3),
        "median_ms": median_ms,
        "p95_ms": p95_ms,
        "min_ms": round(min(success_samples_ms), 3),
        "max_ms": round(max(success_samples_ms), 3),
        "ok_count": ok_count,
        "timeout_count": timeout_count,
        "success_rate": success_rate,
        "timeout_rate": timeout_rate,
        "consistency_ratio": consistency_ratio,
        "p95_minus_median_ms": jitter_ms,
    }
