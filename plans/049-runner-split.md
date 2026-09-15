# Plan 049: Split the runner god module (characterize, then extract)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 57a8e34..HEAD -- backend/app/runner.py backend/tests/ backend/app/stats.py backend/app/providers.py backend/app/main.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (biggest structural debt in the repo; unblocked since v1.4.0 shipped)
- **Effort**: L
- **Risk**: HIGH — contained by the rules below: characterization tests first, pure-move extractions, compat re-exports, zero behavior change. Read the STOP conditions twice before starting.
- **Depends on**: none (use the current test matrix as characterization baseline per the reaudit note)
- **Category**: tech-debt (architecture)
- **Planned at**: commit `57a8e34`, 2026-09-15

## Why this matters

`backend/app/runner.py` is 2,291 lines: measurement engines, two state
machines, persistence helpers, and the benchmark orchestrator in one
module. Every recent wave (023/024/025, the naive-timestamp fix) collided
in its line regions. The deep-reaudit deferred this split to post-v1.4.0
"with the current test matrix as characterization" — v1.4.0 shipped, the
matrix is green, and the module only grows. This plan extracts three
cohesive modules with zero behavior change; the orchestrator stays put.

## Current state

- `backend/app/runner.py` — 2,291 lines. Contents (verified 2026-09-15):
  - Pure helpers (~109-438): `_resolve_runs_dir`, `_to_positive_int`,
    `dns_quic_available`, `_resolver_rank_key`, `_canonical_json_sha256`,
    `_build_run_manifest`, `_opt_float`, `_extract_manifest`,
    `_manifest_mismatch_reason_codes`, `_comparison_metrics`,
    `_comparison_deltas`, `_ranked_resolvers`,
    `_protocol_diagnostic_domain`, `_resolver_protocol_endpoint`,
    `_protocol_metrics_dict`, `_protocol_deltas_dict`,
    `_subrun_results_by_resolver`, `_protocol_delta_pairs`
  - State/config classes (~143-607): `BenchmarkWorkEstimate`,
    `ProtocolComparisonState`, `ProtocolComparisonPlan`,
    `BenchmarkState`, `BenchmarkConfig`
  - Classification (~586-681): `_sanitize_results`,
    `_rcode_to_failure_kind`, `classify_failure_from_text`,
    `classify_dnspython_exception`, `is_generated_run_id`,
    `_build_history_summary`
  - `BenchmarkManager` (~682-end): orchestration + persistence + history.
- Consumers import from `runner` directly (`stats.py`, `providers.py`,
  `main.py` import $what-they-import — verify exact import lines in
  Step 1 and preserve every one via re-export).
- Backend gates (CI order): `ruff check` + `ruff format --check` + `mypy`
  + `bandit` + `pytest` (`make backend-check`).

## Commands you will need

| Purpose | Command | Provenance | Expected on success |
|---|---|---|---|
| Drift check | `git diff --stat 57a8e34..HEAD -- <in-scope paths>` | declared | exit 0 (empty) |
| Backend gates | `make backend-check` (repo root) | declared | exit 0, full suite green |
| Single test | `cd backend && . .venv/bin/activate && pytest tests/test_X.py -q` | declared | pass |
| Import proof | `cd backend && . .venv/bin/activate && python -c "import app.runner as r; print([n for n in dir(r) if not n.startswith('_')])"` | declared | every pre-extraction public name still present |
| Scope | `git diff --name-only <base>...HEAD` (three dots) | declared | only in-scope files |

## Scope

**In scope** (the only files you should modify or create):
- `backend/app/runner.py` — shrinks to orchestration + compat re-exports
- `backend/app/measurement.py` (new) — failure/dns classification + rank-key pure functions
- `backend/app/run_state.py` (new) — `BenchmarkWorkEstimate`, `ProtocolComparisonState`, `ProtocolComparisonPlan`, `BenchmarkState`, `BenchmarkConfig`
- `backend/app/persistence.py` (new) — runs-dir resolution, canonical-hash, manifest build/extract, history-summary builder, comparison-metric pure helpers
- `backend/tests/test_runner_characterization.py` (new) — characterization tests (Step 1)

**Out of scope** (do NOT touch):
- `backend/app/stats.py`, `providers.py`, `main.py` — they keep importing from `runner`; the re-exports keep them working untouched
- Any behavior change whatsoever — this is a pure move. No bug fixes "while in there" (the naive-timestamp lesson: fixes get their own commits)
- Public API shapes, endpoint behavior, scoring math

## Git workflow

- Branch: `plan/049-runner-split` (long-lived — rebase onto mainline weekly if other work lands; on conflict, keep THEIR logic, re-apply YOUR moves)
- Commits, in order: `test(backend): characterize runner public behavior` →
  `refactor(backend): extract measurement module` →
  `refactor(backend): extract run-state module` →
  `refactor(backend): extract persistence module`. Merge commit:
  `merge: plan 049 — runner split`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Green baseline + import census

1. `make backend-check` on the unmodified checkout → exit 0 (record test count).
2. Census: `grep -rn "from app.runner import\|from .runner import\|import app.runner" backend/app backend/tests | sort` — record EVERY importing line; each one is a compat constraint.
3. Public-name snapshot: run the Import-proof command, save the name list to `/tmp/runner_api_before.txt` (not committed).

**Verify**: baseline green with recorded count; census + snapshot saved.

### Step 1: Characterization tests

Create `backend/tests/test_runner_characterization.py` pinning externally
visible behavior through `BenchmarkManager` and the pure helpers (model on
`backend/tests/test_history_summary.py` — manager fixture, `_write_run`
helpers, naive/aware cases):

1. History ordering incl. mixed naive/aware timestamps (the ecb3d6a
   regression — pin it again here at the public level).
2. Manifest round-trip: `_build_run_manifest` → `_extract_manifest` preserves fields; mismatch codes for tampered payloads.
3. Failure classification table: representative rcodes/exceptions → kinds.
4. Comparison deltas: baseline-vs-candidate fixtures → expected delta signs.
5. Work-budget estimate determinism (same inputs → identical estimate).

**Verify**: `pytest tests/test_runner_characterization.py -q` → all pass WITHOUT any source change (they pin current behavior, bugs included — a test that fails now is a wrong test, not a found bug; fix the test).

### Step 2: Extract `measurement.py`

Move (no edits besides imports): `_rcode_to_failure_kind`,
`classify_failure_from_text`, `classify_dnspython_exception`,
`_resolver_rank_key`, `_sanitize_results`, `is_generated_run_id`.
`runner.py` re-exports every moved name (`from app.measurement import X`
at the same location region + names kept in `__all__` if one exists —
check). If any moved function references runner-only state, STOP (the
boundary assumption failed).

**Verify**: `make backend-check` green; import-proof name list identical to `/tmp/runner_api_before.txt` (`diff` empty).

### Step 3: Extract `run_state.py`

Move the five classes verbatim. Same re-export + gate procedure as Step 2.

**Verify**: gates green; import-proof diff empty.

### Step 4: Extract `persistence.py`

Move: `_resolve_runs_dir`, `_canonical_json_sha256`,
`_build_run_manifest`, `_extract_manifest`,
`_manifest_mismatch_reason_codes`, `_comparison_metrics`,
`_comparison_deltas`, `_ranked_resolvers`,
`_protocol_diagnostic_domain`, `_resolver_protocol_endpoint`,
`_protocol_metrics_dict`, `_protocol_deltas_dict`,
`_subrun_results_by_resolver`, `_protocol_delta_pairs`,
`_build_history_summary`, `_opt_float`. Same re-export + gate procedure.

**Verify**: gates green; import-proof diff empty; `wc -l backend/app/runner.py` recorded (expect ~40-50% reduction — record actual, don't chase a number).

### Step 5: Final review pass

`git diff --stat <base>...HEAD`; read the full `runner.py` diff to confirm
it contains ONLY deletions + re-export lines (no logic edits). Run the
complete `make backend-check` + `make backend-semgrep` if the latter's
throwaway-venv install is acceptable in this environment (else record skip
with reason).

**Verify**: diff is moves-only; gates green; scope clean.

## Test plan

- New: `test_runner_characterization.py` (Step 1) — the behavior pin for
  all four extraction steps; must pass identically before and after.
- Existing: FULL backend suite after every step (extraction regressions
  surface anywhere — `pytest -q` count must never drop).
- Import-proof diff after every step (public surface frozen).

## Done criteria

ALL must hold:

- [ ] `backend/app/measurement.py`, `run_state.py`, `persistence.py` exist with the prescribed contents
- [ ] `make backend-check` exits 0 (ruff, format, mypy, bandit, pytest)
- [ ] Import-proof name list identical to pre-extraction snapshot
- [ ] `test_runner_characterization.py` passes unchanged from Step 1 (no test edits after extractions — if a test needed editing, the extraction changed behavior: STOP, don't "fix" the test)
- [ ] `git diff --name-only <base>...HEAD` lists only in-scope files
- [ ] `plans/README.md` status row for 049 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- A moved function references runner-only state (boundary failure — report which symbol and what it needs).
- Any characterization test fails post-move without test edits (behavior changed — revert the step, report).
- A consumer import from the census breaks (re-export missed — fix the re-export, never the consumer).
- `make backend-check` fails on the unmodified checkout (broken baseline — report, don't repair).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- New runner-adjacent code goes in the extracted module that owns its
  concern; `runner.py` is orchestration-only from here on — enforce in review.
- The re-exports are permanent API compatibility, not temporary: external
  importers (`stats.py`, `providers.py`, `main.py`) were deliberately left
  untouched. A follow-up may migrate them to direct imports (mechanical).
- Watch for the next collision wave: history/persistence edits now land in
  `persistence.py`, state-machine edits in `run_state.py`.
- **Deferred:** migrating `stats.py`/`providers.py`/`main.py` to direct
  module imports — unblocked by nothing, mechanical, just not this plan.
