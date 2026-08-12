# Plan 030: History listing reads summary sidecars instead of full run files

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1ea666f..HEAD -- backend/app/runner.py backend/app/export.py backend/tests/test_persistence_robustness.py backend/tests/test_history_integrity.py backend/tests/test_watch.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (builds on the plan-024 atomic-write seam
  `_persist_run_payload` and the plan-028 `origin` field; both are on main)
- **Category**: perf (audit finding 6 — post-`e09fd2d` churn reaudit, deferred from plan 024 by design)
- **Planned at**: commit `1ea666f`, 2026-08-11

## Why this matters

Every `/api/benchmarks/history` request globs **every** persisted run file
and `json.loads` the **full result payload** of each — including all
per-resolver stats and (optionally) samples — then discards all but a
9-field summary. With months of runs (or one large/foreign file) this is tens
of MB parsed per request on the request thread; latency grows linearly with
lifetime run count. The history endpoint is polled by the frontend
(`useRunHistory`), so the cost compounds. The fix: persist a tiny
`<id>.summary.json` sidecar at write time (the plan-024 seam already writes
the metadata + samples files there) and have `list_history` parse only the
summaries, falling back to the full file for legacy runs that predate the
sidecar.

## Current state

- `backend/app/runner.py:971-993` — `list_history`:
  ```python
  for path in sorted(self._data_runs_dir.glob("[!.]*.json")):
      if path.name.endswith(".samples.json"):
          continue
      try:
          data = json.loads(path.read_text(encoding="utf-8"))
      except (OSError, ValueError):
          continue
      if not isinstance(data, dict):
          continue
      results = data.get("results") or []
      entry = { "id": path.stem, "mode": ..., "goal": ..., "scoring_profile": ...,
                "protocol": ..., "started_at": ..., "finished_at": ..., "status": ...,
                "target_snapshot": ..., "results_summary": [...], "origin": data.get("origin") }
      runs.append(entry)
  ...
  runs.sort(...); return {"runs": runs[:50]}
  ```
  `path.stem` for `<id>.json` is the id; the `.samples.json` skip guard
  exists; `origin` was added by plan 028. Every file's full JSON is parsed.
- `runner.py:~1790-1830` — `_persist_run_payload(benchmark_id, snapshot, samples_snapshot)`:
  the plan-024 seam that writes the metadata file (and samples file when
  enabled) through the atomic `_write_json_file` (tmp + `os.replace`).
  `start()` also persists the queued state (via `_persist_run`).
- Entry fields the frontend consumes (`frontend/src/lib/api.ts:98`
  `RunHistoryEntry`): `id, mode, goal, scoring_profile, protocol, started_at,
  finished_at, status, target_snapshot, results_summary, origin`.
- `backend/tests/test_persistence_robustness.py` — the 024 characterization
  suite (8 tests, incl. malformed-file matrix and atomicity). It must stay
  green — the summary path is a NEW write, not a replacement of the metadata
  file (which `get()`'s disk fallback still needs in full).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 1ea666f..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| New tests | `cd backend && . .venv/bin/activate && pytest tests/test_history_summary.py -q` | all pass |
| Full gate | `make backend-check`     | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `backend/app/runner.py` — summary sidecar write in `_persist_run_payload`
  (+ queued path), summary-first `list_history` with legacy fallback
- `backend/tests/test_history_summary.py` (new)
- `backend/tests/test_persistence_robustness.py` — extend only if a case
  needs a summary variant (prefer the new file)

**Out of scope** (do NOT touch, even though they look related):
- `frontend/` — the response shape of `/api/benchmarks/history` is
  unchanged; `RunHistoryEntry` already matches the summary fields.
- The metadata file format (`<id>.json`) — `get()`, `compare_runs`, and
  exports still read it in full; the summary is strictly additive.
- The `.samples.json` handling.
- Plan 029 (DoQ comparison) and the watch subsystem — merge-order note only.
- Any change to the history response contract (fields, cap of 50, sort).

## Git workflow

- Branch: `plan/030-history-summary-sidecar`
- Commits: `perf(history): persist and read run summary sidecars`, then
  `test(history): cover summary fast path and legacy fallback`. Merge commit:
  `merge: plan 030 — history summary sidecars`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Persist the summary sidecar

In `runner.py`, add a module-level helper near `_write_json_file`:

```python
def _build_history_summary(snapshot: dict) -> dict:
    results = snapshot.get("results") or []
    return {
        "id": snapshot.get("id"),
        "mode": snapshot.get("mode"),
        "goal": snapshot.get("goal") or snapshot.get("scoring_profile"),
        "scoring_profile": snapshot.get("scoring_profile") or snapshot.get("goal"),
        "protocol": snapshot.get("protocol"),
        "started_at": snapshot.get("started_at"),
        "finished_at": snapshot.get("finished_at"),
        "status": snapshot.get("status"),
        "target_snapshot": snapshot.get("target_snapshot"),
        "results_summary": [
            {"provider_name": r.get("provider_name"), "resolver": r.get("resolver")}
            for r in results[:3]
        ],
        "origin": snapshot.get("origin"),
    }
```

In `_persist_run_payload`, after writing the metadata file, write
`<id>.summary.json` via the same atomic `_write_json_file` with
`json.dumps(_build_history_summary(snapshot), ...)` (same `ensure_ascii=False`).
Do the same in the queued-path persist (`_persist_run` in `start()`): the
queued state snapshot has no results — the summary still carries
id/mode/status/etc., which is what history shows for queued runs today.

**Verify**: `cd backend && . .venv/bin/activate && python -c "
from app.runner import BenchmarkManager, _build_history_summary
s = _build_history_summary({'id': 'x', 'status': 'done', 'goal': 'speed', 'scoring_profile': 'speed', 'protocol': 'udp', 'started_at': 't', 'results': [{'provider_name': 'Cloudflare', 'resolver': '1.1.1.1'}]})
assert s['results_summary'][0]['provider_name'] == 'Cloudflare' and s['goal'] == 'speed'
print('summary-ok')"` → `summary-ok`.

### Step 2: Summary-first `list_history` with legacy fallback

Rewrite `list_history` (971-993) so that:
1. It globs the metadata files as today (`[!.]*.json`, skipping the
   `.samples.json` AND `.summary.json` suffixes — add the second guard).
2. For each `<id>.json`: check for the sibling `<id>.summary.json`. If it
   exists and parses as a dict (widened `(OSError, ValueError)` + dict-root
   guards — plan 024 pattern), use it **as the entry** (it already contains
   `id`; normalize `path.stem` onto it if missing).
3. If the summary is absent **or corrupt**, fall back to the current
   full-file parse (legacy runs) — build the entry exactly as today, from
   the metadata file.
4. Keep the sort and the `[:50]` cap exactly as they are.

The glob stays over metadata files (cheap directory listing); the JSON parse
is now ~1 KB per run instead of the full payload.

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_history_integrity.py tests/test_persistence_robustness.py tests/test_watch.py -q` → all pass (no behavioral change when summaries exist and no regression when they don't).

### Step 3: Tests — `backend/tests/test_history_summary.py`

Model on `test_persistence_robustness.py` (temp-dir manager, route calls
through the monkeypatched global or direct `list_history`):

1. `test_summary_sidecar_written_on_persist` — persist a done state via the
   manager (temp runs dir); `<id>.summary.json` exists, parses, and its
   fields match the metadata file's (id, status, protocol, started_at,
   results_summary, origin).
2. `test_history_uses_summary_when_metadata_corrupt` — write a VALID summary
   sidecar and a CORRUPT metadata file (`b"\xff\xfe"`); `list_history`
   returns the run (proves the fast path reads only the summary).
3. `test_history_legacy_fallback` — metadata file present, NO summary
   sidecar → the entry appears (full-file fallback).
4. `test_history_legacy_corrupt_still_skipped` — corrupt metadata + corrupt
   summary → skipped (both paths guarded).
5. `test_summary_sidecar_corrupt_falls_back_to_metadata` — valid metadata +
   corrupt summary → entry appears from the full parse.
6. `test_history_sorted_and_capped_with_summaries` — 3 runs with sidecars;
   newest first, cap respected (extend to >50 if cheap).
7. `test_queued_run_summary_persisted` — the queued-path persist writes a
   sidecar too (status `queued` present in history after `start()` without
   completing).
8. `test_summary_does_not_affect_get_fallback` — `get(id)` still reads the
   full metadata file (the summary is never returned by `get`).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_history_summary.py -q` → 8 tests pass.

### Step 4: Full gate

**Verify**: `make backend-check` → exit 0.

## Test plan

- `backend/tests/test_history_summary.py` — the 8 cases in Step 3: sidecar
  write correctness, fast-path-vs-corrupt-metadata (the key proof), legacy
  fallback, corrupt-summary fallback, sorting/cap, queued path, `get()`
  isolation.
- Existing suites must stay green: `make backend-check` runs everything,
  including the 024 robustness matrix and the 028 watch suite (watch
  baseline finding calls `list_history` — behavior unchanged).
- Structural pattern: `test_persistence_robustness.py`.

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_history_summary.py -q` — 8 tests pass
- [ ] `make backend-check` exits 0
- [ ] `grep -n "summary.json" backend/app/runner.py` matches ≥ 3 (write x2 paths + read guard)
- [ ] `grep -n "endswith(\".summary.json\")" backend/app/runner.py` matches (metadata glob guard)
- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_history_integrity.py tests/test_watch.py -q` — all pass
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 030 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any code at the "Current state" locations doesn't match the excerpts.
- The history response shape must change to make this work (it must not —
  the summary carries exactly the current entry fields; if a field is
  missing, add it to the summary builder, not to the contract).
- An existing test (history-integrity, watch, persistence-robustness) fails
  in a way that indicates a behavioral change beyond read-path optimization —
  report instead of adjusting the test.
- A step's verification fails twice after a reasonable fix attempt.
- The task appears to require touching frontend code, `app/export.py`, or
  the metadata-file format to proceed.

## Maintenance notes

- The summary sidecar is a derived, disposable artifact: if a future plan
  changes the entry fields, regenerate sidecars by deleting them (the legacy
  fallback rebuilds entries from metadata until the next persist). No
  migration is ever required.
- `get()` must never read summaries — the metadata file is the source of
  truth for full data; the summary is only for the history list.
- Plan 029 (DoQ comparison) and 028's watch tests both touch `runner.py`
  near `list_history` — trivial rebase regions; merge order doesn't matter.
- The e2e history fixtures mock `/api/benchmarks/history` directly — no
  impact from this plan; the perf win is server-side only.
