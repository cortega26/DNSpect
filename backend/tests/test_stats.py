from app.stats import (
    RECOMMENDATION_WARNING_ALL_UNRELIABLE,
    apply_normalized_scoring,
    compute_stats,
    percentile,
    select_recommended_resolver,
)


def _ranked(results: list[dict]) -> list[dict]:
    apply_normalized_scoring(results)
    results.sort(
        key=lambda item: (
            item["stats"]["score_total"] if item["stats"]["score_total"] is not None else float("inf"),
            item["stats"]["avg_ms"] if item["stats"]["avg_ms"] is not None else float("inf"),
            item["stats"]["score_stability"] if item["stats"]["score_stability"] is not None else float("inf"),
            item["resolver"],
        )
    )
    return results


def test_stats_median_and_p95():
    samples = [10, 20, 30, 40, 50]
    stats = compute_stats(samples, total_runs=7, timeout_count=2, failure_count=3)

    assert stats["median_ms"] == 30
    assert stats["p95_ms"] == 48
    assert stats["ok_count"] == 5
    assert stats["timeout_count"] == 2
    assert stats["success_count"] == 5
    assert stats["failure_count"] == 3
    assert stats["failure_rate"] == 0.4286
    assert stats["success_rate"] == 0.5714
    assert stats["timeout_rate"] == 0.2857
    assert stats["score_latency"] == stats["avg_ms"]
    assert stats["score_stability"] == stats["p95_minus_median_ms"]
    assert stats["score_total"] is None
    assert stats["normalized_latency"] is None
    assert stats["normalized_reliability"] is None
    assert stats["normalized_stability"] is None
    assert stats["reliability_penalty"] is None


def test_all_zero_failure_rates_have_zero_normalized_reliability() -> None:
    faster = compute_stats([10, 10, 10, 10], total_runs=4, timeout_count=0, failure_count=0)
    slower = compute_stats([12, 12, 12, 12], total_runs=4, timeout_count=0, failure_count=0)
    results = [
        {"resolver": "1.1.1.1", "stats": faster},
        {"resolver": "8.8.8.8", "stats": slower},
    ]

    ranked = _ranked(results)

    assert ranked[0]["resolver"] == "1.1.1.1"
    assert ranked[0]["stats"]["normalized_reliability"] == 0.0
    assert ranked[1]["stats"]["normalized_reliability"] == 0.0


def test_tiny_failure_rate_penalty_exists_without_dominating_when_latency_gap_is_large() -> None:
    fast_tiny_fail = compute_stats([10.0] * 119, total_runs=120, timeout_count=0, failure_count=1)
    slow_reliable = compute_stats([25.0] * 120, total_runs=120, timeout_count=0, failure_count=0)
    results = [
        {"resolver": "1.1.1.1", "stats": fast_tiny_fail},
        {"resolver": "8.8.8.8", "stats": slow_reliable},
    ]

    ranked = _ranked(results)

    assert ranked[0]["resolver"] == "1.1.1.1"
    assert ranked[0]["stats"]["reliability_penalty"] > 0
    assert ranked[0]["stats"]["normalized_reliability"] == 1.0
    assert ranked[0]["stats"]["score_total"] < ranked[1]["stats"]["score_total"]


def test_unreliable_fast_resolver_is_excluded_from_recommendation() -> None:
    fast_unreliable = compute_stats([10.0] * 90, total_runs=100, timeout_count=0, failure_count=10)
    slower_reliable = compute_stats([20.0] * 100, total_runs=100, timeout_count=0, failure_count=0)
    ranked = _ranked(
        [
            {"resolver": "1.1.1.1", "stats": fast_unreliable},
            {"resolver": "8.8.8.8", "stats": slower_reliable},
        ]
    )

    assert ranked[0]["resolver"] == "1.1.1.1"
    assert ranked[0]["is_unreliable"] is True
    recommended, warning = select_recommended_resolver(ranked)
    assert recommended == "8.8.8.8"
    assert warning is None


def test_all_unreliable_resolvers_emit_warning_and_deterministic_fallback() -> None:
    r1 = compute_stats([10.0] * 90, total_runs=100, timeout_count=0, failure_count=10)
    r2 = compute_stats([11.0] * 90, total_runs=100, timeout_count=0, failure_count=10)
    ranked = _ranked(
        [
            {"resolver": "1.1.1.1", "stats": r1},
            {"resolver": "8.8.8.8", "stats": r2},
        ]
    )

    assert ranked[0]["is_unreliable"] is True
    assert ranked[1]["is_unreliable"] is True
    recommended, warning = select_recommended_resolver(ranked)
    assert recommended == ranked[0]["resolver"]
    assert warning == RECOMMENDATION_WARNING_ALL_UNRELIABLE


def test_percentile_empty():
    assert percentile([], 95) is None
