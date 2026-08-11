# Plan 005: Preserve canonical run profiles, order history by time, and refresh it at completion

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report it; do not improvise. A coordinating reviewer maintains `plans/README.md` for this planning batch, so do **not** edit that file.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- backend/app/runner.py backend/tests/test_encrypted_dns.py backend/tests/test_include_samples.py backend/tests/test_history_integrity.py frontend/src/App.tsx frontend/src/lib/api.ts frontend/src/lib/api.test.ts frontend/src/lib/runtime.ts frontend/src/lib/runtime.test.ts frontend/src/components/RunHistoryPanel.tsx`
> If any in-scope file changed since this plan was written, compare the Current state excerpts with live code. A material mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/003-profile-target-model.md`
- **Category**: bug
- **Planned at**: commit `e09fd2d`, 2026-08-10
- **Merged**: `ed35ef1`, 2026-08-11

## Why this matters

A run is comparable only when its ranking policy and immutable target snapshot survive persistence. Plan 003 establishes the canonical `scoring_profile` and `target_snapshot` contract, but the current persistence serializer omits even its predecessor `goal`, and history summaries are ordered by random UUID filenames rather than occurrence time. The frontend also fetches history only when the benchmark ID changes, so it does not refresh when that same benchmark becomes terminal and its final persisted metadata is written. This plan makes history end-to-end reliable: canonical profile metadata remains present in saved/history responses, the recent-runs list is deterministic and chronological, and the UI refreshes exactly once after each terminal transition without stale asynchronous updates.

## Current state

- `plans/003-profile-target-model.md` — prerequisite contract: it introduces canonical `scoring_profile` and immutable `target_snapshot`, keeps legacy `goal` only during its compatibility window, and requires those fields in live responses.
- `backend/app/runner.py` — defines benchmark state/serialization, writes metadata under `data/runs`, marks runs terminal, and creates history summaries.
- `backend/tests/test_encrypted_dns.py` — temporary-manager/polling convention for inspecting a persisted history item.
- `backend/tests/test_include_samples.py` — FastAPI `TestClient` convention for status/export response fields.
- `backend/tests/test_history_integrity.py` — create this focused temporary-run-directory regression file; no history-ordering or terminal-persistence-barrier test exists today.
- `frontend/src/App.tsx` — owns polling and the history fetch lifecycle.
- `frontend/src/lib/api.ts` — declares `RunHistoryEntry` and fetches `/api/benchmarks/history`.
- `frontend/src/lib/api.test.ts` — create this small Vitest fetch-mock regression for history's optional abort signal; no API helper test exists today.
- `frontend/src/lib/runtime.ts` and `frontend/src/lib/runtime.test.ts` — existing pure async-lifecycle helper/test convention.
- `frontend/src/components/RunHistoryPanel.tsx` — renders the existing legacy goal badge from an API history entry.

Before plan 003, `BenchmarkState` stores a goal but `as_response()` does not emit it (`backend/app/runner.py:86-137`):

```python
@dataclass
class BenchmarkState:
    ...
    mode: str = "standard"
    goal: str = "speed"
    protocol: str = "udp"

def as_response(self, include_samples: bool = False) -> dict[str, Any]:
    ...
    return {
        "id": self.id,
        ...
        "mode": self.mode,
        "protocol": self.protocol,
        "timeout_sec": self.timeout_sec,
        ...
    }
```

The metadata writer serializes precisely that response (`backend/app/runner.py:554-575`), while terminal state becomes visible immediately before its write:

```python
# backend/app/runner.py:502-513
with self._lock:
    state = self._states[benchmark_id]
    state.status = "done"
    state.finished_at = datetime.now(UTC).isoformat()
    state.results = ranked_results
    state.engine = engine
    state.current_resolver = None
self._persist_run(benchmark_id)

# backend/app/runner.py:565-569
self._write_json_file(
    metadata_path,
    json.dumps(state.as_response(include_samples=False), ensure_ascii=False, indent=2),
)
```

Thus a status poll can observe `done` before a concurrent history request can read the final file. The existing history implementation also reads `goal` but cannot find it in newly written files, and applies the cutoff in filename order (`backend/app/runner.py:398-430`):

```python
run_files = sorted(self._data_runs_dir.glob("[!.]*.json"), reverse=True)
for path in run_files:
    if path.name.endswith(".samples.json"):
        continue
    ...
    runs.append(
        {
            "id": path.stem,
            "mode": data.get("mode"),
            "goal": data.get("goal"),
            "protocol": data.get("protocol"),
            "started_at": data.get("started_at"),
            ...
        }
    )
    if len(runs) >= 50:
        break
```

The frontend's sole history effect depends only on the ID, not the status (`frontend/src/App.tsx:408-415`):

```tsx
useEffect(() => {
  let cancelled = false
  setHistoryLoading(true)
  getBenchmarkHistory()
    .then((res) => { if (!cancelled) { setHistory(res.runs); setHistoryLoading(false) } })
    .catch(() => { if (!cancelled) setHistoryLoading(false) })
  return () => { cancelled = true }
}, [status?.id])
```

`startPolling` replaces `status` for queued/running states and stops as soon as it sees a terminal state (`frontend/src/App.tsx:328-391`), so the above effect does not rerun when `status.id` stays constant and becomes `done`, `failed`, or `cancelled`. `getBenchmarkHistory()` currently has no abort-signal parameter (`frontend/src/lib/api.ts:67-72`). Existing lifecycle infrastructure is available to reuse:

```tsx
// frontend/src/App.tsx:235-246, 738-771
const pollAbortRef = useRef<AbortController | null>(null)
const startRequestSeqRef = useRef<number>(0)
const mountedRef = useRef<boolean>(false)
...
if (!shouldAcceptAsyncResult(requestSeq, startRequestSeqRef.current, mountedRef.current)) return

// frontend/src/lib/runtime.ts:36-38
export function shouldAcceptAsyncResult(requestSeq, latestRequestSeq, isMounted) {
  return isMounted && requestSeq === latestRequestSeq
}
```

The current history type and panel still use the legacy field (`frontend/src/lib/api.ts:62-72`, `frontend/src/components/RunHistoryPanel.tsx:20-40,70-77`):

```tsx
export interface RunHistoryEntry {
  id: string
  mode: string
  goal: string
  protocol: string | null
  ...
}

<span className={`badge ${goalBadgeClass(run.goal)}`}>
  {goalLabelText(run.goal, t as (key: string) => string)}
</span>
```

Conventions to retain:

- Plan 003 is the sole authority for the profile field names and compatibility window. Do not recreate its schema, score policy, or target-selection behavior here.
- Metadata persistence remains disabled for samples by default; `state.as_response(include_samples=False)` is the canonical metadata payload.
- `BenchmarkManager` uses an `RLock` (`backend/app/runner.py:205-235`), so a narrow persistence barrier can safely re-enter manager helpers; do not substitute a plain lock or hold it across network DNS work.
- Use temporary manager data directories and monkeypatched measurements as in `backend/tests/test_encrypted_dns.py:281-315`; never run live DNS in these tests.
- Use the existing pure-function Vitest pattern in `frontend/src/lib/runtime.test.ts`; this repository does not currently have a React component-test harness, so do not add a browser/testing-library dependency for this focused lifecycle regression.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install backend tooling (only if `.venv` is absent) | `make backend-install` | exit 0 and `backend/.venv` exists |
| Focused backend history tests | `cd backend && . .venv/bin/activate && pytest -q tests/test_encrypted_dns.py tests/test_include_samples.py tests/test_history_integrity.py` | exit 0; all selected tests pass |
| Focused frontend lifecycle/API tests | `cd frontend && npm test -- src/lib/runtime.test.ts src/lib/api.test.ts` | exit 0; all selected Vitest tests pass |
| Frontend type/lint/build gate | `cd frontend && npm run lint && npm run typecheck && npm run build` | exit 0; no lint/type/build errors |
| Full backend quality gate | `make backend-check` | exit 0; Ruff, format check, mypy, Bandit, and pytest all pass |
| Scope review | `git diff --check && git status --short` | no whitespace errors; implementation/test changes only in the in-scope paths, plus coordinator-owned plan files already present |

## Scope

**In scope** (the only files to modify):

- `backend/app/runner.py`
- `backend/tests/test_encrypted_dns.py`
- `backend/tests/test_include_samples.py`
- `backend/tests/test_history_integrity.py` (create)
- `frontend/src/App.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/api.test.ts` (create)
- `frontend/src/lib/runtime.ts`
- `frontend/src/lib/runtime.test.ts`
- `frontend/src/components/RunHistoryPanel.tsx`

**Out of scope**:

- `backend/app/models.py`, `backend/app/stats.py`, and the profile migration itself. These belong to prerequisite plan 003; consume its canonical fields exactly as landed.
- `backend/app/main.py` route paths/contracts; its existing manager calls already propagate the revised data.
- Run-ID validation, disk-path containment, retention/deletion policy, and atomic-write replacement; plan 014 handles the ID boundary and this plan adds only the terminal-read ordering barrier needed for the UI refresh.
- Sample persistence defaults and contents; retain `include_samples=False` metadata persistence.
- Frontend translations, CSS/layout changes, named/synced profiles, or a new React test framework. The existing badge labels can render the canonical scoring-profile values using existing translation keys.
- Any attempt to infer missing canonical profile/snapshot data from old result payloads. Old files remain honestly incomplete.

## Git workflow

- Branch: `advisor/005-run-history-integrity`.
- Commit the implementation and regression tests together using the repository's Conventional Commit style, for example: `fix: preserve benchmark profile history`.
- Do not push, open a PR, or edit `plans/README.md` unless the operator explicitly asks.

## Steps

### Step 1: Confirm and preserve the canonical profile metadata from plan 003

Before editing, read the completed Plan 003 contract and inspect its landed `BenchmarkState`, `as_response()`, and frontend types. It must expose canonical `scoring_profile` and `target_snapshot`; legacy `goal`, if still emitted, must equal the canonical scoring profile during the documented compatibility window.

In `backend/app/runner.py`, make `BenchmarkState.as_response()` include every Plan 003 canonical field exactly once, adjacent to `mode` and `protocol`. If Plan 003 already added them to the canonical response, do not serialize a second copy elsewhere. `_persist_run()` must continue to serialize `state.as_response(include_samples=False)`, which ensures live status, JSON export, and retained metadata share one source of truth.

Extend `list_history()` summaries to return `scoring_profile` and `target_snapshot` from persisted metadata. Return legacy `goal` only for compatibility and use the canonical profile as a fallback for newly migrated files if the compatibility alias is absent. Do not use a fallback in the opposite direction for `target_snapshot`: absent legacy snapshot data must stay absent.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_include_samples.py tests/test_encrypted_dns.py` → exit 0 after Step 3 adds profile assertions.

### Step 2: Ensure a terminal status cannot outrun its metadata write

In `backend/app/runner.py`, make terminal state persistence a narrow visibility barrier in both `_set_done()` and `_set_failed()`:

1. Retain the existing final-state assignments and deterministic result ordering.
2. While holding the existing manager `RLock`, call the existing `_persist_run(benchmark_id)` after finalizing the state. Its re-entrant `get_state()`/storage-warning calls must continue to work under `RLock`.
3. Release the lock only after the metadata write attempt has finished. A client calling `manager.get()` after it sees a terminal status must therefore be unable to race ahead of the corresponding final metadata write.

Do **not** hold the lock around DNS measurements, scoring, query scheduling, or any new retry loop. Keep existing storage-warning behavior: an `OSError` sets a warning and terminal status remains available; this is not an atomic-write or durability redesign.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_history_integrity.py` → exit 0 after adding the synchronization regression in Step 4.

### Step 3: Cover canonical profile propagation through state, export, and persisted history

Extend the existing focused tests rather than creating a broad API fixture:

- In `backend/tests/test_include_samples.py`, construct the injected state using the non-default canonical scoring profile and a small immutable target snapshot defined by Plan 003 (for example one normalized resolver and a selection source). Assert the status response and both JSON-export response variants preserve exact canonical profile/snapshot values. If legacy `goal` remains in the Plan 003 migration, assert it equals rather than conflicts with `scoring_profile`.
- In `backend/tests/test_encrypted_dns.py`, use a non-default profile/request value accepted by Plan 003 in `test_protocol_reflected_in_history`. After terminal persistence, assert the matching item contains protocol, `scoring_profile`, and the exact target snapshot. Do not assert a legacy alias unless Plan 003 guarantees it.

Keep temporary directories, terminal polling, and monkeypatched measurement functions. Do not send a real DNS query or rely on wall-clock sleeps.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_encrypted_dns.py tests/test_include_samples.py` → all selected tests pass.

### Step 4: Sort history after parsing timestamps and add backend integrity regressions

Replace filename-lexicographic history ordering in `BenchmarkManager.list_history()` with a two-phase process:

1. Read each non-sample JSON file using the existing JSON/OSError recovery. Build the public summary, including canonical profile fields, plus an internal sortable value derived from `data["started_at"]`.
2. Parse ISO-8601 values with `datetime.fromisoformat`, sort valid timestamps newest-first, and use a stable deterministic secondary key (`id`/`path.stem`) for equal timestamps. Give missing or malformed timestamps a deterministic position after valid dated runs; do not throw or omit an otherwise readable run solely because its timestamp is malformed.
3. Strip the internal sort value and return at most 50 public summaries **after** sorting.

Create `backend/tests/test_history_integrity.py` using a temporary `BenchmarkManager(..., data_runs_dir=tmp_path / "runs")`. Add all of these cases:

- **Canonical metadata**: a minimal persisted current-format run returns the exact `scoring_profile` and target snapshot in history; an old readable file without them remains readable with no invented snapshot.
- **Filename independence**: a lexically late filename with an older valid timestamp appears after a lexically early filename with a newer timestamp.
- **Cutoff after sort**: create 51 valid anti-chronological filenames; history contains the newest 50 and omits only the oldest.
- **Tie/legacy tolerance**: two equal timestamps use the documented ID secondary order; a missing/malformed timestamp follows valid timestamps without an exception.
- **Sidecar exclusion**: a recent `*.samples.json` file is never listed.
- **Terminal persistence barrier**: use `threading.Event` and a monkeypatched `_write_json_file` that pauses inside the final metadata write. Start `_set_done()` in one thread, then call `manager.get()` from another. Assert the read cannot complete until the write-release event is set, then returns `status == "done"`. Use bounded event synchronization only; no network or fixed `sleep`.

Do not sort by filesystem mtime, UUID filename, result score, or `finished_at`. `started_at` is the list's existing creation-time contract and exists for every current manager-written record.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_encrypted_dns.py tests/test_include_samples.py tests/test_history_integrity.py` → all existing and new tests pass.

### Step 5: Model canonical history entries and centralize safe history refresh in the frontend

After Plan 003 types are present, update `frontend/src/lib/api.ts` so `RunHistoryEntry` represents `scoring_profile` and `target_snapshot` using Plan 003's exported types. Keep `goal` optional/nullable only as a compatibility fallback for old history rows. Extend `getBenchmarkHistory` to accept an optional `AbortSignal` and pass it to `fetch`; existing callers without a signal must remain valid.

In `frontend/src/lib/runtime.ts`, add a small pure helper that returns a stable terminal-refresh key only when a non-empty benchmark ID has a terminal status (`done`, `failed`, or `cancelled`) and that key is different from the previously refreshed terminal key. It must return no key for `queued`, `running`, a missing ID/status, or an already-refreshed terminal key. Test this helper directly in the existing `runtime.test.ts` suite.

Create `frontend/src/lib/api.test.ts` using Vitest's `vi.stubGlobal`/mocked `fetch` pattern. Assert `getBenchmarkHistory(controller.signal)` calls the existing history URL with that exact signal and returns the mocked `runs` payload. Restore the global after each test. This focused API mock verifies the abortable boundary used by `App.tsx` without adding a React component-test dependency.

In `frontend/src/App.tsx`:

1. Replace the inline history effect with one `refreshHistory` callback that increments a history request sequence, aborts a previous history request, sets loading, calls `getBenchmarkHistory(signal)`, and commits results/errors only when `shouldAcceptAsyncResult` confirms it is the latest request and the component is mounted.
2. Keep one initial-load effect that invokes `refreshHistory` once.
3. Add a separate effect keyed by `status?.id` and `status?.status`. Use the pure terminal key helper plus a ref recording the last terminal key; invoke `refreshHistory` exactly once when a particular run transitions to terminal. It must not refetch for normal progress changes, repeated renders of the same terminal payload, or stale polling responses.
4. Abort the outstanding history request in unmount cleanup, following the existing polling cleanup convention.

The Step 2 backend barrier is required: when this effect receives an authoritative terminal status from polling, the final metadata write has completed. Do not add timer-based retries, poll history continuously, or change benchmark polling cadence.

Finally update `frontend/src/components/RunHistoryPanel.tsx` to render `scoring_profile` as the badge source and fall back to legacy `goal` only for old records. Reuse the existing goal label/badge mapping; do not add copy/translation keys or display the potentially long target snapshot in the compact list.

**Verify**: `cd frontend && npm test -- src/lib/runtime.test.ts src/lib/api.test.ts && npm run typecheck` → exit 0; the helper covers first terminal transition, duplicate terminal payload, next-run terminal transition, and non-terminal statuses, and the API mock verifies the exact abort signal.

### Step 6: Run complete gates and review compatibility boundaries

Run all quality gates. Inspect the old-format fixture from Step 4 through both history API typing and `RunHistoryPanel` fallback behavior. The frontend must never present the legacy goal as an independent policy when a canonical scoring profile is present; it is only a compatibility fallback.

**Verify**: `make backend-check && cd frontend && npm run lint && npm run typecheck && npm test && npm run build` → all commands exit 0.

## Test plan

- Canonical profile persistence: a non-default `scoring_profile` and immutable target snapshot appear identically in status, both JSON-export modes, persisted metadata, and a history summary.
- Legacy compatibility: a readable old JSON file lacking canonical profile/snapshot data stays listed without fabricated data; a legacy goal is used only as an explicit display fallback.
- History order: timestamps beat UUID/filename order; 50-entry cutoff is after sort; equal timestamps and malformed dates are deterministic/non-fatal; sample sidecars stay excluded.
- Terminal visibility: a concurrent status read cannot expose `done` before its synchronous metadata write attempt finishes.
- Frontend lifecycle: the pure terminal-key test proves exactly one refresh decision for each terminal run, none for repeated terminal/progress states, and a new decision for a new run. A Vitest fetch mock verifies the `AbortSignal` reaches the history API helper; the existing sequence/mounted guard prevents stale responses from overwriting fresh history.
- Final verification: `make backend-check` and `cd frontend && npm run lint && npm run typecheck && npm test && npm run build` → all pass.

## Done criteria

- [ ] Plan 003's canonical `scoring_profile` and `target_snapshot` are present exactly once in the canonical live/persisted response and are returned by history summaries.
- [ ] If the Plan 003 legacy `goal` alias remains, it cannot disagree with `scoring_profile`; old incomplete records remain readable without invented target metadata.
- [ ] A client cannot receive a terminal benchmark status from `manager.get()` before that terminal metadata write attempt has completed.
- [ ] `list_history()` returns at most 50 non-sample runs ordered by valid `started_at` descending, with deterministic ties and malformed-date handling.
- [ ] Filename lexicographic order cannot change history order or exclude a newer run at the cutoff.
- [ ] Frontend history performs an initial fetch and exactly one safely sequenced/abortable refresh for each terminal benchmark transition, not for progress-only updates or duplicate terminal payloads.
- [ ] `frontend/src/lib/api.test.ts` proves the abort signal is passed to the history fetch without adding a component-test dependency.
- [ ] `RunHistoryPanel` uses canonical `scoring_profile` and only falls back to legacy `goal` for old entries.
- [ ] `make backend-check` and `cd frontend && npm run lint && npm run typecheck && npm test && npm run build` exit 0.
- [ ] `git diff --check` exits 0 and implementation/test changes are confined to the in-scope paths.
- [ ] `plans/README.md` is unchanged.

## STOP conditions

Stop and report back if:

- Plan 003 has not landed, its canonical field names/types differ from `scoring_profile` and `target_snapshot`, or it removes the promised compatibility contract; do not invent parallel profile fields.
- The response serializer/persistence flow has materially changed such that keeping the terminal write under the current `RLock` would deadlock, hold a lock around DNS/network work, or break the storage-warning path.
- Existing persisted `started_at` values are not ISO-8601 strings accepted by `datetime.fromisoformat`, or consumers explicitly require `finished_at` rather than `started_at` chronology.
- A correct frontend regression requires a new component/browser test dependency or a timer/retry loop rather than the existing pure-helper, abort, and sequence conventions.
- The proposed API type change reveals that the target snapshot is too large/sensitive for the history-list endpoint; preserve it only in full run retrieval and report the contract decision rather than silently exposing or truncating it.
- The required regression needs a live DNS query, real-clock sleeps, a write outside pytest's `tmp_path`, or a change outside the in-scope list.
- Either full quality gate fails twice after a reasonable in-scope correction.

## Maintenance notes

- Any future metadata that changes ranking interpretation should be added to the canonical response once and explicitly considered for the compact history summary; preserve old files as incomplete rather than guessing.
- Reviewers should scrutinize the narrow lock scope: it protects terminal state visibility only, not DNS work, and must keep persistence errors non-fatal.
- Future changes to polling/status unions must update the terminal-refresh helper and its unit tests in the same PR.
- This plan deliberately does not add atomic replacement writes, history retention cleanup, run-ID validation, target-profile UI expansion, or a React component-test framework.
