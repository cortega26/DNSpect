# Plan 019: Backend CSV export includes the diagnostics columns (parity with frontend export)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 087e5ff..HEAD -- backend/app/main.py backend/app/export.py backend/tests/test_export_csv.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (stated-but-undelivered export contract)
- **Planned at**: commit `087e5ff`, 2026-08-11

## Why this matters

The backend `GET /api/benchmarks/{id}/export.csv` endpoint omits the
security-diagnostics fields that are a core product differentiator: blocking
efficacy, DNSSEC validation, and NXDOMAIN hijacking detection. They are
computed per resolver (`runner.py:1843-1885`), shown in the UI, and exported
by the **frontend** CSV path (`reporting.ts:71-75` + dynamic extras) — but any
user or script consuming the backend API export loses that dimension entirely.
This is a shipped claim that is incomplete: the QUICK_WINS spec for NXDOMAIN
hijacking lists "CSV export includes the column" as an unchecked acceptance
criterion. The two export paths have drifted; this plan makes the backend
export a superset equal to the frontend's effective header and pins it with a
test so they cannot silently drift again.

## Current state

- `backend/app/main.py:194-275` — `export_csv()` endpoint. Writes a hardcoded
  29-column header (lines 204-235) then one row per result (lines 237-271),
  reading from `item["stats"]`. Missing: `blocking_efficacy`,
  `blocked_count`, `blocking_test_count`, `score_blocking`,
  `normalized_blocking`, `dnssec_validating`, `nxdomain_hijack_detected`.
- `backend/app/runner.py:1843-1885` — the values exist in every done run's
  per-resolver stats dict: `stats["blocking_efficacy"]`,
  `stats["blocked_count"]`, `stats["blocking_test_count"]` (line 1843-1846),
  `stats["nxdomain_hijack_detected"]` (line 1863), `stats["dnssec_validating"]`
  (line 1885). Types: floats for the blocking fields, `bool | None` for the
  two diagnostics.
- `backend/tests/test_export_csv.py:15-109` — the only test covering the
  endpoint; it pins the exact header at lines 73-103 (must be updated in
  lockstep) and asserts raw numeric cells (lines 104-106).
- `frontend/src/lib/reporting.ts:42-77` — `BASE_CSV_COLUMNS` is the frontend
  canonical header (already includes the blocking fields after
  `max_rel_penalty` and `is_unreliable` last); `collectExtraColumns`
  (lines 102-118) appends any stats keys not in BASE, sorted alphabetically
  via `stableSorted` — so the two diagnostics appear as
  `dnssec_validating, nxdomain_hijack_detected` appended at the end of the
  effective frontend header. **Target contract**: the backend header must be
  exactly `BASE_CSV_COLUMNS` order plus those two columns appended last.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 087e5ff..HEAD -- backend/app/main.py backend/app/export.py backend/tests/test_export_csv.py` | exit 0 (empty or only expected merged-plan context) |
| Single test | `cd backend && . .venv/bin/activate && pytest tests/test_export_csv.py -q` | all pass |
| Full gate   | `make backend-check`     | exit 0 (ruff lint → ruff format --check → mypy → bandit → pytest) |

## Scope

**In scope** (the only files you should modify):
- `backend/app/export.py` (new) — canonical CSV column tuple + row/CSV builder
- `backend/app/main.py` — `export_csv()` delegates to the shared builder
- `backend/tests/test_export_csv.py` — extend fixture stats and pin the new header

**Out of scope** (do NOT touch, even though they look related):
- `frontend/` — its export already includes these columns; the test
  hardcodes the parity list instead of importing the frontend file.
- `backend/app/runner.py` — the stats keys already exist; do not rename them.
- The JSON export (`export.json` in `main.py:179-191`) — it already carries
  the full stats dict; no change needed.
- CLI export output (plan 020) — that plan will consume `app/export.py`.
- Any change to existing column order or to existing column values.

## Git workflow

- Branch: `plan/019-backend-csv-diagnostics-parity`
- Commit per step, conventional commits matching the repo log (examples from
  `git log`: `fix(export): ...`, `test(export): ...`). The merge commit on main
  is `merge: plan 019 — backend CSV diagnostics parity`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the shared CSV module `backend/app/export.py`

Create `backend/app/export.py` containing:

- `EXPORT_CSV_COLUMNS: tuple[str, ...]` — the full canonical header, in
  exactly this order (mirrors the frontend `BASE_CSV_COLUMNS` order with the
  two diagnostics appended last):

  ```python
  EXPORT_CSV_COLUMNS: tuple[str, ...] = (
      "resolver", "provider_id", "provider_name", "engine", "protocol",
      "avg_ms", "median_ms", "p95_ms", "min_ms", "max_ms",
      "ok_count", "timeout_count", "success_rate", "timeout_rate",
      "success_count", "failure_count", "failure_rate", "consistency_ratio",
      "p95_minus_median_ms",
      "score_latency", "score_reliability", "score_stability", "score_total",
      "normalized_latency", "normalized_reliability", "normalized_stability",
      "reliability_penalty", "max_rel_penalty",
      "blocking_efficacy", "blocked_count", "blocking_test_count",
      "score_blocking", "normalized_blocking",
      "is_unreliable",
      "dnssec_validating", "nxdomain_hijack_detected",
  )
  ```

- `build_csv(state: dict) -> str` — builds the complete CSV text for a
  finished benchmark state dict (the same shape `export_csv()` receives
  today: `state["results"]`, each item having `resolver`, `provider_id`,
  `provider_name`, `engine`, optional `protocol`, and `stats` dict). Use the
  standard library `csv` + `io.StringIO` exactly like the current endpoint
  does (`main.py:202-275`). For each column: prefer `stats.get(column)`, then
  `item.get(column)`; the `stats.get(...)` pattern for the score_* fields in
  the current endpoint (lines 260-268) is the precedent — mirror it for every
  new column so `None` renders as an empty cell.

**Verify**: `cd backend && . .venv/bin/activate && python -c "from app.export import EXPORT_CSV_COLUMNS, build_csv; assert len(EXPORT_CSV_COLUMNS) == 36"` → exit 0, no output.

### Step 2: Point `export_csv()` at the shared builder

Replace the header+row construction in `main.py:202-275` (the `io.StringIO`,
`csv.writer`, header `writer.writerow(...)`, and the per-item loop) with a
single call to `build_csv(state)` (keep the `StreamingResponse`, `Content-Disposition`
header, and the two `status != "done"` guards exactly as they are).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_export_csv.py -q` → the existing test now FAILS on the header assertion (expected — the test pins the old header). Do not fix it yet.

### Step 3: Update the test to pin the new contract

In `backend/tests/test_export_csv.py`:

1. Extend the fixture `stats` dict (lines 34-58) with:
   `"blocking_efficacy": 87.5, "blocked_count": 7, "blocking_test_count": 9,
   "score_blocking": 12.3, "normalized_blocking": 0.45,
   "nxdomain_hijack_detected": False, "dnssec_validating": True`.
2. Replace the header assertion (lines 73-103) with the exact 36-column list
   from `EXPORT_CSV_COLUMNS` (hardcoded, with a comment noting it mirrors
   `frontend/src/lib/reporting.ts` BASE_CSV_COLUMNS + its alphabetical extras;
   the import path is the canonical source of truth).
3. Add value assertions for the new columns (pattern from lines 104-106):
   `rows[1][28] == "87.5"`, `rows[1][31] == "12.3"`, `rows[1][34] == "True"`,
   `rows[1][35] == "False"`.
4. Add a second test `test_export_csv_diagnostics_none_renders_empty`:
   same fixture but `nxdomain_hijack_detected=None, dnssec_validating=None`
   and `blocking_efficacy=None`, asserting the cells are empty strings.

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_export_csv.py -q` → 2 tests pass, 0 failed.

### Step 4: Full gate

**Verify**: `make backend-check` → exit 0, all sections pass.

## Test plan

- `backend/tests/test_export_csv.py` — updated: header contract pin (36
  columns), raw numeric values in the new columns, `None` → empty cells.
  Structural pattern: the existing file, unchanged in its use of
  `TestClient`, the `manager._lock`/`_states` injection, and the
  try/finally cleanup.
- No frontend tests: `frontend/` is out of scope.

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_export_csv.py -q` — 2 tests pass (one extended existing test + one new None-variant test)
- [ ] `make backend-check` exits 0
- [ ] The exported header equals the frontend effective header:
      `cd backend && . .venv/bin/activate && python -c "from app.export import EXPORT_CSV_COLUMNS as c; assert len(c) == 36 and c[-2] == 'dnssec_validating' and c[-1] == 'nxdomain_hijack_detected'"` → exit 0
- [ ] `grep -rn "writer.writerow" backend/app/main.py` returns no matches (the header/row construction moved to `app/export.py`)
- [ ] No files outside the in-scope list are modified (`git status` shows only the three in-scope paths)
- [ ] `plans/README.md` status row for 019 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (the codebase has drifted since this plan was written).
- `make backend-check` fails on a pre-existing issue unrelated to your change.
- Step 2 fails because `export_csv()` no longer looks like the excerpt
  (e.g. it was refactored after this plan was written).
- The column count or order decision conflicts with a newer frontend change
  to `BASE_CSV_COLUMNS` (check `frontend/src/lib/reporting.ts:42-77` before
  concluding).

## Maintenance notes

- The backend header is now a single source of truth (`EXPORT_CSV_COLUMNS`)
  shared with the future CLI export (plan 020). The frontend header is
  independent by necessity; when a column is added to either side, update the
  other and the header pin in `test_export_csv.py` in the same change.
- A reviewer should verify the parity test comment matches the actual
  frontend `BASE_CSV_COLUMNS` + `stableSorted` extras behavior.
- If scoring/blocking field names change in `runner.py`/`stats.py`, the
  column tuple and the test fixture must change together.
