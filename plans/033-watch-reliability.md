# Plan 033: Watch scheduler reliability (races, isolation, lifecycle, startup burst)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 930dfb6..HEAD -- backend/app/watch.py backend/app/cli.py backend/tests/test_watch.py backend/tests/test_watch_thread.py backend/tests/test_cli.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (recommended after 031; independent otherwise)
- **Category**: correctness (deep-reaudit findings 8, 9, 10, 11, 12 + SEC-03 — watch races, silent failures, thread lifecycle, startup burst, per-tick IO)
- **Planned at**: commit `930dfb6`, 2026-08-13

## Why this matters

The watch scheduler is the repo's only background thread, starts runs, and
runs in every server process — but it has four reliability holes found by
the deep reaudit: (1) **delete-vs-tick race**: a DELETE during a tick's
load→start→persist window resurrects the watch file (an unrequested run
starts; the user believes the watch is gone); (2) **one malformed watch
config aborts `tick_all` for every watch**, silently, every interval;
(3) **unhandled `OSError`s** in the store turn crafted entries into 500s;
(4) the **first tick after launch fires every watch at once** (thundering
herd), capacity-skipped watches then silently lose a full interval, and
`tick_all` re-reads every watch file before checking due times. The thread
itself (`start`/`stop`/`_run_loop`) and `cli.py`'s env-gated startup have
zero tests.

## Current state

- `backend/app/watch.py`:
  - `tick_all` (~255-268): `store.list()` + `store.load()` for ALL watches,
    then checks the in-memory `_last_tick_at`; `_last_tick_at[watch_id] =
    now` is set **before** `tick()` runs; first tick treats `None` as due.
  - `tick` (~290-310): `request = self._build_request(...)` sits OUTSIDE the
    `try/except ValueError` that wraps `manager.start` — a
    `KeyError`/`ValidationError`/`ValueError` from `_build_request`
    propagates out of `tick` into `tick_all` and aborts it; `_run_loop`
    swallows the whole thing with `suppress(Exception)`.
  - `delete` (~200-215): unlinks the file and pops `_last_tick_at`; no lock,
    no existence re-check against a mid-flight tick's `_persist`.
  - `_persist` (~413-417): `store.save` does `mkdir + tmp + os.replace` —
    silently recreating a deleted file.
  - `WatchStore.delete` (~127-139): catches only `FileNotFoundError`;
    `IsADirectoryError`/`PermissionError` (both `OSError`) → 500 on the
    route. `_write_json_file` (~93-99) can raise `OSError` from
    `tmp_path.open("w")` (crafted `{uuid}.json.tmp` directory) → 500 on
    `POST /api/watch`.
  - `start`/`stop`/`_run_loop` (~236-253): `stop()` sets `self._thread =
    None` even when `join(timeout=10)` times out — a later `start()` clears
    the SHARED `_stop_event` while the zombie thread still loops → two
    concurrent tick threads → duplicate `manager.start()` calls.
- `backend/app/cli.py:43-47` — `_start_watch_scheduler_if_enabled()`
  (env-gated, default on) — no test anywhere.
- `backend/tests/test_watch.py` — all scheduler tests drive
  `tick_all()`/`tick()` directly with a `FakeClock` + facade; **no test
  touches `start()`/`stop()`/`_run_loop()`** and no test file imports
  `app.cli`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 930dfb6..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| New tests | `cd backend && . .venv/bin/activate && pytest tests/test_watch.py tests/test_watch_thread.py tests/test_cli.py -q` | all pass |
| Full gate | `make backend-check`     | exit 0 |

## Scope

**In scope**:
- `backend/app/watch.py` — race lock, per-watch isolation, store error
  handling, last-tick persistence + startup stagger, due-before-read
- `backend/app/cli.py` — only if the thread start needs a small seam for
  testability (prefer testing via the manager hook; see Step 4)
- `backend/tests/test_watch.py` — extended
- `backend/tests/test_watch_thread.py` (new)
- `backend/tests/test_cli.py` (new)

**Out of scope** (do NOT touch, even though they look related):
- The measured-set fix (plan 031) and the UI surface (plan 032).
- `list_history`'s read pattern and the baseline-search cost (PERF-02 —
  documented design; revisit after release if watch counts grow).
- The alert-ring eviction policy (unchanged).
- Frontend code.

## Git workflow

- Branch: `plan/033-watch-reliability`
- Commits per logical fix: `fix(watch): serialize delete against in-flight ticks`, `fix(watch): isolate per-watch tick failures`, `fix(watch): handle store OSErrors as absent entries`, `fix(watch): persist last-tick and stagger startup`, `perf(watch): skip due-check reads`, `test(watch): cover thread lifecycle and cli gate`. Merge commit: `merge: plan 033 — watch scheduler reliability`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Serialize delete against in-flight ticks

Add `self._lock = threading.Lock()` to `WatchScheduler.__init__`. Hold it in
`delete()` for the unlink + `_last_tick_at` pop, and in `tick()` around the
load→start→persist critical section (or add an existence re-check
immediately before `_persist` as a belt-and-braces: `if not
self._store.load(watch_id): return`). The re-check alone is sufficient if
the lock proves awkward — pick one and document it. Keep the lock scope
tight (never hold it across `manager.start`, which can run for a long time —
only around the file-level check-and-persist).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_watch.py -q` → all pass (no behavior change on the happy path).

### Step 2: Per-watch tick isolation

In `tick_all`, wrap each watch's `tick(watch_id, data)` in
`try/except Exception`; on failure, persist a `watch_config_error` event
(type `"watch_config_error"`, message `str(exc)[:300]`) into that watch's
runtime (best-effort — if persisting also fails, swallow) and continue to
the next watch. Remove the `_build_request` error path from the silent-skip
class: `_build_request` failures now produce the event instead of aborting
every watch.

**Verify**: a crafted watch file with an invalid `mode` value in the temp
watch dir; `tick_all()` → other watches still tick; the bad watch's file
gains the `watch_config_error` event.

### Step 3: Store error handling

1. `WatchStore.delete` — catch `OSError` alongside `FileNotFoundError`;
   treat as absent (the route then 404s).
2. `WatchStore.save`/`_write_json_file` — catch `OSError` and re-raise as
   `ValueError("No se pudo guardar la watch...")` so `create()` maps it to a
   400 (check `create()`'s route mapping; the `POST /api/watch` handler
   already maps `ValueError` → 400).
3. `WatchStore.load` already uses the widened `(OSError, ValueError)` +
   dict-root guards (from 028) — verify and leave.

**Verify**: `cd backend && . .venv/bin/activate && python -c "
from pathlib import Path
import tempfile
from app.watch import WatchStore
with tempfile.TemporaryDirectory() as d:
    s = WatchStore(Path(d))
    (Path(d) / 'deadbeef00000000000000000000000000.json').mkdir()
    assert s.delete('deadbeef00000000000000000000000000') is None or s.delete('deadbeef00000000000000000000000000') == False
    print('store-ok')"` → `store-ok` (adjust the assertion to the actual `delete` return contract; the contract: no exception, treated as absent).

### Step 4: Thread lifecycle + last-tick persistence + startup stagger

1. `start()`/`stop()` — make them safe: `stop()` should keep a reference to
   the thread and only clear `self._thread` when the join actually finished
   (if `join(10)` times out, keep the reference and the stop event set; a
   subsequent `start()` must NOT clear a shared stop event that a live
   zombie is still watching — use a per-thread stop event created inside
   `_run_loop`'s start path, not a shared one).
2. Persist `last_tick_at` into the watch file's runtime on each tick (the
   store already persists the runtime dict); restore it on `load()` so a
   restart does not re-fire every watch immediately.
3. Startup stagger: when a watch has no persisted `last_tick_at` (first
   ever), seed its due time with `id % interval_min` minutes of offset
   (hash the id for determinism) so N watches do not all fire on the first
   tick.
4. `tick_all` — check due-ness BEFORE loading: cache `(interval_min,
   next_due)` per watch id in memory; only `store.load()` when due;
   invalidate the cache on create/delete. On the first tick after restart,
   load each watch once to rebuild the cache (this is the one full pass —
   acceptable).

**Verify**: `cd backend && . .venv/bin/activate && python -c "from app.watch import WatchScheduler; print(WatchScheduler.__init__.__doc__ is not None or 'ok')"` — plus the thread tests in Step 5.

### Step 5: Tests

`backend/tests/test_watch_thread.py` (new) — real clock, short intervals,
facade manager:
1. `test_start_runs_ticks` — start with `interval_min=1` and a clock seam
   that records `sleep()` calls; assert `tick_all` runs at least twice.
2. `test_stop_is_idempotent` — stop twice, no exception.
3. `test_restart_after_stop_no_double_thread` — start, stop, start; assert
   exactly one active tick thread (facade counts concurrent `start()` calls).
4. `test_delete_during_tick_does_not_resurrect` — facade `start()` blocks
   until released; call `delete()` while blocked; release; assert no watch
   file exists afterwards and no run was started.
5. `test_bad_config_isolated_from_other_watches` — one valid + one invalid
   watch file; tick_all → valid watch ticks, invalid gets the event.
6. `test_first_tick_after_restart_is_staggered` — two watches with persisted
   `last_tick_at`; restart (new scheduler instance); assert neither fires
   immediately; a fresh watch with no last-tick uses the id-derived offset.

`backend/tests/test_cli.py` (new):
7. `test_watch_scheduler_gate_on` / `test_watch_scheduler_gate_off` —
   monkeypatch the manager (or `app.main.manager`) and env
   `DNS_SPEED_LAB_WATCH_ENABLED`; call `_start_watch_scheduler_if_enabled`;
   assert `start()` called / not called.

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_watch.py tests/test_watch_thread.py tests/test_cli.py -q` → all pass.

### Step 6: Full gate

**Verify**: `make backend-check` → exit 0.

## Test plan

- `backend/tests/test_watch_thread.py` — the 6 thread/lifecycle cases.
- `backend/tests/test_cli.py` — the env-gate cases.
- `backend/tests/test_watch.py` — extended (Step 1/2/3 regression guards
  where natural).
- Structural patterns: existing `test_watch.py` (temp dirs, facade).

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_watch.py tests/test_watch_thread.py tests/test_cli.py -q` — all pass
- [ ] `make backend-check` exits 0
- [ ] `grep -n "watch_config_error" backend/app/watch.py` matches
- [ ] `grep -n "threading.Lock\|threading.RLock" backend/app/watch.py` matches (the delete/tick serialization)
- [ ] `grep -n "last_tick_at" backend/app/watch.py` matches ≥ 2 (persist + restore)
- [ ] `grep -n "IsADirectoryError\|except OSError" backend/app/watch.py` matches in `delete`/`save` regions
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 033 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any code at the "Current state" locations doesn't match the excerpts.
- The delete-race fix requires holding a lock across `manager.start` (it
  must not — if the code shape forces it, STOP and report the design
  conflict).
- `stop()`'s shared-stop-event problem turns out to be already handled
  differently (read the current `start`/`stop` first) — adapt to the real
  shape; if the zombie-thread scenario is unreachable, record that and skip
  the thread-safety half of Step 4.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The per-thread stop event (Step 4.1) is the fix for the zombie-thread
  double-tick hazard; a reviewer should scrutinize the restart path in
  review.
- Persisted `last_tick_at` changes restart semantics deliberately: a watch
  never fires twice within its interval across restarts. The capacity-skip
  still loses the tick (documented decision); the persisted timestamp means
  the skipped interval is not "repaid" — acceptable v1.
- The due-before-read cache must be invalidated on ANY config change path
  (create/delete today; future PUT must too) — note this for the future
  watch-edit feature.
- Merge order: 031 (resolvers) and 033 both touch `watch.py` tick paths —
  trivial regions; either order works. 032 (frontend) is independent.
