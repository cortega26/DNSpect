import pytest

from app.stats import (
    GOAL_WEIGHTS,
    RECOMMENDATION_WARNING_ALL_UNRELIABLE,
    RECOMMENDATION_WARNING_NO_USABLE_RESULTS,
    RELIABILITY_REFERENCE_PENALTY,
    apply_normalized_scoring,
    compute_blocking_efficacy,
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
            (
                item["stats"]["score_stability"]
                if item["stats"]["score_stability"] is not None
                else float("inf")
            ),
            item["resolver"],
        )
    )
    return results


def test_stats_median_and_p95():
    samples = [10, 20, 30, 40, 50]
    stats = compute_stats(samples, total_runs=7, timeout_count=2, failure_count=3)

    assert stats["median_ms"] == 30
    assert stats["p95_ms"] == 48
    assert stats["p99_ms"] == 49.6
    assert stats["stddev_ms"] == 15.811
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


def test_stats_p99_and_stddev_track_a_single_outlier_batch() -> None:
    """At a realistic sample size one stalled batch leaves p95 untouched while
    p99 and the sample stdev absorb it, which is what makes them worth
    reporting alongside p95."""
    steady_samples = [10.0] * 20 + [11.0]
    spiky_samples = [10.0] * 20 + [300.0]
    steady = compute_stats(steady_samples, total_runs=21, timeout_count=0, failure_count=0)
    spiky = compute_stats(spiky_samples, total_runs=21, timeout_count=0, failure_count=0)

    assert spiky["p95_ms"] == steady["p95_ms"]
    assert spiky["p99_ms"] > steady["p99_ms"] * 10
    assert spiky["stddev_ms"] > steady["stddev_ms"] * 10
    assert spiky["max_ms"] == 300.0


def test_stats_p99_and_stddev_degenerate_inputs() -> None:
    single = compute_stats([42], total_runs=1, timeout_count=0, failure_count=0)
    assert single["p99_ms"] == 42
    # A single sample cannot carry a sample standard deviation, and null is
    # honest where 0.0 would claim an unmeasured steadiness.
    assert single["stddev_ms"] is None

    uniform = compute_stats([7, 7, 7], total_runs=3, timeout_count=0, failure_count=0)
    assert uniform["p99_ms"] == 7
    assert uniform["stddev_ms"] == 0.0


def test_stats_p99_and_stddev_are_none_without_a_successful_sample() -> None:
    stats = compute_stats([], total_runs=4, timeout_count=2, failure_count=2)

    assert stats["p99_ms"] is None
    assert stats["stddev_ms"] is None


def test_stats_p99_is_never_below_p95() -> None:
    samples = [5, 9, 12, 15, 15, 18, 22, 26, 31, 90]
    stats = compute_stats(samples, total_runs=len(samples), timeout_count=0, failure_count=0)

    assert stats["p95_ms"] <= stats["p99_ms"] <= stats["max_ms"]


def test_stats_new_spread_metrics_do_not_change_scoring() -> None:
    """Adding p99/stddev must not perturb ranking: score_stability stays
    p95 - median, so determinism and backward compatibility hold."""
    samples = [12, 14, 15, 16, 40]
    stats = compute_stats(samples, total_runs=5, timeout_count=0, failure_count=0)

    assert stats["score_latency"] == stats["avg_ms"]
    assert stats["score_stability"] == stats["p95_minus_median_ms"]
    assert stats["score_stability"] == pytest.approx(stats["p95_ms"] - stats["median_ms"])


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
    assert 0.0 < ranked[0]["stats"]["normalized_reliability"] < 1.0
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


def test_ab_order_is_invariant_when_unrelated_bad_resolver_is_added() -> None:
    fast_with_small_fail = compute_stats([18.951] * 98, total_runs=100, timeout_count=0, failure_count=2)
    slower_perfect = compute_stats([21.834] * 100, total_runs=100, timeout_count=0, failure_count=0)
    very_bad = compute_stats([60.0] * 10, total_runs=100, timeout_count=0, failure_count=90)

    ranked_ab = _ranked(
        [
            {"resolver": "A", "stats": fast_with_small_fail.copy()},
            {"resolver": "B", "stats": slower_perfect.copy()},
        ]
    )
    ranked_abc = _ranked(
        [
            {"resolver": "A", "stats": fast_with_small_fail.copy()},
            {"resolver": "B", "stats": slower_perfect.copy()},
            {"resolver": "C", "stats": very_bad.copy()},
        ]
    )

    winner_ab = ranked_ab[0]["resolver"]
    winner_abc = next(item["resolver"] for item in ranked_abc if item["resolver"] in {"A", "B"})
    assert winner_ab == winner_abc
    assert ranked_abc[2]["resolver"] == "C"


def test_reliability_normalization_uses_fixed_reference_penalty() -> None:
    stable = compute_stats([20.0] * 100, total_runs=100, timeout_count=0, failure_count=0)
    slightly_unstable = compute_stats([20.0] * 98, total_runs=100, timeout_count=0, failure_count=2)
    ranked = _ranked(
        [
            {"resolver": "stable", "stats": stable.copy()},
            {"resolver": "slightly_unstable", "stats": slightly_unstable.copy()},
        ]
    )
    by_name = {item["resolver"]: item for item in ranked}
    assert by_name["stable"]["stats"]["max_rel_penalty"] == round(RELIABILITY_REFERENCE_PENALTY, 6)
    assert by_name["slightly_unstable"]["stats"]["max_rel_penalty"] == round(RELIABILITY_REFERENCE_PENALTY, 6)
    assert by_name["stable"]["stats"]["normalized_reliability"] == 0.0
    assert by_name["slightly_unstable"]["stats"]["normalized_reliability"] > 0.0


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


def test_recommendation_requires_usable_stats() -> None:
    r1 = compute_stats([], total_runs=4, timeout_count=0, failure_count=0)
    ranked = _ranked([{"resolver": "1.1.1.1", "stats": r1}])

    recommended, warning = select_recommended_resolver(ranked)
    assert recommended is None
    assert warning == RECOMMENDATION_WARNING_NO_USABLE_RESULTS


def test_no_usable_results_with_non_empty_list_returns_warning() -> None:
    r1 = compute_stats([], total_runs=4, timeout_count=0, failure_count=0)
    r2 = compute_stats([], total_runs=4, timeout_count=0, failure_count=0)
    ranked = _ranked(
        [
            {"resolver": "1.1.1.1", "stats": r1},
            {"resolver": "8.8.8.8", "stats": r2},
        ]
    )

    recommended, warning = select_recommended_resolver(ranked)
    assert recommended is None
    assert warning == RECOMMENDATION_WARNING_NO_USABLE_RESULTS


def test_all_unreliable_with_usable_stats_still_falls_back() -> None:
    r1 = compute_stats([10.0] * 90, total_runs=100, timeout_count=0, failure_count=10)
    r2 = compute_stats([11.0] * 90, total_runs=100, timeout_count=0, failure_count=10)
    ranked = _ranked(
        [
            {"resolver": "1.1.1.1", "stats": r1},
            {"resolver": "8.8.8.8", "stats": r2},
        ]
    )

    recommended, warning = select_recommended_resolver(ranked)
    assert recommended == "1.1.1.1"
    assert warning == RECOMMENDATION_WARNING_ALL_UNRELIABLE


def test_percentile_empty():
    assert percentile([], 95) is None


def test_compute_blocking_efficacy_all_blocked():
    samples = [
        {"failure_kind": "nxdomain"},
        {"failure_kind": "refused"},
        {"failure_kind": "nxdomain", "ok": False},
    ]
    result = compute_blocking_efficacy(samples)
    assert result["blocking_efficacy"] == 1.0
    assert result["blocked_count"] == 3
    assert result["blocking_test_count"] == 3


def test_compute_blocking_efficacy_none_blocked():
    samples = [
        {"failure_kind": None, "ok": True, "ms": 15.0},
        {"failure_kind": "timeout"},
        {"failure_kind": "servfail"},
    ]
    result = compute_blocking_efficacy(samples)
    assert result["blocking_efficacy"] == 0.0
    assert result["blocked_count"] == 0


def test_compute_blocking_efficacy_partial():
    samples = [
        {"failure_kind": "nxdomain"},
        {"failure_kind": None, "ok": True, "answer_ips": ["1.2.3.4"]},
        {"failure_kind": "refused"},
        {"failure_kind": "noanswer"},
    ]
    result = compute_blocking_efficacy(samples)
    assert result["blocking_efficacy"] == 0.5
    assert result["blocked_count"] == 2


def test_compute_blocking_efficacy_sinkhole_detected():
    samples = [
        {"failure_kind": None, "ok": True, "answer_ips": ["0.0.0.0"]},
        {"failure_kind": None, "ok": True, "answer_ips": ["0.0.0.0"]},
        {"failure_kind": None, "ok": True, "answer_ips": ["64.233.186.102"]},
    ]
    result = compute_blocking_efficacy(samples)
    assert result["blocking_efficacy"] == round(2.0 / 3.0, 4)
    assert result["blocked_count"] == 2


def test_compute_blocking_efficacy_empty_list():
    result = compute_blocking_efficacy([])
    assert result["blocking_efficacy"] is None


def test_goal_weights_include_blocking():
    for goal, weights in GOAL_WEIGHTS.items():
        assert len(weights) == 4, f"{goal} should have 4 weights"
        assert abs(sum(weights) - 1.0) < 0.001, f"{goal} weights must sum to 1.0"
