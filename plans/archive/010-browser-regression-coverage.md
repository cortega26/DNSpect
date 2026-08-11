# Plan 010: Establish deterministic Chromium workflow regression coverage

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A reviewer dispatched this plan and maintains the
> index, so do not edit plans/README.md.
>
> **Drift check (run first)**: <code>git diff --stat e09fd2d..HEAD -- .github/workflows/ci.yml .gitignore frontend/package.json frontend/package-lock.json frontend/playwright.config.ts frontend/TESTING.md frontend/screenshot-test.mjs frontend/tests/e2e/fixtures.ts frontend/tests/e2e/workflows.spec.ts</code>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/007-frontend-workflow-ownership.md
- **Category**: tests, dx
- **Planned at**: commit <code>e09fd2d</code>, 2026-08-10

## Why this matters

The frontend has unit tests for pure helpers but no supported browser workflow
test command. A standalone screenshot script imports an undeclared Playwright
package, writes to a stale absolute path, uses fixed sleeps, and does not
reliably mock all current requests. That means start, polling, result,
history, and keyboard regressions can pass the existing quality gate.

This plan establishes one reproducible Chromium test target with deterministic
network fixtures and CI enforcement. It explicitly calls this a web-frontend
regression floor, not evidence that the native GTK/WebKit packaged shell or
Firefox/WebKit browser engines have been validated.

## Current state

- frontend/package.json — current scripts end at Vitest; no browser test
  script or declared Playwright dependency.
- frontend/package-lock.json — lockfile v3 used by npm ci and CI.
- frontend/vite.config.ts — Vite dev server uses port 5173.
- frontend/screenshot-test.mjs — ad-hoc Chromium screenshot script.
- frontend/src/App.tsx and frontend/src/lib/api.ts — current frontend API
  flows that test fixtures must intercept.
- .github/workflows/ci.yml — existing frontend CI runs lint, typecheck,
  build, and Vitest but no browser test.
- CLAUDE.md — documents a React/Vite frontend and a GTK/WebKit native GUI
  mode, so browser coverage must have an honest boundary.

The frontend scripts contain no end-to-end command:

    # frontend/package.json:9-35
    "lint": "eslint ."
    "typecheck": "tsc --noEmit"
    "build": "npm run typecheck && vite build"
    "test": "vitest run"
    ...
    devDependencies include vitest but not @playwright/test

The existing screenshot script has an undeclared import and a machine-specific
output directory:

    # frontend/screenshot-test.mjs:1-12
    import { chromium } from 'playwright'
    const BASE = 'http://localhost:5173'
    const OUT = '/home/carlos/VS_Code_Projects/DNS_app/frontend/screenshots'
    ...
    await page.waitForTimeout(1500)

It uses broad routes only for the collection endpoint while App requests
resource-specific benchmark URLs and optional egress lookups:

    # frontend/screenshot-test.mjs:129-144
    await page.route('**/api/benchmarks', ...)
    await page.locator('.btn-start').click()
    await page.waitForTimeout(2000)

    # frontend/src/lib/api.ts:47-55,102-106
    getPublicIp() fetches https://api.ipify.org?format=json
    getBenchmark(id, includeSamples, signal) fetches
      /api/benchmarks/<id>

CI currently stops after unit tests:

    # .github/workflows/ci.yml:54-83
    frontend job installs with npm ci
    runs npm run lint
    runs npm run typecheck
    runs npm run build
    runs npm test

The runtime boundary is important:

    # CLAUDE.md:64-77
    Frontend: React 18 + Vite + TypeScript
    cli.py: entry point for the PyInstaller-packaged binary
    (GTK/WebKit native GUI, browser, or headless mode)

Conventions to preserve:

- Node 24 is the declared frontend engine and the CI version.
- Browser tests must use mocked API/egress responses only; no DNS resolver,
  external IP, or GeoIP call may leave the test process.
- Plan 007 supplies the expected no-duplicate-start and stale-action behavior
  that these tests will exercise.
- Recharts remains lazy-loaded; a browser test must not make it a main-chunk
  dependency.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Add test runner | <code>cd frontend && npm install --save-dev @playwright/test</code> | Exit 0; package.json and package-lock.json contain the declared runner. |
| Install local browser | <code>cd frontend && npm exec playwright install chromium</code> | Exit 0; Playwright Chromium is available for the current user. |
| Browser suite | <code>cd frontend && npm run test:e2e -- --project=chromium</code> | Exit 0; all deterministic Chromium workflow tests pass. |
| Unit suite | <code>cd frontend && npm test</code> | Exit 0; all Vitest tests pass. |
| Quality/build | <code>cd frontend && npm run lint && npm run typecheck && npm run build</code> | Exit 0; lint, typecheck, and production build pass. |
| CI-equivalent install | <code>cd frontend && npm ci && npm run test:e2e -- --project=chromium</code> | Exit 0 after browser installation; lockfile is reproducible. |

## Suggested executor toolkit

- Use the Playwright skill if available to inspect the rendered application and
  validate selectors; keep all test code in the declared Playwright suite.
- Use CodeGraph, if available, to enumerate fetch call sites before defining
  the fixture dispatcher.

## Scope

**In scope** (the only files you should modify):

- .github/workflows/ci.yml
- .gitignore
- frontend/package.json
- frontend/package-lock.json
- frontend/playwright.config.ts (new)
- frontend/TESTING.md (new) — supported coverage matrix and local commands.
- frontend/screenshot-test.mjs — remove after its scenarios have named,
  executable replacements.
- frontend/tests/e2e/fixtures.ts (new)
- frontend/tests/e2e/workflows.spec.ts (new)

**Read-only inputs** (inspect, never modify):

- frontend/vite.config.ts — existing port/alias behavior.
- frontend/src/App.tsx and frontend/src/lib/api.ts — API call inventory and
  semantic UI selectors.
- CLAUDE.md — native GTK/WebKit versus browser-runtime boundary.
- packaging/flatpak/generated-sources.json and Flatpak configuration — package
  source regeneration belongs to the release/Flatpak workflow, not this plan.

**Out of scope** (do NOT touch, even though they look related):

- plans/README.md — the reviewer maintains the plan index.
- Application components, API client behavior, accessibility/i18n code, and
  result presentation. Tests must use semantic selectors; ask before widening
  scope solely to add test IDs.
- Native GTK/WebKit UI automation, Flatpak packaging, release workflows, or a
  claim that Chromium test success validates the packaged shell.
- Firefox and Playwright WebKit projects. They are not a current support
  promise; add them only after a product/CI owner approves an engine matrix.
- Regenerating Flatpak npm source JSON. Coordinate that package-lock consequence
  with the release/Flatpak owner in its dedicated workflow.

## Git workflow

- Branch: <code>advisor/010-browser-regression-coverage</code>
- Use conventional commits, for example
  <code>test(frontend): add deterministic Chromium workflow coverage</code>.
- Keep runner/bootstrap, fixtures/tests, CI enforcement, and obsolete-script
  removal in reviewable commits. Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Record the supported coverage boundary and add Playwright

Create frontend/TESTING.md with this exact coverage policy:

1. Required automated browser regression target: Playwright Chromium on Linux,
   using the Vite frontend and mocked API responses.
2. Required workflow coverage: cold initialization, one start POST, running
   state, terminal results, history selection, and the no-real-network rule.
3. Native GTK/WebKit packaged mode is not exercised by this suite; it remains
   a separate package/smoke responsibility.
4. Firefox and browser-WebKit are not claimed supported or tested until an
   owner approves their runtime/CI matrix.

Add @playwright/test as a dev dependency with npm, update the lockfile, and
add a test:e2e script that invokes playwright test. Add ignored directories
for frontend/test-results, frontend/playwright-report, and any configured
trace/artifact output. Do not add screenshot baselines to source control in
this plan.

**Verify**: <code>cd frontend && npm ls @playwright/test --depth=0 && npm run test:e2e -- --list</code> → one declared Playwright package is listed and test discovery exits 0 after later test files are added.

### Step 2: Configure one deterministic Chromium project

Create frontend/playwright.config.ts using the existing Vite port 5173 and a
webServer command that starts the frontend on 127.0.0.1. Configure one project
named chromium with a desktop Linux viewport and EN locale as the default.
Set finite test and assertion timeouts, retain traces/screenshots only on
failure, and run serially or with fixture isolation so polling mocks cannot
cross-contaminate tests.

Use the existing Vite server rather than a production backend. Do not use
networkidle or arbitrary waitForTimeout calls as readiness signals; tests must
wait for semantic UI state or named request completion. Run the browser install
command locally without system-package mutation; the CI job may use the
runner-supported install-with-dependencies form.

**Verify**: <code>cd frontend && npm exec playwright install chromium && npm run test:e2e -- --project=chromium --list</code> → browser installation and Chromium test discovery exit 0.

### Step 3: Build a complete mocked API fixture

Create frontend/tests/e2e/fixtures.ts. It must create minimal but type-valid
provider, system-DNS, queued/running/done benchmark, history, probe, GeoIP,
and saved-run responses. Route every request under the API base through one
method-and-path dispatcher, including:

- providers, system DNS, benchmark history, and probe;
- benchmark POST and resource-specific benchmark GET, including samples;
- the optional public-IP endpoint and the GeoIP request;
- an explicit failure for every unhandled network request.

Expose controlled deferred responses and per-route counters so tests can prove
one POST during a rapid double click and can resolve history responses out of
order. Seed localStorage and locale before navigation where a test requires
it. Use response bodies that satisfy the post-plan-003 BenchmarkStatus shape;
update the fixture intentionally if that contract changes.

**Verify**: <code>cd frontend && npm run test:e2e -- --project=chromium --grep "cold initialization"</code> → exit 0; the fixture boots the UI and reports no unhandled request.

### Step 4: Cover the supported workflow floor with semantic assertions

Create workflows.spec.ts using the shared fixture and semantic role/text
locators. Add these independent scenarios:

1. Cold initialization renders providers/system DNS and a usable Start control
   without an unhandled request or real network access.
2. A controlled pending start POST receives two rapid activations but increments
   the POST counter exactly once, then the response transitions to the mocked
   running state. This is the browser regression for plan 007.
3. Polling progresses from running to a type-valid done response and renders
   final ranking/results without an arbitrary sleep.
4. Two history selections resolved in reverse order leave the second/current
   run visible; the stale first response cannot overwrite it.
5. An aborted/superseded guided verification or sample request does not show a
   stale error/result if those controls are reachable in the fixture.

Make every test assert the fixture's no-unhandled-network collection is empty.
Do not test DNS latency, brand recommendations, a live external IP, or visual
pixels in this baseline.

**Verify**: <code>cd frontend && npm run test:e2e -- --project=chromium tests/e2e/workflows.spec.ts</code> → exit 0; all workflow tests pass with no external requests.

### Step 5: Replace the ad-hoc script and enforce the suite in CI

Delete frontend/screenshot-test.mjs only after steps 3 and 4 cover its useful
initial/running/done state intent with executable assertions. Do not preserve
its absolute output path or fixed sleeps. Update the existing frontend CI job
after npm ci and Vitest to install Chromium with dependencies and run
npm run test:e2e. Keep its Node 24 setup, npm cache, lint, typecheck, and
build steps intact.

Use a separate clearly named CI step so a failure identifies browser
regression coverage. Do not add the browser download to a release workflow or
change package permissions.

**Verify**: <code>test ! -e frontend/screenshot-test.mjs && git diff --check && cd frontend && npm run test:e2e -- --project=chromium</code> → obsolete script is absent, diff has no whitespace errors, and tests pass.

### Step 6: Run complete gates and hand off the package consequence

Run local unit/browser/build gates and inspect CI YAML syntax/indentation. Note
in the PR description that package-lock changed and the release/Flatpak owner
must regenerate its npm-source artifact in the appropriate release-preparation
work; do not modify generated Flatpak files here.

**Verify**: <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run test:e2e -- --project=chromium && npm run build</code> → all commands exit 0.

## Test plan

- New fixture test support intercepts all frontend HTTP and external-IP calls,
  asserts no unhandled network, and permits controlled out-of-order responses.
- New workflows.spec.ts covers initialized, start, running, done, history, and
  plan-007 stale/duplicate behavior using semantic assertions.
- CI installs the exact lockfile and Chromium, then runs the same test:e2e
  command used locally.
- Plan 009 will add its accessibility-i18n spec against this fixture rather
  than creating a second runner.
- Verification: <code>cd frontend && npm test && npm run test:e2e -- --project=chromium</code> → all unit and browser tests pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] frontend/TESTING.md explicitly limits the automated support floor to
  Chromium and distinguishes it from GTK/WebKit packaged validation.
- [ ] package.json declares @playwright/test and a test:e2e script; npm ci can
  reproduce the lockfile.
- [ ] Playwright has one chromium project, starts Vite deterministically, and
  stores failure artifacts only in ignored paths.
- [ ] Every browser test mocks all application and public-IP requests and
  fails on an unhandled request.
- [ ] Workflows cover cold initialization, exactly-one rapid start POST,
  running-to-done output, and out-of-order history selection.
- [ ] CI runs the Chromium suite after npm ci.
- [ ] <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run test:e2e -- --project=chromium && npm run build</code> exits 0.
- [ ] No files outside the in-scope list are modified; plans/README.md is
  unchanged.

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 007 has not landed or its behavior contract differs from the rapid-start
  and stale-response expectations in this plan.
- A semantic locator cannot identify the required UI behavior without changing
  an application component; request approval to widen scope rather than adding
  arbitrary test IDs.
- Playwright Chromium cannot install/run in the approved local or CI
  environment, or needs unapproved sandbox/system permission changes.
- The app makes a network request not represented in api.ts/App that cannot be
  safely mocked by the fixture.
- An owner asks this suite to certify the native GTK/WebKit shell, Firefox, or
  browser-WebKit. That requires a separate supported-runtime decision and
  tooling scope.
- A package-lock update must be released before its Flatpak generated-source
  workflow can be coordinated; do not hand-edit generated source JSON.

## Maintenance notes

- Add every new frontend fetch endpoint to fixtures.ts in the same pull
  request as the production call; the unhandled-network assertion is the
  enforcement mechanism.
- Keep user-path tests deterministic: controlled responses and semantic
  readiness, never sleeps or real DNS/GeoIP services.
- Chromium is a browser-regression target, not a claim about the packaged
  GTK/WebKit renderer. Maintain separate packaging smoke coverage for that
  runtime.
- New major user workflows should enter workflows.spec.ts before their UI is
  declared complete; plan 015 can use this suite as a behavior-preservation
  gate during App orchestration refactoring.
