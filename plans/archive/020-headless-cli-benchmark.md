# Plan 020: Headless CLI benchmark (`dnspect run`) — roadmap item 4

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 087e5ff..HEAD -- backend/app/cli.py backend/app/cli_run.py backend/app/export.py backend/tests/test_cli_run.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/019-backend-csv-diagnostics-parity.md` (its `app/export.py` shared CSV builder is consumed here)
- **Category**: direction (README roadmap item 4 — "CLI-only mode (headless, no UI dependency)")
- **Planned at**: commit `087e5ff`, 2026-08-11

## Why this matters

The README roadmap promises a CLI-only mode, but today the only headless
option boots an HTTP server (`DNS_SPEED_LAB_GUI=headless`, `cli.py:101-110`)
and requires HTTP polling to get results. There is no way to run a benchmark
from a script. The measurement pipeline already exists and is deterministic —
`BenchmarkManager.start()` + `get()` gives everything a CLI needs — so a thin
command-line front (`dnspect run --resolvers 1.1.1.1,8.8.8.8 --goal speed`)
delivers scripting, cron/CI automation, and the execution substrate that the
monitoring design (plan 021) will build on. It also gives packaged-binary
users a headless path (`packaged_main.py` already delegates to
`app.cli.main()`).

## Current state

- `backend/app/cli.py:92-129` — `main()` is env-var driven
  (`DNS_SPEED_LAB_GUI` in `auto|native|browser|headless`); no argparse, no
  subcommands, and **no `import sys`** (imports are os, threading, time,
  urllib.error, urllib.request — lines 3-7). `packaged_main.py:6-9` calls
  `app.cli.main()` with no args — the packaged binary's behavior must stay
  unchanged when no subcommand is given.
- `backend/pyproject.toml:41-42` — a console script already exists:
  `[project.scripts] dnspect = "app.cli:main"`, so the CLI is invoked as
  `dnspect run ...` after editable install (`python -m app.cli run ...` works
  in a dev venv as the equivalent).
- `backend/app/runner.py:753-809` — `BenchmarkManager.start(request)` runs
  admission checks (work budget, queue capacity), builds the run manifest,
  persists, submits to the thread pool, and returns a `benchmark_id` string.
  `runner.py:893-908` — `get(benchmark_id)` returns the full state dict
  (same shape as the `/api/benchmarks/{id}` response) or `None`.
- `backend/app/models.py:95-136` — `BenchmarkRequest` (pydantic) validates
  `runs` (1..300), `timeout_sec` (0.1..10), `resolvers` (IP literals, ≤256),
  `queries` (≤256), `mode`, `goal`/`scoring_profile`, `protocol` — the CLI
  passes through these fields and gets identical validation for free.
- `backend/app/export.py` — created by plan 019; exports
  `EXPORT_CSV_COLUMNS` and `build_csv(state)` (plan 019's done criteria must
  hold before this plan's Step 3).
- `backend/app/runner.py:1763-1895` — `_run()` is the synchronous pipeline
  (samples → blocking → NXDOMAIN → DNSSEC → `_set_done`); `start()` already
  drives it on the pool, so the CLI must only start + poll, never re-run
  measurement logic.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 087e5ff..HEAD -- backend/app/cli.py backend/app/cli_run.py backend/app/export.py backend/tests/test_cli_run.py` | exit 0 (empty or only expected merged-plan context) |
| Single test | `cd backend && . .venv/bin/activate && pytest tests/test_cli_run.py -q` | all pass |
| Manual smoke | `cd backend && . .venv/bin/activate && dnspect run --resolvers 1.1.1.1 --runs 3 --timeout 1 --goal speed --format table` | exit 0, table printed (performs live DNS queries — run only on a machine with network) |
| Full gate   | `make backend-check`     | exit 0 (ruff lint → ruff format --check → mypy → bandit → pytest) |

## Scope

**In scope** (the only files you should modify):
- `backend/app/cli_run.py` (new) — the `run` subcommand implementation
- `backend/app/cli.py` — dispatch to `cli_run` when `argv[1] == "run"`
- `backend/tests/test_cli_run.py` (new)

**Out of scope** (do NOT touch, even though they look related):
- `backend/app/runner.py`, `main.py`, `models.py` — the API surface and
  measurement pipeline stay untouched; the CLI is a thin client of
  `BenchmarkManager`.
- `frontend/` — no UI work in this plan.
- Real-network behavior in tests — tests must inject a fake manager (no DNS
  queries in CI; the repo's tests never perform live queries).
- Refactoring `cli.py`'s GUI modes or its module-level `from app.main import
  app` import (known startup cost; see Maintenance notes).
- Scheduler/alerting work (plan 021).

## Git workflow

- Branch: `plan/020-headless-cli-benchmark`
- Commit per step, conventional commits matching the repo log (`feat(cli): ...`,
  `test(cli): ...`). The merge commit on main is
  `merge: plan 020 — headless CLI benchmark`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `backend/app/cli_run.py` — the `run` subcommand

Module layout (pure functions separated from I/O so tests can call them):

- `run_parser() -> argparse.ArgumentParser` with:
  - positional-less flags: `--resolvers` (comma-separated IPs, `metavar="IP1,IP2"`),
    `--queries` (comma-separated domains), `--queries-file PATH` (one domain
    per line, `#` comments — same convention as `data/queries.txt`),
    `--goal` (choices from `BenchmarkGoal` values: `speed, security, privacy,
    ad-blocking, family`), `--mode` (choices `quick, standard, exhaustive`,
    default `standard`), `--runs` (int, 1..300), `--timeout` (float, 0.1..10,
    default 2.0), `--protocol` (choices `udp, dot, doh`, default `udp`),
    `--format` (choices `table, json, csv`, default `table`), `--output PATH`
    (default: stdout).
  - Help text in English (the CLI is a developer surface; the GUI's Spanish
    strings are i18n-managed and out of scope here).
- `build_request(args) -> BenchmarkRequest` — maps parsed args to the pydantic
  model; `--queries-file` content joins `--queries`. **Validation happens
  here**: let `BenchmarkRequest` raise; the caller maps `ValidationError` and
  `ValueError` to exit code 1 with the message on stderr.
- `format_table(state: dict) -> str` — rank rows by `score_total` descending,
  tie-break by `resolver` ascending (deterministic — matches the repo's
  determinism contract). Columns, fixed-width, no new dependencies:
  `#  RESOLVER  PROVIDER  MEDIAN_MS  P95_MS  SUCCESS%  BLOCKING%  SCORE`.
  Values read from `item["stats"]` with `.get(...)`; `None` renders as `-`.
- `format_json(state: dict) -> str` — `json.dumps(state, ensure_ascii=False, indent=2)`.
- `format_csv(state: dict) -> str` — `build_csv(state)` from `app.export`.
- `run(args, manager) -> int` — the orchestration, injectable for tests:
  1. `req = build_request(args)`
  2. `benchmark_id = manager.start(req)` — `ValueError` → message on stderr,
     return 1
  3. Poll `manager.get(benchmark_id)` every 0.5 s (with `time.sleep(0.5)`)
     until the state's `status` is in `{"done", "failed", "cancelled"}`
     (the repo's `TERMINAL_STATUSES`, `runner.py:64`); `get()` returning
     `None` twice in a row → error message, return 1. If stderr is a TTY,
     print a one-line `\r`-updating progress
     `status=<status> progress=<current>/<total>` (from the state dict's
     `progress` object, whose keys are `current`/`total` — see
     `BenchmarkState.as_response()` at `runner.py:455-475`); suppress when
     not a TTY.
  4. `done` → write the formatted output to `--output` or stdout; return 0.
     `failed` → print `error` from the state to stderr; return 2.
- `main(argv: list[str] | None = None) -> int` — `run_parser().parse_args(argv)`,
  then `run(args, BenchmarkManager())`, `sys.exit` with the return code.
  Wrap `KeyboardInterrupt` → stderr `interrupted`, return 130.
- Follow the repo's style: module docstring, `from __future__ import
  annotations`, type hints everywhere (mypy is a gate).

**Verify**: `cd backend && . .venv/bin/activate && python -m app.cli_run --help` → usage text exits 0 (verify manually before wiring the dispatch in Step 2).

### Step 2: Wire the dispatch in `cli.py`

In `backend/app/cli.py`, add `import sys` to the imports block (lines 3-7),
then in `main()` before the env-var GUI logic:

```python
if len(sys.argv) > 1 and sys.argv[1] == "run":
    from .cli_run import main as run_main
    raise SystemExit(run_main(sys.argv[2:]))
```

(import inside the branch so `python -m app.cli` GUI mode pays nothing).
All existing env-var behavior must remain byte-identical when no subcommand
is given.

**Verify**: `cd backend && . .venv/bin/activate && dnspect run --resolvers 1.1.1.1 --runs 3 --timeout 1 --goal speed --format table` → exit 0 with a table (live DNS — needs network). Also `dnspect run --resolvers not-an-ip --format json` → exit 1, validation message on stderr.

### Step 3: Tests — `backend/tests/test_cli_run.py`

Model the structure on `tests/test_export_csv.py` (module-level imports,
fixture state dicts, no network). A fake manager object with `start()` and
`get()` driven by the test is injected into `cli_run.run(args, manager)`:

1. `test_run_done_exits_zero_and_prints_table` — fake `start` returns
   `"fake-id"`; fake `get` returns a `status="done"` fixture state (copy the
   stats shape from `tests/test_export_csv.py:34-58`, plus `score_total`,
   `blocking_efficacy`, `protocol`). Capture stdout via `capsys`; assert the
   table contains the resolver, provider name, and the score cell.
2. `test_run_json_output_matches_state` — `--format json`, assert
   `json.loads(out) == state`.
3. `test_run_csv_output_matches_backend_contract` — `--format csv`, assert
   the header equals `EXPORT_CSV_COLUMNS` (import from `app.export`; use
   `csv.reader` like `test_export_csv.py:71`).
4. `test_run_failed_exits_two` — `get` returns `status="failed"` with
   `error="boom"`; assert return code 2 and stderr contains `boom`.
5. `test_run_validation_error_exits_one` — `--resolvers 999.1.1.1` (invalid
   IP) → return 1, stderr contains the pydantic/ValueError message.
6. `test_run_progress_suppressed_when_not_tty` — with a short
   `state["progress"]` between polls; use `capsys` and a fake `get` that
   returns `running` once then `done`; assert no `progress=` text in stdout
   or stderr (not a TTY in pytest).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_cli_run.py -q` → 6 tests pass.

### Step 4: Full gate

**Verify**: `make backend-check` → exit 0. (Requires plan 019's state: its
test updates and `app/export.py` must already be merged in this branch or in
main before this step.)

## Test plan

- New tests in `backend/tests/test_cli_run.py` as listed in Step 3 —
  happy path, JSON/CSV contracts, failed-run exit code, validation error,
  non-TTY progress suppression. No network in any test.
- Existing suites must stay green: `make backend-check` runs the full pytest
  suite.

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_cli_run.py -q` — 6 tests pass
- [ ] `make backend-check` exits 0
- [ ] `dnspect run --help` (and `python -m app.cli run --help`) exits 0 and shows the documented flags
- [ ] `python -m app.cli` (no args, headless env) still starts the server — behavior unchanged
- [ ] `grep -rn "not-an-ip\|999\.1\.1\.1" backend/app/` returns no matches (no test-only junk in app code)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 020 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 019 is not merged and `app/export.py` does not exist — the CSV step
  cannot be verified (do not reimplement the CSV builder inline).
- The code at the locations in "Current state" doesn't match the excerpts.
- A step's verification fails twice after a reasonable fix attempt.
- You find that `BenchmarkManager.get()` during polling returns a dict whose
  `status` values differ from `{"done", "failed", "cancelled"}`.
- The task appears to require modifying `runner.py` or `main.py` to proceed.

## Maintenance notes

- `cli.py` still imports `from app.main import app` at module level
  (line 9), so even `run` pays the FastAPI construction cost through that
  import chain (`cli_run.py` itself imports only `app.runner`, `app.models`,
  `app.export` — keep it that way). A future plan may make the `app.main`
  import lazy; out of scope here.
- When the monitoring design (plan 021) lands, the CLI's
  start+poll+compare loop is the reference substrate — keep `run()`'s
  injectable-manager signature so a scheduler can reuse it.
- `--format csv` output is contract-bound to `EXPORT_CSV_COLUMNS`; if plan
  019's column list changes, the CSV contract test here changes with it.
