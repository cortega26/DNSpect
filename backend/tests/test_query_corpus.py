from __future__ import annotations

from app.models import MODE_DEFAULT_RUNS, BenchmarkMode
from app.providers import load_default_queries


def _schedule(queries: list[str], runs: int) -> list[str]:
    return [queries[run_idx % len(queries)] for run_idx in range(runs)]


def test_default_corpus_has_more_domains_than_any_but_exhaustive_mode() -> None:
    queries = load_default_queries()

    assert len(queries) >= 54
    # quick and standard must never repeat a name, or the run self-warms.
    for mode in (BenchmarkMode.quick, BenchmarkMode.standard):
        runs = MODE_DEFAULT_RUNS[mode]
        schedule = _schedule(queries, runs)
        assert len(schedule) == runs
        assert len(set(schedule)) == runs, f"{mode.value} repeats a domain"


def test_measured_schedule_repetition_matches_the_documented_table() -> None:
    """The methodology doc publishes this table. If the schedule ever changes,
    the doc must be updated in the same change rather than quietly going stale."""
    queries = load_default_queries()
    documented = {
        BenchmarkMode.quick: {"runs": 12, "distinct": 12, "repeats": 0},
        BenchmarkMode.standard: {"runs": 30, "distinct": 30, "repeats": 0},
        BenchmarkMode.exhaustive: {"runs": 80, "distinct": 54, "repeats": 26},
    }

    assert MODE_DEFAULT_RUNS[BenchmarkMode.standard] == 30
    for mode, expected in documented.items():
        runs = MODE_DEFAULT_RUNS[mode]
        schedule = _schedule(queries, runs)
        assert runs == expected["runs"], mode.value
        assert len(set(schedule)) == expected["distinct"], mode.value
        assert len(schedule) - len(set(schedule)) == expected["repeats"], mode.value


def test_corpus_header_does_not_claim_to_reduce_cache_bias() -> None:
    """The corpus is high-traffic names, so it cannot reduce cache bias. The
    header used to claim it did; that claim is what the whole measurement
    methodology doc exists to correct, so it is pinned here."""
    from app.providers import QUERIES_PATH

    header = QUERIES_PATH.read_text(encoding="utf-8").splitlines()[:12]
    text = "\n".join(header).lower()

    assert "sesgo de caché" in text  # the header must address the topic
    assert "no reduce el sesgo de caché" in text
    assert "reducir sesgo de caché y reflejar" not in text


def test_every_query_is_a_plain_lowercase_domain() -> None:
    queries = load_default_queries()

    assert queries == [q.strip().lower() for q in queries]
    assert all(q and not q.startswith("#") for q in queries)
    assert len(set(queries)) == len(queries), "duplicate domains would skew the profile"
