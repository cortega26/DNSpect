from __future__ import annotations

import csv
import io
import json

from app.cli_run import run, run_parser
from app.export import EXPORT_CSV_COLUMNS
from app.models import BenchmarkRequest


class FakeManager:
    def __init__(self, responses: list[dict | None] | None = None) -> None:
        self.responses = list(responses) if responses is not None else []
        self.started: list[BenchmarkRequest] = []

    def start(self, request: BenchmarkRequest) -> str:
        self.started.append(request)
        return "fake-id"

    def get(self, benchmark_id: str) -> dict | None:
        if not self.responses:
            return None
        return self.responses.pop(0)


def _stats() -> dict:
    return {
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
        "blocking_efficacy": 87.5,
        "blocked_count": 7,
        "blocking_test_count": 9,
        "score_blocking": 12.3,
        "normalized_blocking": 0.45,
        "nxdomain_hijack_detected": False,
        "dnssec_validating": True,
    }


def _done_state() -> dict:
    return {
        "id": "fake-id",
        "status": "done",
        "progress": {"current": 2, "total": 2},
        "started_at": "2026-08-11T00:00:00Z",
        "finished_at": "2026-08-11T00:00:01Z",
        "mode": "quick",
        "goal": "speed",
        "scoring_profile": "speed",
        "protocol": "udp",
        "timeout_sec": 2.0,
        "runs": 2,
        "engine": "dnspython",
        "error": None,
        "run_storage_warning": None,
        "results": [
            {
                "resolver": "1.1.1.1",
                "provider_id": "cloudflare",
                "provider_name": "Cloudflare",
                "engine": "dnspython",
                "protocol": "udp",
                "stats": _stats(),
                "samples": [],
                "sample_count": 0,
            }
        ],
        "recommended_resolver": "1.1.1.1",
        "recommendation_warning": None,
        "target_snapshot": None,
        "manifest": None,
    }


def test_run_done_exits_zero_and_prints_table(capsys) -> None:
    manager = FakeManager([_done_state()])
    args = run_parser().parse_args(["--resolvers", "1.1.1.1"])
    code = run(args, manager)
    captured = capsys.readouterr()
    assert code == 0
    assert "1.1.1.1" in captured.out
    assert "Cloudflare" in captured.out
    assert "11.53" in captured.out


def test_run_json_output_matches_state(capsys) -> None:
    manager = FakeManager([_done_state()])
    args = run_parser().parse_args(["--format", "json"])
    code = run(args, manager)
    captured = capsys.readouterr()
    assert code == 0
    assert json.loads(captured.out) == _done_state()


def test_run_csv_output_matches_backend_contract(capsys) -> None:
    manager = FakeManager([_done_state()])
    args = run_parser().parse_args(["--format", "csv"])
    code = run(args, manager)
    captured = capsys.readouterr()
    assert code == 0
    rows = list(csv.reader(io.StringIO(captured.out)))
    assert rows[0] == list(EXPORT_CSV_COLUMNS)


def test_run_failed_exits_two(capsys) -> None:
    state = _done_state()
    state["status"] = "failed"
    state["error"] = "boom"
    manager = FakeManager([state])
    args = run_parser().parse_args(["--resolvers", "1.1.1.1"])
    code = run(args, manager)
    captured = capsys.readouterr()
    assert code == 2
    assert "boom" in captured.err


def test_run_validation_error_exits_one(capsys) -> None:
    manager = FakeManager()
    args = run_parser().parse_args(["--resolvers", "999.1.1.1"])
    code = run(args, manager)
    captured = capsys.readouterr()
    assert code == 1
    assert "999.1.1.1" in captured.err


def test_run_progress_suppressed_when_not_tty(capsys) -> None:
    running = _done_state()
    running["status"] = "running"
    running["progress"] = {"current": 1, "total": 2}
    manager = FakeManager([running, _done_state()])
    args = run_parser().parse_args(["--resolvers", "1.1.1.1"])
    code = run(args, manager)
    captured = capsys.readouterr()
    assert code == 0
    assert "progress=" not in captured.out
    assert "progress=" not in captured.err
