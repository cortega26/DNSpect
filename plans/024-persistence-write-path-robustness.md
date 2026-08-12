# Plan 024: Persistence write-path robustness (atomic writes, resilient reads, no ghosts)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d5002d0..HEAD -- backend/app/runner.py backend/tests/test_persistence_robustness.py backend/tests/test_include_samples.py backend/tests/test_manager_lifecycle.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: correctness (audit findings 1, 2, 4, 5, 7 — post-`e09fd2d` churn reaudit)
- **Planned at**: commit `d5002d0`, 2026-08-11

## Why this matters

The audit of the persistence layer found five defects in one cluster: (1) run
and comparison files are written non-atomically (`write_text` truncates
in place — a crash mid-write destroys the only copy of a finished run, and
concurrent readers can observe partial files); (2) a single corrupt/truncated/
invalid-UTF-8/non-dict file in the runs dir makes `/api/benchmarks/history`,
`get`, and `compare` return HTTP 500 for **every** user instead of skipping
one run; (4) a failed executor submit leaves a permanent ghost "queued" run
on disk that can never complete; (5) `include_samples=1` on a persisted run
silently returns empty samples (the samples file is written but never read);
(7) full-result JSON serialization + disk write happens while holding the
global manager lock, stalling every request at run completion. All five are
in `runner.py`; this plan fixes the cluster and characterizes the failure
modes with tests that were entirely absent.

## Current state

- `backend/app/runner.py:1702-1703`:
  ```python
  def _write_json_file(self, path: Path, payload: str) -> None:
      path.write_text(payload, encoding="utf-8")
  ```
- `runner.py:1713-1724` — `_persist_run` writes `<id>.json` (metadata,
  `include_samples=False`) and, when `self.persist_samples` and status is
  `done`, `<id>.samples.json` (full samples). Both through `_write_json_file`.
- `runner.py:1662-1672` — `_set_done` calls `self._persist_run(benchmark_id)`
  **inside** `with self._lock:`. `_set_failed` (1672-1679) does the same.
  Contrast: `_persist_protocol_comparison` is called outside the lock
  (`_finish_protocol_comparison` at 1324, `_fail_protocol_comparison` at 1337).
- `runner.py:802-808` — `start()` calls `self._persist_run(benchmark_id)`
  (line 802, while the state is still `queued`) **before**
  `self._executor.submit(...)` (line 804); the `except RuntimeError` rollback
  (805-808) pops the in-memory state but leaves `<id>.json` on disk. The disk
  fallback in `get()` (900-908) then serves it forever as a stuck `queued`
  run; `list_history` (915-953) surfaces it; `compare_runs` (1509-1510) 409s.
- `runner.py:893-908` — `get()`'s disk fallback:
  ```python
  try:
      data: dict[str, Any] = json.loads(result_path.read_text(encoding="utf-8"))
      return data
  except (json.JSONDecodeError, OSError):
      return None
  ```
  `read_text` raises `UnicodeDecodeError` (a `ValueError`) on invalid UTF-8 —
  not caught → 500. A valid-JSON non-dict root (e.g. `[1,2,3]`) crashes
  `data.get(...)` with `AttributeError` — not caught → 500. The same two gaps
  exist in `list_history` (lines 923-924) and
  `get_protocol_comparison` (lines 1178-1185).
- `runner.py:919-953` — `list_history` loads every file; one bad file must
  skip that entry, not abort the whole listing (today it aborts).
- `get()` never reads `<id>.samples.json` — the samples file is write-only.
- Test gap: `backend/tests/` has no corrupt/truncated/UTF-8/non-dict
  persisted-file tests (grep for `corrupt|truncat|UnicodeDecode|JSONDecode`
  finds only unrelated geoip/stats tests).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat d5002d0..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| New tests | `cd backend && . .venv/bin/activate && pytest tests/test_persistence_robustness.py -q` | all pass |
| Full gate | `make backend-check`     | exit 0 |

## Scope

**In scope**:
- `backend/app/runner.py` — the five fixes
- `backend/tests/test_persistence_robustness.py` (new)
- `backend/tests/test_include_samples.py` — extend with a disk-loaded samples round-trip test

**Out of scope** (do NOT touch, even though they look related):
- `list_history`'s O(total-bytes) parsing (PERF finding 6) — index/summary
  work is a separate plan; the robustness fix here only makes per-file
  failures non-fatal.
- Protocol-comparison persist semantics beyond making its write atomic and
  its reads resilient.
- `frontend/` — 404-on-corrupt already degrades to the existing "run not
  found" UI; no UI change.
- The manifest snapshot fix (plan 025) and the frontend fixes (plan 026).
- `os.replace` behavior on Windows — it is atomic on NTFS; no conditional
  needed.

## Git workflow

- Branch: `plan/024-persistence-write-path-robustness`
- Commit per logical fix, conventional commits (`fix(persistence): ...`,
  `test(persistence): ...`). Merge commit on main:
  `merge: plan 024 — persistence write-path robustness`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Atomic writes

Replace `_write_json_file` (1702-1703) with a temp-file + atomic-replace
implementation:

```python
def _write_json_file(self, path: Path, payload: str) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        f.write(payload)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)
```

(`os` is already imported in runner.py line 5.) All five existing call sites
(`_persist_run` x2, `_persist_protocol_comparison`, and any other
`_write_json_file` uses — `grep -n "_write_json_file" backend/app/runner.py`)
get atomicity for free.

**Verify**: `cd backend && . .venv/bin/activate && python -c "from app.runner import BenchmarkManager; import inspect; src = inspect.getsource(BenchmarkManager._write_json_file); assert '.tmp' in src and 'os.replace' in src; print('atomic-ok')"` → `atomic-ok`.

### Step 2: Resilient reads

In **all three** readers, widen the guard and require a dict root:

1. `get()` (905-908):
   ```python
   try:
       data = json.loads(result_path.read_text(encoding="utf-8"))
   except (OSError, ValueError):
       return None
   if not isinstance(data, dict):
       return None
   return data
   ```
2. `list_history()` (922-942) — same widened `except (OSError, ValueError)`
   and skip the entry (continue) when the root is not a dict:
   ```python
   try:
       data = json.loads(path.read_text(encoding="utf-8"))
   except (OSError, ValueError):
       continue
   if not isinstance(data, dict):
       continue
   ```
   (the existing `data.get(...)` calls then operate on a dict).
3. `get_protocol_comparison()` (1178-1185) — same widened except; when the
   root is not a dict, return None.

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_run_lookup_boundary.py -q` → all pass (no regression on the containment tests).

### Step 3: No ghost runs on submit failure

In `start()` (802-808): keep the persist-before-submit (the queued snapshot
is intentional), but make the rollback symmetric — delete the file:

```python
try:
    self._executor.submit(self._run, benchmark_id, config)
except RuntimeError as exc:
    with self._lock:
        self._states.pop(benchmark_id, None)
    persisted = self._persisted_run_path(benchmark_id)
    if persisted is not None:
        with suppress(OSError):
            persisted.unlink()
    raise ValueError("No se pudo iniciar benchmark en este momento.") from exc
```

(`suppress` is already imported at runner.py:18.)

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_manager_lifecycle.py -q` → all pass.

### Step 4: Samples read-back

In `get()`'s disk fallback (after the metadata load at 905-908), when the
caller asked for samples and the samples file exists, load it instead:

```python
if include_samples:
    samples_path = self._data_runs_dir / f"{benchmark_id}.samples.json"
    try:
        samples_data = json.loads(samples_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        samples_data = None
    if isinstance(samples_data, dict):
        return samples_data
```

(place before `return data`; the metadata file remains the fallback when the
samples file is absent or corrupt).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_include_samples.py -q` → all pass.

### Step 5: Serialize + write outside the manager lock

Restructure `_set_done` (1662-1672) and `_set_failed` (1672-1679) so the
state mutation happens under the lock but `_persist_run` runs after it is
released. Pattern:

```python
def _set_done(self, benchmark_id: str, engine: str, results: list[dict[str, Any]]) -> None:
    state = self.get_state(benchmark_id)
    apply_normalized_scoring(results, goal=state.scoring_profile if state else None)
    ranked_results = sorted(results, key=_resolver_rank_key)
    with self._lock:
        state = self._states[benchmark_id]
        state.status = "done"
        state.finished_at = datetime.now(UTC).isoformat()
        state.results = ranked_results
        state.engine = engine
        state.current_resolver = None
        state_snapshot = state.as_response(include_samples=False)
    self._persist_run_payload(benchmark_id, state_snapshot)
```

Introduce `_persist_run_payload(benchmark_id, snapshot)` that performs the
JSON dumps + the two `_write_json_file` calls (metadata now, samples when
persist_samples and done — the samples snapshot needs
`state.as_response(include_samples=True)`, so build BOTH snapshots under the
lock: `state_snapshot` and, when `self.persist_samples`, the samples
snapshot; pass both out). `_set_failed` uses the same pattern with its
message/error fields. Keep `_persist_run` behavior identical for the queued
path in `start()` (its caller, line 802, already runs outside the lock).

Note: `as_response(include_samples=False)` already sanitizes results
(`_sanitize_results`) — call it under the lock as the snapshot step.

**Verify**: `cd backend && . .venv/bin/activate && python -c "from app.runner import BenchmarkManager; import inspect; src = inspect.getsource(BenchmarkManager._set_done); assert '_persist_run_payload' in src or '_persist_run' not in src.split('with self._lock:')[-1].split('def ')[0]; print('lock-ok')"` → `lock-ok` (the write call must not appear inside the locked block).

### Step 6: Characterization tests — `backend/tests/test_persistence_robustness.py`

Follow the fixture/state-injection pattern of `test_export_csv.py` (TestClient,
`manager._lock`/`_states`, try/finally cleanup). Use a **dedicated temp runs
dir** (`BenchmarkManager(data_runs_dir=tmp_path)` — the constructor accepts
`data_runs_dir`, runner.py:649) and construct the manager as the module
fixture, overriding the app's global `manager` via monkeypatch of
`app.main.manager` where routes are exercised:

1. `test_invalid_utf8_run_file_is_skipped_not_500` — write a run file with
   `b"\xff\xfe\xfa"` bytes in the temp runs dir; `GET /api/benchmarks/history`
   → 200 (run skipped); `GET /api/benchmarks/{id}` → 404.
2. `test_truncated_json_run_file_skipped` — write `b'{"results": ['` → same
   expectations.
3. `test_non_dict_root_skipped` — write `[1,2,3]` (and `"x"`) → same.
4. `test_history_survives_mixed_good_and_bad_files` — one valid run + two
   corrupt variants; history returns 200 with exactly the valid entry.
5. `test_ghost_queued_run_removed_on_submit_failure` — monkeypatch the
   manager's `_executor.submit` to raise `RuntimeError`; `start()` raises
   `ValueError`; assert no `<id>.json` exists in the runs dir and `get(id)`
   is None. (Use `_persisted_run_path`-style direct file assertion.)
6. `test_atomic_write_leaves_no_tmp_and_readable` — run a real (tiny) state
   through `_write_json_file`; assert the target exists, no `*.tmp` remains,
   and content parses.
7. `test_persisted_samples_round_trip` — with `persist_samples=True`, persist
   a done state containing samples, then `get(id, include_samples=True)` →
   samples present; `include_samples=False` → empty. (Direct manager call,
   no HTTP.)
8. `test_disk_fallback_404_for_missing` — unchanged behavior guard.

Extend `backend/tests/test_include_samples.py` with one disk-loaded test if
the suite's fixtures make it natural; otherwise the round-trip test above
covers it.

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_persistence_robustness.py -q` → 8 tests pass.

### Step 7: Full gate

**Verify**: `make backend-check` → exit 0.

## Test plan

- `backend/tests/test_persistence_robustness.py` — the 8 cases in Step 6
  (malformed-file matrix, mixed-files survival, ghost removal, atomicity,
  samples round-trip, 404 guard).
- `backend/tests/test_include_samples.py` — disk-loaded round-trip addition.
- Structural pattern: `test_export_csv.py` (state injection + cleanup),
  `test_run_lookup_boundary.py` (temp-dir manager construction).
- `make backend-check` must pass end to end.

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_persistence_robustness.py -q` — 8 tests pass
- [ ] `make backend-check` exits 0
- [ ] `grep -n "write_text" backend/app/runner.py` returns no matches for `_write_json_file`'s implementation (replaced by tmp + `os.replace`)
- [ ] `grep -rn "except (json.JSONDecodeError, OSError)" backend/app/` returns no matches (widened to `(OSError, ValueError)`)
- [ ] `grep -n "unlink" backend/app/runner.py` matches inside `start()`'s rollback
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 024 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the "Current state" locations doesn't match the excerpts.
- `os.replace` / `os.fsync` behave unexpectedly on the CI platform (Windows
  runner) — report rather than adding platform conditionals.
- The lock-restructure in Step 5 breaks a test that asserts exact `finished_at`
  or persistence ordering — adapt within the pattern; if it requires changing
  behavior beyond the pattern, STOP.
- A step's verification fails twice after a reasonable fix attempt.
- The task appears to require touching `list_history`'s read-volume behavior
  (the separate perf plan) or frontend code to proceed.

## Maintenance notes

- `os.replace` gives readers a consistent file at every instant; the small
  `*.tmp` residue after a crash is inert (not globbed — `list_history` uses
  `[!.]*.json` and the tmp suffix ends `.json.tmp`, which is NOT matched —
  verify this stays true).
- The `_persist_run_payload` seam is where a future "summary sidecar for
  `list_history`" plan plugs in; keep it signature-stable.
- Plan 025 (manifest snapshot) and plan 026 (frontend) are independent of
  this file's changes; merge order between 024 and 023 (DoQ) matters only in
  that both touch `runner.py` — rebase whichever lands second.
