from app.stats import compute_stats, percentile


def test_stats_median_and_p95():
    samples = [10, 20, 30, 40, 50]
    stats = compute_stats(samples, total_runs=7, timeout_count=2)

    assert stats["median_ms"] == 30
    assert stats["p95_ms"] == 48
    assert stats["ok_count"] == 5
    assert stats["timeout_count"] == 2
    assert stats["success_rate"] == 0.7143
    assert stats["timeout_rate"] == 0.2857


def test_percentile_empty():
    assert percentile([], 95) is None
