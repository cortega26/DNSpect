# Plan 015: Split App lifecycle orchestration into behavior-preserving hooks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A reviewer dispatched this plan and maintains the
> index, so do not edit plans/README.md.
>
> **Drift check (run first)**: <code>git diff --stat e09fd2d..HEAD -- frontend/src/App.tsx frontend/src/hooks/useBenchmarkSession.ts frontend/src/hooks/useRunHistory.ts frontend/src/hooks/useGuidedVerification.ts frontend/tests/e2e/workflows.spec.ts</code>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/005-run-history-integrity.md, plans/007-frontend-workflow-ownership.md, plans/010-browser-regression-coverage.md
- **Category**: tech-debt, tests
- **Planned at**: commit <code>e09fd2d</code>, 2026-08-10

## Why this matters

App.tsx is a 1,643-line component with 37 useState calls plus initialization,
polling, start, history, sample, guided-verification, persistence, keyboard,
and presentation concerns. The current polling code is careful, but its
resource ownership is hard to change safely because it sits beside unrelated
rendering and UI state. Plans 005 and 007 add important history and
latest-request invariants, which will become progressively harder to preserve
in one component.

This plan moves only independently testable remote lifecycle domains into
named hooks after browser regression coverage exists. It is a behavior
preservation refactor, not a redesign: user selection, target/profile
semantics, rendering tree, chart code splitting, and recommendation layout
remain in App or their existing components.

## Current state

- frontend/src/App.tsx — main component, current state/polling/orchestration
  owner and rendering tree.
- frontend/src/lib/runtime.ts — pure polling/current-request predicates that
  plans 005 and 007 use; read-only in this refactor.
- frontend/src/lib/api.ts — API boundary already updated by prerequisite plans;
  read-only in this refactor.
- frontend/tests/e2e/workflows.spec.ts — deterministic behavior gate created
  by plan 010; extend it before moving code.
- frontend/src/main.tsx — mounts App in React.StrictMode; read-only but
  requires idempotent effects.
- plans/005-run-history-integrity.md — prerequisite history-refresh owner.
- plans/007-frontend-workflow-ownership.md — prerequisite single-start,
  abort, stale-result, and persisted-run contract.

App begins by owning configuration, remote state, and presentation state
together:

    # frontend/src/App.tsx:187-241
    const [providers, setProviders] = useState(...)
    const [selectedResolvers, setSelectedResolvers] = useState(...)
    const [benchmarkId, setBenchmarkId] = useState(...)
    const [status, setStatus] = useState(...)
    const [selectedResult, setSelectedResult] = useState(...)
    const [guidedApplyOpen, setGuidedApplyOpen] = useState(...)
    const [history, setHistory] = useState(...)
    const pollTimerRef = useRef(...)
    const pollAbortRef = useRef(...)
    const pollSessionIdRef = useRef(...)
    const startRequestSeqRef = useRef(...)

The benchmark lifecycle has a single component-local polling owner:

    # frontend/src/App.tsx:250-406
    const stopPolling = useCallback(() => {
      pollSessionIdRef.current += 1
      clear timeout
      pollAbortRef.current.abort()
      pollInFlightRef.current = false
    }, [])
    ...
    const next = await getBenchmark(id, false, controller.signal)
    if (!isCurrentSession()) return
    setStatus(next)
    ...
    return () => stopPolling()

The same component also owns initialization/history and substantial derived
presentation work:

    # frontend/src/App.tsx:276-329,408-431,437-498
    Promise.allSettled([getProviders(), getSystemDns()])
    ...
    getBenchmarkHistory()
    ...
    const providerById = useMemo(...)
    const filteredResults = useMemo(...)

Start, guided verification, saved-run viewing, and sample loading are all
implemented as local handlers:

    # frontend/src/App.tsx:737-970
    async function handleStart() { ... startBenchmark(payload) ... }
    async function handleGuidedVerify() { ... getSystemDns(); probeResolvers() ... }
    function handleViewSavedRun() { ... }
    async function handleLoadSamples() { ... getBenchmark(..., true) ... }

The rendering tree deliberately keeps expensive charts lazy:

    # frontend/src/App.tsx:1-13
    const ChartsPanel = lazy(() =>
      import('@/components/ChartsPanel').then((m) => ({ default: m.ChartsPanel })))
    const ResolverDetailModal = lazy(...)

App runs under Strict Mode:

    # frontend/src/main.tsx:9-17
    ReactDOM.createRoot(...).render(
      <React.StrictMode>
        ...
        <App />
      </React.StrictMode>)

There are two recommendation panels rendered from the same result at
App.tsx:1386-1424. That may be an intentional product layout, so it is not a
refactor target without a UX decision.

Conventions to preserve:

- Plans 005 and 007 are the authority for history refresh, one start POST,
  abort semantics, stale action rejection, and saved-run validation. Reuse
  their landed helpers and tests; do not recreate a weaker parallel protocol.
- Plan 010 is the browser behavior gate. It must pass before and after each
  extraction without real network traffic or arbitrary waits.
- React StrictMode can mount/clean up effects more than once in development.
  Each extracted hook must be idempotent and clean timers/controllers on
  cleanup.
- App remains the composition/presentation owner. Do not move Recharts imports
  or mutate provider/target selection policy in a lifecycle refactor.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prerequisite plans | <code>test -f plans/005-run-history-integrity.md && test -f plans/007-frontend-workflow-ownership.md && test -f frontend/tests/e2e/workflows.spec.ts</code> | All prerequisite plan artifacts and browser suite exist. |
| Focused lifecycle units | <code>cd frontend && npm test -- runtime.test.ts reporting.test.ts</code> | Exit 0; plan-005/007 lifecycle and persisted-run tests pass. |
| Browser behavior gate | <code>cd frontend && npm run test:e2e -- --project=chromium tests/e2e/workflows.spec.ts</code> | Exit 0; mocked workflow regression tests pass. |
| Typecheck | <code>cd frontend && npm run typecheck</code> | Exit 0 with no TypeScript errors. |
| Full frontend tests | <code>cd frontend && npm test</code> | Exit 0; all Vitest tests pass. |
| Lint/build | <code>cd frontend && npm run lint && npm run build</code> | Exit 0; lint and production build pass. |

## Suggested executor toolkit

- Use CodeGraph, if available, to trace App callbacks into API calls before and
  after each hook extraction. In particular inspect startBenchmark,
  getBenchmark, getBenchmarkHistory, getSystemDns, and probeResolvers.
- Use Playwright only through the plan-010 test command/fixtures. Do not
  exercise live DNS, public-IP, or GeoIP services while refactoring.

## Scope

**In scope** (the only files you should modify):

- frontend/src/App.tsx
- frontend/src/hooks/useBenchmarkSession.ts (new)
- frontend/src/hooks/useRunHistory.ts (new)
- frontend/src/hooks/useGuidedVerification.ts (new)
- frontend/tests/e2e/workflows.spec.ts

**Read-only dependency inputs** (inspect, never modify):

- frontend/src/main.tsx — StrictMode boundary.
- frontend/src/lib/api.ts, frontend/src/lib/runtime.ts, and
  frontend/src/lib/reporting.ts — existing API/lifecycle/persistence contracts.
- frontend/src/components/ChartsPanel.tsx and ResolverDetailModal.tsx —
  lazy-loaded presentation boundaries.
- plans/005-run-history-integrity.md, plans/007-frontend-workflow-ownership.md,
  and plans/010-browser-regression-coverage.md — established behavior and
  test fixtures.

**Out of scope** (do NOT touch, even though they look related):

- plans/README.md — the reviewer maintains the plan index.
- Provider/system-DNS initialization and region/target-profile selection.
  Those remain in App because plan 004 owns their contract and this refactor
  must not reopen it.
- API client signatures, runtime helpers, persistence schema, backend
  lifecycle, scoring, or history semantics. Prerequisite plans own them.
- DashboardPanel/RecommendedResolverPanel consolidation, chart/rank behavior,
  copy/i18n, CSS/layout, and modal focus behavior. The duplicate recommendation
  panels need a separate product decision.
- Adding a React component-test library, changing Playwright configuration, or
  making browser test IDs. Use existing unit/e2e infrastructure.

## Git workflow

- Branch: <code>advisor/015-frontend-orchestration-refactor</code>
- Use conventional commits, for example
  <code>refactor(frontend): extract benchmark lifecycle ownership from App</code>.
- Commit baseline test strengthening, each hook extraction, and final App
  cleanup separately. Do NOT push or open a PR unless the operator asks.

## Steps

### Step 1: Freeze observable behavior before extracting code

Read the landed implementation of plans 005 and 007, not merely their plan
files. Extend workflows.spec.ts with assertions that make the following
invariants observable through the plan-010 deterministic fixture:

- one rapid double activation produces exactly one start POST;
- only one current run can poll and a terminal response stops further polling;
- selecting a saved/history run does not resume live polling;
- reverse-order history/sample/verification responses cannot replace the
  current UI state;
- component teardown leaves no unhandled request or stale UI write.

Run this suite against the pre-refactor App and keep it green after every
following step. Do not change fixture/network behavior in this plan; use the
existing controlled responses.

**Verify**: <code>cd frontend && npm test -- runtime.test.ts reporting.test.ts && npm run test:e2e -- --project=chromium tests/e2e/workflows.spec.ts</code> → all current invariants pass before code is moved.

### Step 2: Extract the live benchmark session as one resource owner

Create frontend/src/hooks/useBenchmarkSession.ts and move the live benchmark
lifecycle from App into it as one coherent unit:

- benchmark ID, live status, saved-view flag, starting state, selected result,
  and sample-loading state;
- start request ownership from plan 007;
- stop/start polling timer, controller, session ID, in-flight guard, and
  unmount cleanup;
- historical-run loading and saved-run viewing that must disable polling;
- sample loading with the plan-007 captured benchmark/resolver identity and
  abort/current-token guard.

The hook must accept explicit input payloads/callbacks rather than reading
selection, i18n, or presentation state through globals. It may report a
current actionable error through a supplied App callback or a clearly returned
error value, but it must preserve the existing localized error behavior.
App continues to build the plan-003/004 benchmark payload and clears its
presentation-only copy/modal state before calling the hook start action.

There must be exactly one owner of poll timers and poll AbortControllers after
the move. The hook cleanup must be StrictMode-safe and must not start a
benchmark merely because it mounted.

**Verify**: <code>cd frontend && npm run typecheck && npm run test:e2e -- --project=chromium tests/e2e/workflows.spec.ts</code> → exit 0; start, polling, saved-view, and sample flows retain their behavior.

### Step 3: Extract history fetching without changing plan-005 semantics

Create frontend/src/hooks/useRunHistory.ts around the landed plan-005 refresh
contract. It owns history rows, loading state, refresh request sequence,
AbortController, initial load, and exactly-once terminal refresh key. It
receives the session's benchmark identity/status as typed inputs and returns
history plus a refresh function to App.

Run-history selection itself remains a call into useBenchmarkSession because
it changes the active benchmark/poll ownership. App connects RunHistoryPanel
to that session method. Do not reintroduce the old status-ID-only history
effect or a second history fetch effect in App.

**Verify**: <code>cd frontend && npm test -- runtime.test.ts && npm run test:e2e -- --project=chromium tests/e2e/workflows.spec.ts</code> → exit 0; terminal refresh and reverse-order history selection behavior remain covered.

### Step 4: Extract guided verification as an abortable action owner

Create frontend/src/hooks/useGuidedVerification.ts. It owns verification
result, verifying flag, verification error, request token, AbortController,
and cleanup. Its action accepts the current recommended resolver and system
DNS snapshot, uses the plan-007 signal-enabled API functions, and reports a
fresh system-DNS value through an explicit callback if the request is still
current.

App retains only modal open/close and copy display state. On close, start,
primary-result change, or unmount it invokes the hook cancel/reset action so
late probe responses cannot alter a closed/replaced modal. Preserve the
existing inconclusive outcome and localized real-error behavior; abort is
silent.

**Verify**: <code>cd frontend && npm run typecheck && npm run test:e2e -- --project=chromium tests/e2e/workflows.spec.ts</code> → exit 0; superseded guided verification cannot publish stale output.

### Step 5: Simplify App into composition and preserve lazy boundaries

Remove moved refs, effects, API imports, and handlers from App. It should
compose the three hooks with remaining local configuration, initialization,
region/target selection, locale/theme, copy/menu/modal, and derived rendering
state. Keep current component props and markup behavior stable wherever
possible; this is not permission to merge the two recommendation panels.

Keep ChartsPanel and ResolverDetailModal lazy declarations at the App module
boundary. Verify App no longer contains the former polling/start symbols or
direct benchmark/probe API calls. Review effect dependency arrays for stable
hook callbacks and ensure StrictMode cleanup cannot double-poll.

**Verify**: <code>cd frontend && rg -n "pollTimerRef|pollAbortRef|startPolling|startBenchmark|getBenchmark|probeResolvers" src/App.tsx</code> → no matches; then <code>npm run lint && npm run typecheck</code> exits 0.

### Step 6: Run complete behavior and quality gates

Run the focused units, complete browser suite, full Vitest suite, lint,
typecheck, and build. Inspect the production build output and source to verify
the lazy chart import remains. Inspect the diff for changes to target/profile
construction, API signatures, provider initialization, recommendation
components, or plan files outside this scope; revert/split any such change.

**Verify**: <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run test:e2e -- --project=chromium && npm run build && rg -n "const ChartsPanel = lazy" src/App.tsx</code> → all commands exit 0 and the lazy import is found.

## Test plan

- Extend existing workflows.spec.ts before extraction to make plan-005/007
  session, polling, history, guided-verification, and teardown invariants
  observable with its deterministic fixture.
- Retain runtime.test.ts and reporting.test.ts from prerequisite plans as
  focused unit guards for pure lifecycle/persistence contracts.
- After every hook extraction run the focused Chromium file, not only a final
  full suite, so the behavioral regression is localized to one step.
- Do not add a component-test dependency merely for this refactor; the
  existing pure units plus browser integration are the intended coverage mix.
- Verification: <code>cd frontend && npm test -- runtime.test.ts reporting.test.ts && npm run test:e2e -- --project=chromium tests/e2e/workflows.spec.ts && npm test</code> → all tests pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] useBenchmarkSession is the sole owner of benchmark start/poll timers,
  poll AbortController, session IDs, and sample-fetch ownership.
- [ ] useRunHistory is the sole owner of initial/terminal history refresh
  lifecycle; selecting a run still routes through session ownership.
- [ ] useGuidedVerification is the sole owner of verification token,
  AbortController, result/error/loading state, and cancel/reset cleanup.
- [ ] App contains no old polling/start/direct benchmark or probe API symbols,
  as checked in Step 5.
- [ ] React.StrictMode behavior does not produce duplicate start/poll work in
  the Chromium suite.
- [ ] <code>cd frontend && npm test -- runtime.test.ts reporting.test.ts</code> and <code>npm run test:e2e -- --project=chromium</code> exit 0.
- [ ] <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run build</code> exits 0.
- [ ] <code>rg -n "const ChartsPanel = lazy" frontend/src/App.tsx</code> finds the lazy chart boundary.
- [ ] No files outside the in-scope list are modified; plans/README.md is
  unchanged.

## STOP conditions

Stop and report back (do not improvise) if:

- Plans 005, 007, or 010 have not landed, their contracts differ materially
  from this plan, or their browser fixture cannot prove current behavior.
- A hook boundary requires changing API client signatures, persistence schema,
  target/profile selection semantics, or backend behavior.
- More than one timer/controller owner is required to preserve behavior, or a
  StrictMode mount creates duplicate start/poll activity after extraction.
- A required semantic browser locator would need an application markup/test-ID
  change outside scope.
- The existing tests reveal an intentional product difference between the two
  recommendation panels; do not collapse/change them as a refactor shortcut.
- Focused verification fails twice after a reasonable implementation attempt,
  or the refactor requires a file outside the in-scope list.

## Maintenance notes

- New remote workflows belong in a named hook with explicit input/output,
  current-request ownership, cancellation owner, cleanup rule, and a
  deterministic fixture scenario before App imports it.
- Keep App as the composition boundary for target/profile configuration and
  lazy presentation imports; a hook must not quietly alter measurement inputs.
- Reviewers should trace a start through completion, saved/history viewing,
  guided verification, and unmount in the Chromium suite before approving
  future lifecycle changes.
- The duplicate recommendation panels and initialization/region extraction are
  intentionally deferred because they need product/policy decisions rather
  than mechanical orchestration cleanup.
