"""Headless benchmark CLI: the ``dnspect run`` subcommand.

Builds a validated :class:`BenchmarkRequest`, starts it through a
:class:`BenchmarkManager`, polls until a terminal status, and prints the
results as a table, JSON, or CSV. The manager is injectable so tests can
drive the full lifecycle without performing DNS queries.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.export import build_csv
from app.models import BenchmarkGoal, BenchmarkMode, BenchmarkProtocol, BenchmarkRequest
from app.runner import TERMINAL_STATUSES, BenchmarkManager

_POLL_INTERVAL_SEC = 0.5
_MAX_GET_MISSES = 2

TABLE_HEADER: tuple[str, ...] = (
    "#",
    "RESOLVER",
    "PROVIDER",
    "MEDIAN_MS",
    "P95_MS",
    "SUCCESS%",
    "BLOCKING%",
    "SCORE",
)
_TEXT_COLUMNS = {1, 2}


def run_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dnspect run",
        description="Run a headless DNS benchmark and print the results.",
    )
    parser.add_argument(
        "--resolvers",
        metavar="IP1,IP2",
        help="Comma-separated resolver IP addresses (1-256).",
    )
    parser.add_argument(
        "--queries",
        metavar="DOMAIN1,DOMAIN2",
        help="Comma-separated query domains (1-256).",
    )
    parser.add_argument(
        "--queries-file",
        metavar="PATH",
        help="File with one query domain per line; '#' starts a comment line.",
    )
    parser.add_argument(
        "--goal",
        choices=[goal.value for goal in BenchmarkGoal],
        help="Scoring goal that determines the ranking weights.",
    )
    parser.add_argument(
        "--mode",
        choices=[mode.value for mode in BenchmarkMode],
        default=BenchmarkMode.standard.value,
        help="Benchmark mode (default: standard).",
    )
    parser.add_argument(
        "--runs",
        type=int,
        metavar="N",
        help="Runs per resolver, 1-300 (default: mode-dependent).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        metavar="SEC",
        default=2.0,
        help="Per-query timeout in seconds, 0.1-10 (default: 2.0).",
    )
    parser.add_argument(
        "--protocol",
        choices=[protocol.value for protocol in BenchmarkProtocol],
        default=BenchmarkProtocol.udp.value,
        help="DNS transport protocol (default: udp).",
    )
    parser.add_argument(
        "--format",
        choices=("table", "json", "csv"),
        default="table",
        help="Output format (default: table).",
    )
    parser.add_argument(
        "--output",
        metavar="PATH",
        help="Write the output to this file instead of stdout.",
    )
    return parser


def _read_queries_file(path: str) -> list[str]:
    try:
        raw_lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ValueError(f"Cannot read queries file: {path} ({exc})") from exc
    queries: list[str] = []
    for raw in raw_lines:
        line = raw.strip()
        if line and not line.startswith("#"):
            queries.append(line)
    return queries


def build_request(args: argparse.Namespace) -> BenchmarkRequest:
    queries: list[str] | None = None
    if args.queries:
        queries = args.queries.split(",")
    if args.queries_file:
        queries = (queries or []) + _read_queries_file(args.queries_file)
    return BenchmarkRequest(
        runs=args.runs,
        timeout_sec=args.timeout,
        resolvers=args.resolvers.split(",") if args.resolvers else None,
        queries=queries,
        mode=BenchmarkMode(args.mode),
        goal=BenchmarkGoal(args.goal) if args.goal else None,
        protocol=BenchmarkProtocol(args.protocol),
    )


def _format_validation_error(exc: ValidationError) -> str:
    return "; ".join(
        f"{'/'.join(str(part) for part in err['loc'])}: {err['msg']}" for err in exc.errors()
    )


def _cell_text(value: object) -> str:
    if value is None:
        return "-"
    text = str(value)
    return text if text else "-"


def _fmt_number(value: object) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{value:.2f}"
    return "-"


def _fmt_percent(value: object) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{value * 100:.1f}"
    return "-"


def _row_cells(rank: int, item: dict[str, Any]) -> list[str]:
    stats = item.get("stats") or {}
    return [
        str(rank),
        _cell_text(item.get("resolver")),
        _cell_text(item.get("provider_name")),
        _fmt_number(stats.get("median_ms")),
        _fmt_number(stats.get("p95_ms")),
        _fmt_percent(stats.get("success_rate")),
        _fmt_percent(stats.get("blocking_efficacy")),
        _fmt_number(stats.get("score_total")),
    ]


def _align(cell: str, column: int, widths: list[int]) -> str:
    if column in _TEXT_COLUMNS:
        return cell.ljust(widths[column])
    return cell.rjust(widths[column])


def format_table(state: dict[str, Any]) -> str:
    results = sorted(
        state.get("results") or [],
        key=lambda item: (
            -((item.get("stats") or {}).get("score_total") or 0.0),
            str(item.get("resolver") or ""),
        ),
    )
    rows = [_row_cells(rank, item) for rank, item in enumerate(results, start=1)]
    widths = [len(column) for column in TABLE_HEADER]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))
    lines = ["  ".join(_align(cell, index, widths) for index, cell in enumerate(TABLE_HEADER))]
    lines.extend(
        "  ".join(_align(cell, index, widths) for index, cell in enumerate(row)) for row in rows
    )
    return "\n".join(lines) + "\n"


def format_json(state: dict[str, Any]) -> str:
    return json.dumps(state, ensure_ascii=False, indent=2) + "\n"


def format_csv(state: dict[str, Any]) -> str:
    return build_csv(state)


def _render_output(fmt: str, state: dict[str, Any]) -> str:
    if fmt == "table":
        return format_table(state)
    if fmt == "json":
        return format_json(state)
    return format_csv(state)


def _wait_for_terminal(manager: BenchmarkManager, benchmark_id: str) -> dict[str, Any] | None:
    tty = sys.stderr.isatty()
    misses = 0
    while True:
        state = manager.get(benchmark_id)
        if state is None:
            misses += 1
            if misses >= _MAX_GET_MISSES:
                print("error: benchmark state lost", file=sys.stderr)
                return None
        else:
            misses = 0
            status = state.get("status")
            if tty:
                progress = state.get("progress") or {}
                print(
                    f"status={status} progress={progress.get('current')}/{progress.get('total')}",
                    end="\r",
                    file=sys.stderr,
                    flush=True,
                )
            if status in TERMINAL_STATUSES:
                if tty:
                    print(file=sys.stderr)
                return state
        time.sleep(_POLL_INTERVAL_SEC)


def _write_output(args: argparse.Namespace, state: dict[str, Any]) -> int:
    output = _render_output(args.format, state)
    if args.output:
        try:
            Path(args.output).write_text(output, encoding="utf-8")
        except OSError as exc:
            print(f"error: cannot write output file: {exc}", file=sys.stderr)
            return 1
    else:
        sys.stdout.write(output)
    return 0


def run(args: argparse.Namespace, manager: BenchmarkManager) -> int:
    try:
        request = build_request(args)
    except ValidationError as exc:
        print(f"error: {_format_validation_error(exc)}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    try:
        benchmark_id = manager.start(request)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    state = _wait_for_terminal(manager, benchmark_id)
    if state is None:
        return 1

    status = state.get("status")
    if status == "done":
        return _write_output(args, state)
    if status == "failed":
        print(state.get("error") or "benchmark failed", file=sys.stderr)
        return 2
    print("benchmark cancelled", file=sys.stderr)
    return 2


def main(argv: list[str] | None = None) -> int:
    args = run_parser().parse_args(argv)
    try:
        return run(args, BenchmarkManager())
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
