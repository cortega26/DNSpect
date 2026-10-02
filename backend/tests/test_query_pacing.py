from __future__ import annotations

import time
from pathlib import Path

import pytest

from app.models import BenchmarkRequest
from app.runner import DEFAULT_QUERY_PACE_MS, BenchmarkManager, resolve_query_pace_ms


def _wait_terminal(manager: BenchmarkManager, benchmark_id: str, timeout_sec: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        state = manager.get(benchmark_id)
        if state and state["status"] in {"done", "error", "cancelled"}:
            return state
        time.sleep(0.01)
    raise AssertionError("benchmark did not reach a terminal state")


def _run_with_pacing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    pace_ms: int | None,
    runs: int = 4,
) -> tuple[list[float], list[str]]:
    """Run a real benchmark and return the wall-clock gaps between queries and
    the domains the runner actually issued, in order."""
    manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        data_runs_dir=tmp_path / "runs",
        query_pace_ms=pace_ms,
    )
    manager.blocking_test_queries = []

    issued_at: list[float] = []
    domains: list[str] = []

    def fake_measure(*, resolver, domain, timeout_sec, engine):
        del timeout_sec, engine
        issued_at.append(time.monotonic())
        domains.append(domain)

        return {
            "ok": True,
            "ms": 20.0,
            "query": domain,
            "error": None,
            "failure_kind": None,
            "resolver": resolver,
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=runs,
            timeout_sec=2.0,
            resolvers=["1.1.1.1"],
            queries=["example.com"],
            protocol="udp",
        )
    )
    state = _wait_terminal(manager, benchmark_id)
    assert state["status"] == "done"
    # Every consecutive query in a resolver's series is paced -- the latency
    # runs, the blocking-efficacy probes and the integrity probes alike -- so
    # the whole sequence can be asserted without splitting it into series.
    gaps = [b - a for a, b in zip(issued_at, issued_at[1:], strict=False)]
    return gaps, domains


def test_query_pace_defaults_to_twenty_milliseconds(monkeypatch: pytest.MonkeyPatch) -> None:
    # Back-to-back queries measure queueing rather than resolver latency, and a
    # burst is indistinguishable from a slow resolver. GRC's DNS Benchmark spaces
    # queries ~20ms apart for this reason; that is the default here.
    monkeypatch.delenv("DNS_SPEED_LAB_QUERY_PACE_MS", raising=False)
    assert resolve_query_pace_ms() == DEFAULT_QUERY_PACE_MS
    assert DEFAULT_QUERY_PACE_MS == 20


def test_query_pace_is_configurable_and_never_negative(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DNS_SPEED_LAB_QUERY_PACE_MS", raising=False)
    assert resolve_query_pace_ms(0) == 0
    assert resolve_query_pace_ms(250) == 250
    assert resolve_query_pace_ms(-5) == 0

    monkeypatch.setenv("DNS_SPEED_LAB_QUERY_PACE_MS", "75")
    assert resolve_query_pace_ms() == 75
    # An explicit argument wins over the environment.
    assert resolve_query_pace_ms(5) == 5

    # Garbage falls back to the default rather than breaking a run.
    monkeypatch.setenv("DNS_SPEED_LAB_QUERY_PACE_MS", "not-a-number")
    assert resolve_query_pace_ms() == DEFAULT_QUERY_PACE_MS

    monkeypatch.setenv("DNS_SPEED_LAB_QUERY_PACE_MS", "-1")
    assert resolve_query_pace_ms() == 0


def test_manager_reads_pace_from_constructor_and_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DNS_SPEED_LAB_QUERY_PACE_MS", "120")
    assert BenchmarkManager(data_runs_dir=tmp_path / "r1").query_pace_ms == 120
    assert BenchmarkManager(data_runs_dir=tmp_path / "r2", query_pace_ms=0).query_pace_ms == 0


def test_runner_actually_spaces_consecutive_queries(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    pace = 60
    gaps, domains = _run_with_pacing(monkeypatch, tmp_path, pace_ms=pace, runs=5)

    # runs=5 scheduled queries plus the blocking-efficacy and integrity probes.
    scheduled = [d for d in domains if d == "example.com"]
    assert len(scheduled) == 5
    assert len(gaps) == len(domains) - 1
    assert len(gaps) >= 4
    # Every gap after the first query is paced. The first query of a resolver is
    # deliberately not delayed, or each series would open with a fixed penalty.
    for gap in gaps:
        assert gap >= pace / 1000 * 0.8, f"gap {gap:.4f}s below the {pace}ms cadence"


def test_pacing_can_be_disabled_entirely(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    gaps, domains = _run_with_pacing(monkeypatch, tmp_path, pace_ms=0, runs=5)

    scheduled = [d for d in domains if d == "example.com"]
    assert len(scheduled) == 5
    # With pacing off the queries are issued back to back; allow generous slack
    # for scheduler noise but it must be far below the paced case.
    for gap in gaps:
        assert gap < 0.02, f"gap {gap:.4f}s looks paced even though pacing is off"


def test_pacing_applies_to_the_blocking_efficacy_series(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    manager = BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        data_runs_dir=tmp_path / "runs",
        query_pace_ms=50,
    )
    assert len(manager.blocking_test_queries) > 1

    issued_at: list[float] = []

    def fake_measure(*, resolver, domain, timeout_sec, engine):
        del timeout_sec, engine
        issued_at.append(time.monotonic())
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": None,
            "failure_kind": "nxdomain",
            "resolver": resolver,
        }

    monkeypatch.setattr("app.runner.measure_query", fake_measure)
    monkeypatch.setattr("app.runner.select_engine", lambda: "dnspython")

    benchmark_id = manager.start(
        BenchmarkRequest(
            runs=1,
            timeout_sec=2.0,
            resolvers=["1.1.1.1"],
            queries=["example.com"],
            protocol="udp",
        )
    )
    _wait_terminal(manager, benchmark_id)

    blocking_count = len(manager.blocking_test_queries)
    total = len(issued_at)
    # 1 scheduled query + blocking-efficacy probes + 2 integrity probes
    # (NXDOMAIN hijack and DNSSEC), which the runner adds on top.
    assert total == 1 + blocking_count + 2

    # The probes continue the same per-resolver sequence, so the hand-off from
    # the last latency query to the first probe is paced as well.
    gaps = [b - a for a, b in zip(issued_at, issued_at[1:], strict=False)]
    for gap in gaps:
        assert gap >= 0.04, f"probe gap {gap:.4f}s below the 50ms cadence"


def test_pacing_keeps_the_exhaustive_budget_accounted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The default cadence adds a known, small cost per resolver, asserted so a
    future change to the default cannot silently inflate the duration estimate."""
    monkeypatch.delenv("DNS_SPEED_LAB_QUERY_PACE_MS", raising=False)
    pace = resolve_query_pace_ms()
    queries_per_resolver = 60
    pacing_seconds = (queries_per_resolver - 1) * pace / 1000

    assert pacing_seconds == pytest.approx(1.18, abs=0.01)
