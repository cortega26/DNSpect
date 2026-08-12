# Plan 026: Frontend session fixes (history refresh, real cancel, preflight debounce, poll resilience)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d5002d0..HEAD -- frontend/src/App.tsx frontend/src/hooks/useGuidedVerification.ts frontend/src/hooks/useBenchmarkSession.ts frontend/src/hooks/useProtocolComparison.ts frontend/src/lib/api.ts frontend/src/components/ProtocolComparisonPanel.tsx frontend/src/lib/runtime.test.ts frontend/src/lib/runtime.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: MED
- **Depends on**: none (plan 027's hook tests will exercise these fixes, but nothing here depends on 027)
- **Category**: correctness/perf (audit findings 8, 9, 10, 12 + a11y gap)
- **Planned at**: commit `d5002d0`, 2026-08-11

## Why this matters

Four small but user-visible frontend defects shipped with the post-audit
feature wave: (8) the run-history panel never refreshes after a benchmark
completes (the `terminalRefreshKey` helper in `runtime.ts` exists with a test
and zero callers); (9) "cancel" in the guided verification modal aborts
nothing — the `AbortController` is never created, and `getSystemDns`/
`probeResolvers` accept no signal, so discarded verifications keep probing
the backend; (10) the protocol-comparison preflight POSTs on **every
keystroke** in the queries field (no debounce); (12) a single transient poll
error permanently kills the live benchmark/protocol-comparison progress UI
(no retry/backoff). Plus one a11y regression in the comparison UI: ✓/✗ glyphs
announced bare by screen readers, breaking the pattern the sibling panel
already established.

## Current state

- `frontend/src/lib/runtime.ts:49-57` — `terminalRefreshKey(status, lastKey)`
  exists, unit-tested (`runtime.test.ts:64-89`), with **no production
  callers**.
- `frontend/src/App.tsx:225` — `const { history, historyLoading } = useRunHistory(status?.id ?? null)` — `refresh` is not destructured; `useRunHistory.ts:39-46` re-fetches only when `sessionStatusId` changes (a run completing does not change `status.id`).
- `frontend/src/hooks/useGuidedVerification.ts:31-32` — `abortRef = useRef<AbortController | null>(null)`; `cancel()` (45-52) and the unmount effect (35-43) call `abortRef.current?.abort()`, but `verify` (54-120) never assigns `abortRef.current`.
- `frontend/src/lib/api.ts:29-33` — `getSystemDns(): Promise<SystemDnsPayload>` (no signal); `api.ts:169-187` — `probeResolvers(payload: ProbePayload): Promise<ProbeResponse>` (no signal). Contrast: `getBenchmarkHistory(signal?)` (api.ts:104) and `getBenchmark(id, includeSamples?, signal?)` (api.ts:110) already take signals.
- `frontend/src/App.tsx:361-398` — `protocolComparisonPayload` `useMemo` depends on `queriesText`; the effect at 395-398 calls `runProtocolComparisonPreflight(payload)` on every payload change (per keystroke).
- `frontend/src/hooks/useBenchmarkSession.ts:113-120` — `pollOnce` catch: `setError(...)` then `stopPolling()` on ANY non-abort error; `useProtocolComparison.ts:134-138` does the same. `POLL_INTERVAL_MS = 1000` (useBenchmarkSession.ts:20; useProtocolComparison.ts:7).
- `frontend/src/components/ProtocolComparisonPanel.tsx:109-112` — renders `tone.label` (`' ✓'` / `' ✗'`) bare in the `<td>`; `frontend/src/components/RunComparisonPanel.tsx:125-132` wraps the same pattern in a `DeltaValue` span with `aria-label` (see `RunComparisonPanel.tsx:172-198` for the pattern).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat d5002d0..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |

## Scope

**In scope**:
- `frontend/src/App.tsx` — history refresh wiring, preflight debounce, capabilities-passthrough unaffected
- `frontend/src/hooks/useGuidedVerification.ts` — real abort wiring
- `frontend/src/hooks/useBenchmarkSession.ts` — poll retry/backoff
- `frontend/src/hooks/useProtocolComparison.ts` — poll retry/backoff
- `frontend/src/lib/api.ts` — `signal` params on `getSystemDns` / `probeResolvers`
- `frontend/src/components/ProtocolComparisonPanel.tsx` — a11y glyph labeling
- `frontend/src/lib/runtime.test.ts` — extend for any helper extracted (debounce)

**Out of scope** (do NOT touch, even though they look related):
- Plan 027's hook unit tests — written separately; do not add test files for
  the hooks in this plan (keep this plan's diff to behavior).
- `useRunHistory.ts` / `useRunComparison.ts` internals — the refresh is wired
  from `App.tsx` via the existing `refresh` interface.
- Backend changes of any kind.
- The comparison preflight *backend* cost (the debounce reduces client-side
  firing only).

## Git workflow

- Branch: `plan/026-frontend-session-fixes`
- Commits: conventional, one per fix (`fix(history): refresh after terminal transition`, `fix(guided-verification): wire real abort signal`, `perf(protocol-comparison): debounce preflight`, `fix(session): retry transient poll errors with backoff`, `a11y(comparison): label delta glyphs`). Merge commit on main:
  `merge: plan 026 — frontend session fixes`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Refresh history on terminal transitions

In `frontend/src/App.tsx`:
1. Destructure `refresh` from `useRunHistory` (line 225).
2. Add `const lastTerminalKeyRef = useRef<string | null>(null)` (or state);
   add an effect that computes `terminalRefreshKey(status, lastTerminalKeyRef.current)` (import from `@/lib/runtime`), and when it returns a key, store it and call `refresh()`:
   ```tsx
   const terminalKey = terminalRefreshKey(status, lastTerminalKeyRef.current)
   useEffect(() => {
     if (terminalKey === null) return
     lastTerminalKeyRef.current = terminalKey
     void refresh()
   }, [terminalKey, refresh])
   ```
   (`terminalRefreshKey`'s contract: returns a key when the status has just
   become terminal — verify its exact signature in `runtime.ts:49-57` and
   adapt; if it takes `(status, lastKey) => string | null`, the wiring above
   is correct.)
3. `refresh` is a stable `useCallback` in the hook, so the effect fires once
   per terminal transition.

**Verify**: `cd frontend && npm run typecheck` → exit 0. (Behavior is exercised by plan 027's tests; this step's gate is compile + the wiring assertions below.)

### Step 2: Real cancel for guided verification

1. `frontend/src/lib/api.ts` — add `signal?: AbortSignal` to `getSystemDns` (line 29) and `probeResolvers` (line 169), passing it to `fetch` (follow the style of `getBenchmarkHistory` at api.ts:104-105).
2. `frontend/src/hooks/useGuidedVerification.ts` — at the top of `verify` (line 54), after the seq guard:
   ```tsx
   abortRef.current?.abort()
   const controller = new AbortController()
   abortRef.current = controller
   ```
   and pass `controller.signal` to the `getSystemDns()` and `probeResolvers(...)` calls inside `verify` (lines ~66 and the probe call site; find both via grep of `getSystemDns`/`probeResolvers` within the file).

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0.

### Step 3: Debounce the preflight

In `frontend/src/App.tsx` (effect at 395-398), debounce the call ~300ms:

```tsx
useEffect(() => {
  if (!protocolComparisonPayload) return
  const handle = window.setTimeout(() => {
    void runProtocolComparisonPreflight(protocolComparisonPayload)
  }, 300)
  return () => window.clearTimeout(handle)
}, [protocolComparisonPayload, runProtocolComparisonPreflight])
```

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0. (A typechecked-but-behavioral check: typing in the queries field while the comparison is open should fire at most one preflight per 300ms pause — manual smoke acceptable; automated coverage lands with plan 027.)

### Step 4: Retry/backoff for transient poll errors

In both `useBenchmarkSession.ts` (`pollOnce`, lines 113-120) and `useProtocolComparison.ts` (lines 134-138):

1. Add `const consecutiveErrorsRef = useRef(0)` per hook.
2. On the non-abort error path: instead of `stopPolling()`, increment the counter and:
   - `setError(...)` (keep the message visible),
   - if `consecutiveErrorsRef.current >= 5` → `stopPolling()` (genuinely broken endpoint keeps current behavior as the fallback);
   - else `scheduleNext(Math.min(1000 * 2 ** (consecutiveErrorsRef.current - 1), 30_000))` (1s, 2s, 4s, ... capped at 30s).
3. On the success path, reset `consecutiveErrorsRef.current = 0`.
4. Keep the abort/`isCurrentSession` guards exactly as they are.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0.

### Step 5: Label the delta glyphs (a11y)

In `frontend/src/components/ProtocolComparisonPanel.tsx:109-112`, mirror the `RunComparisonPanel` pattern: wrap the tone label in a `<span aria-label={...}>` or set `aria-label` on a wrapping element that includes the metric/delta text; at minimum, mark the glyph `aria-hidden="true"` and keep the numeric text in the DOM. Follow the exact `DeltaValue` implementation at `RunComparisonPanel.tsx:172-198` (read it first) so both panels announce identically. Use an existing i18n key or compose the same `t()` call the sibling panel uses.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0.

### Step 6: Full frontend gate

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0.

## Test plan

- No new test files in this plan (deliberate — plan 027 adds hook tests that
  will pin the Step 1/2/4 behaviors). 
- Existing suites must stay green: `npm test` (11 lib test files, incl. the
  `terminalRefreshKey` tests in `runtime.test.ts`).
- If any pure helper is extracted during Step 3 (e.g. a `debounce` util in
  `runtime.ts`), add unit tests for it in `runtime.test.ts` following the
  file's existing pattern — that is the one permitted test addition.

## Done criteria

ALL must hold:

- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `grep -rn "terminalRefreshKey" frontend/src/App.tsx` matches (production caller exists)
- [ ] `grep -n "signal" frontend/src/lib/api.ts` matches `getSystemDns` and `probeResolvers` lines
- [ ] `grep -n "AbortController" frontend/src/hooks/useGuidedVerification.ts` matches at least twice (create + use)
- [ ] `grep -n "setTimeout" frontend/src/App.tsx` matches inside the preflight effect with a `300` delay
- [ ] `grep -rn "consecutiveErrorsRef" frontend/src/hooks/useBenchmarkSession.ts frontend/src/hooks/useProtocolComparison.ts` matches both
- [ ] `grep -n "aria-label\|aria-hidden" frontend/src/components/ProtocolComparisonPanel.tsx` matches in the delta-cell region
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 026 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the "Current state" locations doesn't match the excerpts.
- `terminalRefreshKey`'s signature/behavior differs from the description in a
  way that makes the Step 1 wiring wrong — read `runtime.ts:49-57` and its
  tests first; adapt the wiring to the real contract, and if the helper
  itself must change, STOP and report.
- A poll-retry change breaks the e2e specs (`frontend/tests/e2e/*.spec.ts`) —
  stop and report rather than weakening the e2e suite.
- A step's verification fails twice after a reasonable fix attempt.
- The task appears to require touching `useRunHistory.ts`/`useRunComparison.ts`
  internals or any backend file to proceed.

## Maintenance notes

- Plan 027's hook tests will pin Steps 1, 2, and 4; if those tests reveal a
  behavior gap in this plan's fixes, treat it as a revision of THIS plan
  (fix here) rather than a workaround in the tests.
- The retry/backoff constants (5 attempts, 1s→30s) are the tuning knobs; the
  existing e2e specs assume the 1s cadence on the happy path — keep
  `POLL_INTERVAL_MS` for success polling unchanged.
- `RunComparisonPanel.tsx`'s `DeltaValue` is the canonical a11y pattern for
  delta cells; new panels must copy it, not the bare-glyph variant.
