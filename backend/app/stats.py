from __future__ import annotations

import math
import re
import statistics
from typing import Any

QUERY_TIME_RE = re.compile(r"Query time:\s*(\d+(?:\.\d+)?)\s*msec", re.IGNORECASE)
RELIABILITY_GUARDRAIL_THRESHOLD = 0.05
# Fixed reliability reference keeps pairwise ordering stable regardless of cohort composition.
RELIABILITY_REFERENCE_PENALTY = -math.log(1.0 - RELIABILITY_GUARDRAIL_THRESHOLD)
RECOMMENDATION_WARNING_ALL_UNRELIABLE = (
    "All resolvers exceed reliability threshold; recommendation may be unstable."
)


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


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _reliability_penalty(success_rate: float, total_samples: int) -> float:
    eps = 1.0 / (max(total_samples, 0) + 1)
    rel_penalty_input = min(1.0, max(0.0, success_rate) + eps)
    return max(0.0, -math.log(rel_penalty_input))


def apply_normalized_scoring(results: list[dict[str, Any]]) -> None:
    latency_values = [
        latency
        for item in results
        if (latency := _safe_float(item.get("stats", {}).get("score_latency"))) is not None
    ]
    positive_latency_values = [value for value in latency_values if value > 0]
    fastest_latency = min(positive_latency_values) if positive_latency_values else None

    stability_values = [
        max(0.0, stability)
        for item in results
        if (stability := _safe_float(item.get("stats", {}).get("score_stability"))) is not None
    ]
    max_stability = max(stability_values) if stability_values else 0.0
    for item in results:
        stats = item.get("stats")
        if not isinstance(stats, dict):
            continue

        latency = _safe_float(stats.get("score_latency"))
        failure_rate = _safe_float(stats.get("failure_rate"))
        stability = _safe_float(stats.get("score_stability"))
        success_count = _safe_float(stats.get("success_count"))
        failure_count = _safe_float(stats.get("failure_count"))

        # Keep canonical component fields in sync with current raw stats.
        stats["score_latency"] = latency
        stats["score_reliability"] = max(0.0, failure_rate) if failure_rate is not None else None
        stats["score_stability"] = max(0.0, stability) if stability is not None else None
        bounded_failure_rate_opt = max(0.0, min(1.0, failure_rate)) if failure_rate is not None else None
        success_rate_opt = (
            max(0.0, min(1.0, 1.0 - bounded_failure_rate_opt))
            if bounded_failure_rate_opt is not None
            else None
        )
        stats["success_rate"] = (
            round(success_rate_opt, 4) if success_rate_opt is not None else stats.get("success_rate")
        )
        total_samples = max(0, int((success_count or 0) + (failure_count or 0)))
        reliability_penalty_opt: float | None = None
        if success_rate_opt is not None:
            reliability_penalty_opt = _reliability_penalty(success_rate_opt, total_samples)
        stats["reliability_penalty"] = (
            round(reliability_penalty_opt, 6) if reliability_penalty_opt is not None else None
        )
        stats["max_rel_penalty"] = round(RELIABILITY_REFERENCE_PENALTY, 6)
        item["is_unreliable"] = bool(
            bounded_failure_rate_opt is None or bounded_failure_rate_opt > RELIABILITY_GUARDRAIL_THRESHOLD
        )

        normalized_latency: float | None = None
        if latency is not None:
            if fastest_latency is not None and fastest_latency > 0:
                normalized_latency = latency / fastest_latency
            elif latency >= 0:
                normalized_latency = latency

        normalized_reliability: float | None = None
        if reliability_penalty_opt is not None:
            if RELIABILITY_REFERENCE_PENALTY > 0:
                normalized_reliability = min(1.0, reliability_penalty_opt / RELIABILITY_REFERENCE_PENALTY)
            else:
                normalized_reliability = 0.0

        normalized_stability: float | None = None
        if stability is not None:
            bounded_stability = max(0.0, stability)
            if max_stability > 0:
                normalized_stability = bounded_stability / max_stability
            else:
                normalized_stability = bounded_stability

        stats["normalized_latency"] = round(normalized_latency, 6) if normalized_latency is not None else None
        stats["normalized_reliability"] = (
            round(normalized_reliability, 6) if normalized_reliability is not None else None
        )
        stats["normalized_stability"] = (
            round(normalized_stability, 6) if normalized_stability is not None else None
        )

        if normalized_latency is None or normalized_reliability is None or normalized_stability is None:
            stats["score_total"] = None
            continue

        score_total = (
            (normalized_latency * 0.6) + (normalized_reliability * 0.3) + (normalized_stability * 0.1)
        )
        stats["score_total"] = round(score_total, 6)


def select_recommended_resolver(results: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    if not results:
        return None, None

    for item in results:
        if not bool(item.get("is_unreliable")):
            resolver = item.get("resolver")
            return str(resolver) if resolver is not None else None, None

    fallback = results[0].get("resolver")
    return (str(fallback) if fallback is not None else None), RECOMMENDATION_WARNING_ALL_UNRELIABLE


def compute_stats(
    success_samples_ms: list[float],
    total_runs: int,
    timeout_count: int,
    failure_count: int,
) -> dict:
    success_count = len(success_samples_ms)
    timeout_count = max(min(timeout_count, total_runs), 0)
    failure_count = max(min(failure_count, total_runs), 0)
    # Timeouts are always part of reliability failures.
    failure_count = max(failure_count, timeout_count)
    success_rate = round((1 - (failure_count / total_runs)), 4) if total_runs else 0.0
    timeout_rate = round(timeout_count / total_runs, 4) if total_runs else 0.0
    failure_rate = round(failure_count / total_runs, 4) if total_runs else 0.0

    if not success_samples_ms:
        return {
            "avg_ms": None,
            "median_ms": None,
            "p95_ms": None,
            "min_ms": None,
            "max_ms": None,
            "ok_count": success_count,
            "timeout_count": timeout_count,
            "success_rate": success_rate,
            "timeout_rate": timeout_rate,
            "success_count": success_count,
            "failure_count": failure_count,
            "failure_rate": failure_rate,
            "consistency_ratio": None,
            "p95_minus_median_ms": None,
            "score_latency": None,
            "score_reliability": failure_rate,
            "score_stability": None,
            "score_total": None,
            "normalized_latency": None,
            "normalized_reliability": None,
            "normalized_stability": None,
            "reliability_penalty": None,
            "max_rel_penalty": None,
        }

    avg_ms = round(sum(success_samples_ms) / success_count, 3)
    median_ms = round(float(statistics.median(success_samples_ms)), 3)
    p95_ms = round(float(percentile(success_samples_ms, 95) or 0.0), 3)
    consistency_ratio = round(p95_ms / median_ms, 4) if median_ms > 0 else None
    jitter_ms = round(p95_ms - median_ms, 3)
    score_latency = avg_ms
    score_reliability = failure_rate
    score_stability = jitter_ms

    return {
        "avg_ms": avg_ms,
        "median_ms": median_ms,
        "p95_ms": p95_ms,
        "min_ms": round(min(success_samples_ms), 3),
        "max_ms": round(max(success_samples_ms), 3),
        "ok_count": success_count,
        "timeout_count": timeout_count,
        "success_rate": success_rate,
        "timeout_rate": timeout_rate,
        "success_count": success_count,
        "failure_count": failure_count,
        "failure_rate": failure_rate,
        "consistency_ratio": consistency_ratio,
        "p95_minus_median_ms": jitter_ms,
        "score_latency": score_latency,
        "score_reliability": score_reliability,
        "score_stability": score_stability,
        "score_total": None,
        "normalized_latency": None,
        "normalized_reliability": None,
        "normalized_stability": None,
        "reliability_penalty": None,
        "max_rel_penalty": None,
    }
