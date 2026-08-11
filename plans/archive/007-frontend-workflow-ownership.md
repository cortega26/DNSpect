# Plan 007: Give each frontend workflow one current owner and reject invalid saved runs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A reviewer dispatched this plan and maintains the
> index, so do not edit plans/README.md.
>
> **Drift check (run first)**: <code>git diff --stat e09fd2d..HEAD -- frontend/src/App.tsx frontend/src/components/DashboardControls.tsx frontend/src/lib/api.ts frontend/src/lib/reporting.ts frontend/src/lib/reporting.test.ts frontend/src/lib/runtime.ts frontend/src/lib/runtime.test.ts frontend/src/lib/types.ts</code>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/003-profile-target-model.md
- **Category**: bug, tests, tech-debt
- **Planned at**: commit <code>e09fd2d</code>, 2026-08-10
- **Merged**: `37bfbfa`, 2026-08-11

## Why this matters

The frontend has good polling guards, but not every user action has the same
ownership rules. A rapid double activation can make multiple benchmark POSTs
before status becomes running; stale history, verification, and sample
responses can overwrite newer UI state; and structurally invalid localStorage
payloads are cast to BenchmarkStatus before App dereferences them.

This plan establishes a small, consistent latest-request-wins contract and a
synchronous start lock. It prevents avoidable duplicate benchmark jobs,
prevents late responses from reopening or changing a newer view, and removes
an unsafe type escape at the persistence boundary without claiming to cancel a
job the backend has already accepted.

## Current state

- frontend/src/App.tsx — owns benchmark start, polling, history selection,
  guided verification, sample loading, and saved-run presentation.
- frontend/src/components/DashboardControls.tsx — exposes the start button but
  only knows whether a status is running.
- frontend/src/lib/api.ts — fetch wrappers; getBenchmark accepts a signal but
  startBenchmark, getSystemDns, and probeResolvers currently do not.
- frontend/src/lib/runtime.ts — existing pure predicates for polling and
  stale-result acceptance.
- frontend/src/lib/reporting.ts — localStorage envelope parsing and persistence.
- frontend/src/lib/types.ts — BenchmarkStatus fields App and child components
  dereference.

The start button remains enabled during the initial POST because it only uses
isRunning, which becomes true after a subsequent status response:

    # frontend/src/components/DashboardControls.tsx:232-237
    <button className="btn-start" onClick={props.onStart}
      disabled={props.isRunning || props.selected.size === 0}>

    # frontend/src/App.tsx:540,737-773
    const isRunning = status?.status === 'running' || status?.status === 'queued'
    const requestSeq = startRequestSeqRef.current + 1
    ...
    const response = await startBenchmark(payload)
    if (!shouldAcceptAsyncResult(requestSeq, startRequestSeqRef.current,
      mountedRef.current)) return
    setBenchmarkId(response.benchmark_id)

The sequence suppresses stale UI writes but does not prevent each click from
issuing a POST. The backend can therefore create more than one job even though
only the latest response is shown.

History selection and guided verification do not use a sequence or abort
signal:

    # frontend/src/App.tsx:417-431
    const pastRun = await getBenchmark(runId)
    setStatus(pastRun)
    setBenchmarkId(runId)
    setViewingSavedRun(true)

    # frontend/src/App.tsx:834-888
    latestSystemDns = await getSystemDns()
    ...
    const probePayload = await probeResolvers(...)
    ...
    setGuidedVerification(...)
    ...
    setIsVerifyingGuided(false)

Closing the guided modal only clears the visible flag:

    # frontend/src/App.tsx:1571-1576
    onClose={() => {
      setGuidedApplyOpen(false)
      setIsVerifyingGuided(false)
    }}

Sample loading can write a result selected for an older benchmark or resolver:

    # frontend/src/App.tsx:957-970
    const full = await getBenchmark(benchmarkId, true)
    const resolved = full.results?.find((row) =>
      row.resolver === selectedResult.resolver)
    if (resolved) setSelectedResult(resolved)

The persistence boundary checks only envelope shape and then asserts an
unvalidated payload:

    # frontend/src/lib/reporting.ts:152-170
    if (!isObject(parsed.payload) || !isObject(parsed.metadata)) ...
    ...
    payload: parsed.payload as unknown as BenchmarkStatus

App directly accesses nested progress fields:

    # frontend/src/App.tsx:540-544
    const progressPct = status?.progress.total ? ...
    const lastSampleAtMs = useMemo(
      () => parseTimestampMs(status?.progress.last_sample_at), ...)

Existing strengths to preserve:

- App polling increments a session ID, clears its timer, aborts the active
  request, and avoids overlapping polls at App.tsx:250-406.
- runtime.ts:32-46 and runtime.test.ts:31-58 already define and test current
  polling/session and stale-result predicates.
- reporting.test.ts:136-237 already tests valid envelopes, schema mismatch,
  malformed outer payloads, and storage removal.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused async/persistence tests | <code>cd frontend && npm test -- runtime.test.ts reporting.test.ts</code> | Exit 0; all stale-action and saved-run tests pass. |
| Typecheck | <code>cd frontend && npm run typecheck</code> | Exit 0 with no TypeScript errors. |
| Full frontend tests | <code>cd frontend && npm test</code> | Exit 0; all Vitest tests pass. |
| Lint/build | <code>cd frontend && npm run lint && npm run build</code> | Exit 0; lint and production build pass. |

## Suggested executor toolkit

- Use CodeGraph, if available, to find every caller of startBenchmark,
  getBenchmark, getSystemDns, and probeResolvers before adding signal
  parameters.
- Do not add a client-side cancel-benchmark promise unless the backend has a
  documented cancellation endpoint. Aborting a fetch is a UI ownership action,
  not a guarantee that server-side work stopped.

## Scope

**In scope** (the only files you should modify):

- frontend/src/App.tsx
- frontend/src/components/DashboardControls.tsx
- frontend/src/lib/api.ts
- frontend/src/lib/reporting.ts
- frontend/src/lib/reporting.test.ts
- frontend/src/lib/runtime.ts
- frontend/src/lib/runtime.test.ts
- frontend/src/lib/types.ts

**Out of scope** (do NOT touch, even though they look related):

- plans/README.md — the reviewer maintains the plan index.
- Backend benchmark cancellation, runner lifecycle, or API response shape.
  This plan prevents duplicate starts before they are sent; it does not add a
  server cancellation feature.
- History refresh/persistence timing — plan 005 owns completed-run refresh.
- Region selection, target snapshots, and scoring-profile changes — plans 003
  and 004 own those contracts.
- Visual charts, ranking labels, and layout changes — plan 008 owns them.
- A browser test framework — plan 010 establishes it. This plan supplies
  deterministic unit coverage that plan 010 can exercise later.

## Git workflow

- Branch: <code>advisor/007-frontend-workflow-ownership</code>
- Use conventional commits, for example
  <code>fix(frontend): guard stale benchmark workflow responses</code>.
- Keep request ownership, saved-run validation, and focused tests in separate
  reviewable commits. Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Make start submission synchronously single-owner

In App, add a start-in-flight ref and visible isStarting state. Check the ref
before allocating a request sequence or clearing the current view, set it
synchronously before calling startBenchmark, and clear it only for the request
that still owns the action in a finally block. Keep the existing
sequence/mounted guard for response writes.

Pass an explicit isStarting, or a correctly named combined busy value, to
DashboardControls. Disable Start when running, starting, or no resolver is
selected. The second activation during a pending POST must be a no-op: it must
not increment the active sequence and must not make another POST. Do not rely
solely on React state for this guarantee; the ref closes the same-event-loop
race.

Ensure every navigation/reset path that intentionally supersedes a pending
start invalidates its UI response. It may abort the client request only if
api.ts is updated to accept a signal; do not claim the backend job was
cancelled after a request could have reached it.

**Verify**: <code>cd frontend && npm run typecheck && npm test -- runtime.test.ts</code> → exit 0; current-request guard tests include start-in-flight ownership.

### Step 2: Apply one latest-request rule to selection, verification, and samples

Reuse shouldAcceptAsyncResult, or extend runtime.ts only with a similarly
small pure helper, for every asynchronous action that can be superseded. Give
each independent workflow its own monotonic sequence ref and AbortController
ref:

- History selection: beginning a new selection, benchmark start, or unmount
  invalidates/aborts the prior getBenchmark request. Commit status,
  benchmark ID, saved-view flag, selection, and errors only if the token is
  current.
- Guided verification: pass one signal to getSystemDns and probeResolvers;
  close, primary-result replacement, start, and unmount abort/invalidate it.
  An AbortError must not render as a verification error, and only the current
  request can clear isVerifying or publish a result.
- Sample loading: capture benchmark ID and resolver at dispatch time,
  abort/invalidate on detail close, benchmark change, result replacement, or
  unmount, and commit a loaded row only when both identities remain current.

Add optional AbortSignal parameters to getSystemDns, startBenchmark if used,
and probeResolvers in api.ts. Preserve existing callers by making signals
optional, and ensure an abort is distinguishable from a real HTTP failure.

**Verify**: <code>cd frontend && npm run typecheck && npm test -- runtime.test.ts</code> → exit 0; tests explicitly reject an old selection, a closed verification, and an old sample token.

### Step 3: Validate saved BenchmarkStatus data before it enters React state

Replace the reporting.ts assertion with an explicit runtime parser/type guard.
It must validate envelope metadata plus every required BenchmarkStatus field
and every nested result/stat field that App or a rendered child dereferences.
Reject invalid enum values, missing/non-object progress, non-finite required
numbers, invalid results arrays, and malformed resolver rows. Permit
documented optional fields and future additive fields so valid
forward-compatible saved runs are not discarded merely for extra data.

Keep the current schema-version invalidation behavior. On a structurally
invalid v1 payload, return malformed_payload and remove the localStorage entry
through loadSavedLastRun. Do not coerce malformed values to defaults; a saved
run is historical measurement data and must be render-safe or rejected.
Adjust types only to accurately represent the validated persisted contract;
do not weaken BenchmarkStatus to optional nested fields.

**Verify**: <code>cd frontend && npm test -- reporting.test.ts</code> → exit 0; valid metadata with missing progress, invalid status, and malformed nested result is rejected and removed.

### Step 4: Establish lifecycle cleanup and error semantics

Audit App cleanup after the preceding changes. On unmount, continue to stop
polling and additionally abort/invalidate start-owned, history-selection,
guided-verification, and sample-loading requests. On intentional
supersession, do not replace a newer error/status with an AbortError or stale
success. A genuine current HTTP failure must retain existing localized error
behavior.

Use comments only where ownership is non-obvious; do not create a generic
request framework or move orchestration into hooks here. Plan 015 owns that
refactor after these invariants have tests and stable behavior.

**Verify**: <code>cd frontend && npm run lint && npm run typecheck && npm test</code> → exit 0; no lint suppression or unsafe BenchmarkStatus cast is introduced.

### Step 5: Run complete gates and preserve the API boundary

Run the full frontend gates. Inspect the final diff to confirm no backend
endpoint, persistence schema version, scoring/target semantics, or history
refresh policy changed incidentally. Leave a concise code comment only if it
explains why a fetch abort does not imply backend cancellation.

**Verify**: <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run build</code> → all commands exit 0.

## Test plan

- Extend runtime.test.ts using its current current-session and stale-result
  structure to cover duplicate-start ownership, stale history selection,
  closed/superseded guided verification, and stale sample loading.
- Extend reporting.test.ts using sampleStatus to cover valid metadata with
  missing progress, invalid status, non-finite/missing required numeric data,
  invalid resolver result/stats, and storage removal. Keep a valid-payload
  round-trip test.
- Retain existing polling tests: saved-run viewing must still disable polling
  and an active poll must still be aborted on cleanup.
- Plan 010 adds the browser-level rapid-double-start regression. Do not delay
  this plan unit tests waiting for that framework.
- Verification: <code>cd frontend && npm test -- runtime.test.ts reporting.test.ts && npm test</code> → all tests pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] DashboardControls disables Start while a start POST is in flight, and
  one rapid double activation sends at most one POST.
- [ ] Each asynchronous workflow has an independent current token and cleanup
  path; aborts never render as current-action errors.
- [ ] getSystemDns and probeResolvers accept optional AbortSignal values
  without breaking existing callers.
- [ ] reporting.ts contains no <code>as unknown as BenchmarkStatus</code>
  assertion, and invalid nested saved status data is removed from storage.
- [ ] <code>cd frontend && npm test -- runtime.test.ts reporting.test.ts</code>
  exits 0 with new regression cases.
- [ ] <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run build</code> exits 0.
- [ ] No files outside the in-scope list are modified; plans/README.md is
  unchanged.

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 003 changed the start payload/state contract so the excerpts no longer
  identify the current owner of a benchmark start.
- Making a start request cancellable requires a backend cancellation endpoint
  or changes a server-side job guarantee.
- The live API has callers outside App that cannot safely accept optional
  AbortSignal parameters.
- A realistic persisted BenchmarkStatus has a field shape not represented by
  types.ts and cannot be validated without a schema/migration decision.
- A verification, history, or sample action is now owned by a module outside
  App, so the proposed refs would duplicate a different owner.
- Focused verification fails twice after a reasonable implementation attempt,
  or the fix requires a file outside the in-scope list.

## Maintenance notes

- New async UI actions must define their supersession event, current-token
  check, AbortController owner, and unmount cleanup before they are added.
- Do not use type assertions as a persistence parser. Add a schema migration
  or explicit validator whenever saved-run fields evolve.
- Reviewers should test the difference between cancelling UI interest in a
  request and cancelling backend work; the frontend must never present the
  latter without a backend contract.
- Plan 015 may move lifecycle owners into hooks, but must preserve the
  single-start and stale-response invariants established here.
