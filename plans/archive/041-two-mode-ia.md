# Plan 041: Two-mode IA — Quick check and Lab workspace

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1c42b08..HEAD -- frontend/src/App.tsx frontend/src/components/*.tsx frontend/src/hooks/useBenchmarkSession.ts frontend/src/lib/i18n-translations.ts frontend/src/lib/types.ts frontend/tests/e2e/*.spec.ts frontend/tests/e2e/fixtures.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (Plan 040's merged changes to
> styles.css/index.html are expected context, not drift.)

## Status

- **Priority**: P1 (user-requested revamp — the intuitiveness half)
- **Effort**: L
- **Risk**: MED (App.tsx restructure; e2e copy assertions)
- **Depends on**: `plans/040-design-system-rollout.md` (the tokens/skins it rolls out; this plan builds the IA on top)
- **Category**: direction (build — Quick check / Lab two-mode IA per DESIGN_SYSTEM.md section 5)
- **Planned at**: commit `1c42b08`, 2026-08-12

## Why this matters

Two audiences use DNSpect with one interface: non-technical users need one
action and a plain-language verdict; savvy users need the full lab. Today
everyone gets the full single-scroll flow. This plan splits the app into
two modes — **Quick check** (default tab: one "Check my DNS" action, a
verdict card, Apply + Open in Lab) and **Lab** (the full surface with a
sub-nav: Benchmark / Results / History / Watch / Protocol Lab) — plus a
persistent header status strip. Both modes are presentation over the
existing hooks; determinism, manifests, and backend are untouched.

## Current state

- `frontend/src/App.tsx` — 1450 lines; single-flow orchestration: header
  (brand, theme, locale), hero, `DashboardControls`, benchmark session
  (via `useBenchmarkSession`), dashboard panels (ranking, charts,
  recommended resolver, history, watch, comparisons). The `GuidedApplyModal`
  is already wired. `status` from the session hook drives the panels.
- `frontend/src/components/DashboardControls.tsx` — the full control
  surface (goal/mode/protocol/region/resolvers/queries/timeouts).
- `frontend/src/hooks/useBenchmarkSession.ts` — `start(config)` with the
  request payload built in App (`handleStart`); `status`, `error`,
  `stopPolling` etc. A Quick run is just `start()` with defaults (mode
  quick, goal speed, default resolvers).
- `frontend/src/lib/api.ts` — `getSystemDns()` exists (the Quick target).
- `frontend/src/components/RecommendedResolverPanel.tsx` + `applyGuide.ts`
  — the recommendation and the GuidedApplyModal flow the verdict card
  reuses.
- Header currently: `App.tsx` top region (brand, `DashboardControls`-adjacent
  theme/locale controls at ~200-260).
- i18n: ES source of truth; `i18n.copy.test.ts` gates parity.
- e2e: `workflows.spec.ts` expects the start control on the default view
  (e.g. "cold initialization renders providers and a usable start
  control"); `accessibility-i18n.spec.ts` asserts copy like 'History' and
  the region chip. **These specs will need mode-aware updates** (precise
  locators per plan 028's discipline — update the specs, don't weaken
  assertions).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 1c42b08..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| e2e | `cd frontend && npx playwright test --reporter=line` (port-shifted if :5173 is occupied) | all pass (26 + new mode scenarios) |
| i18n copy | `cd frontend && npx vitest run src/lib/i18n.copy.test.ts` | pass |

## Scope

**In scope**:
- `frontend/src/App.tsx` — mode state (`useMode` or plain state), header
  ModeSwitcher, view switching, the status strip, Quick-mode wiring
- `frontend/src/components/ModeSwitcher.tsx` (new) — the two-tab segmented
  control (`role=tablist`, keyboard per the existing a11y patterns)
- `frontend/src/components/QuickCheckPanel.tsx` (new) — the Quick flow:
  intro, "Check my DNS" button, measuring line, verdict card, Apply
  (GuidedApplyModal) + "Open in Lab"
- `frontend/src/components/LabWorkspace.tsx` (new) — the existing panels
  under a sub-nav (Benchmark / Results / History / Watch / Protocol Lab);
  the sub-nav may reuse the existing panel components as-is
- `frontend/src/lib/i18n-translations.ts` — new keys: `mode.quick`,
  `mode.lab`, `quick.intro`, `quick.check`, `quick.measuring`,
  `quick.verdict.*` (good/switch titles), `quick.reason.*` (3 bullet
  templates), `quick.numbers.*` (median/p95/failure/score), `quick.apply`,
  `quick.openLab`, `lab.*` (5 sub-nav labels), `status.*` (idle/measuring/
  complete/failed + progress) — ES source + EN/PT mirrors, same commit
- `frontend/src/lib/types.ts` — `AppMode` type if needed
- `frontend/tests/e2e/workflows.spec.ts` + `accessibility-i18n.spec.ts` +
  `fixtures.ts` — mode-aware updates (see Test plan)
- New unit tests: `ModeSwitcher.test.tsx`, `QuickCheckPanel.test.tsx` (or
  fold into App-level tests where the panels are thin)

**Out of scope** (do NOT touch, even though they look related):
- The charts re-skin (plan 042)
- Backend of any kind (Quick mode reuses `start()` + defaults)
- `DashboardControls.tsx` internals — Lab shows it as-is (only re-homed)
- Watch/comparison/history behavior — only their placement in the sub-nav
- The theme system (040)

## Git workflow

- Branch: `plan/041-two-mode-ia`
- Commits: `feat(ui): mode switcher with quick check and lab workspace`, `feat(i18n): mode and quick-check copy in all three languages`, `test(e2e): mode-aware regression scenarios`. Merge commit: `merge: plan 041 — two-mode IA`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Mode state and switcher

1. `frontend/src/App.tsx` — add `const [mode, setMode] = useState<AppMode>('quick')` (default **quick** per the spec; persist in sessionStorage so a reload keeps the choice — plain `sessionStorage` read in the initializer, no new deps). Render the header `ModeSwitcher` next to the theme/locale controls.
2. `frontend/src/components/ModeSwitcher.tsx` — the two-tab control per the spike: `role=tablist`/`tab`, arrow-key navigation, `aria-selected`, focus ring via the 040 tokens; labels `mode.quick`/`mode.lab`.
3. The header gains the persistent **status strip** (spike pattern): status label (idle/measuring/complete/failed from the session hook), progress bar, ETA — visible in BOTH modes (it is the persistent context).

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0.

### Step 2: Quick check flow

`frontend/src/components/QuickCheckPanel.tsx` (props: the session hook's
`start`, `status`, `error`, plus `onOpenLab`):
1. Idle: intro copy + the single primary "Check my DNS" button (chamfered
   per 040). Disabled while a run is active.
2. Running: the measuring line (spike pattern, live dot + progress).
3. Done: the **verdict card** — verdict title (from the recommendation:
   if the recommended resolver == current system DNS → "good" copy; else
   "switch to X" with the latency delta), three plain-language reasons
   (faster median / fewer failures / better stability, each with its mono
   number), the numbers row (median/p95/failure rate/score from the done
   state's recommended result), Apply (opens the existing
   `GuidedApplyModal` via the current `useGuidedVerification` wiring) +
   "Open in Lab".
4. Failed: the instrument error state + retry.
5. `start()` payload: `mode: 'quick'`, `goal: 'speed'`, resolvers = the
   detected system DNS (via `getSystemDns`) — no other controls visible.
   (Reuse the existing `handleStart`-style builder; the Quick path just
   fixes the inputs.)

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0; a
manual smoke via the dev server: Quick check runs, verdict renders, Apply
opens the modal.

### Step 3: Lab workspace sub-nav

`frontend/src/components/LabWorkspace.tsx` — the existing panels
(DashboardControls, ranking, charts, recommended, history, watch,
comparisons) re-homed under a sub-nav with five sections:
**Benchmark** (controls + start), **Results** (ranking + charts +
recommended), **History** (runs + compare), **Watch**, **Protocol Lab**.
Section switching is local state (plain `useState` + the sub-nav tabs per
the spike); panels mount only when their section is active (avoids the
watch/history polling stack firing when unused — verify the hooks'
unmount cleanup, which plan 027 tests pin). The existing App orchestration
(state, session, history, watch, comparison hooks) stays in App and is
passed down as props — no hook logic moves.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0;
`npx vitest run src/hooks` → all pass (hook wiring untouched).

### Step 4: i18n

Add the key groups from Scope to ES (source), EN, PT in one commit;
the copy test gates parity. Verdict strings are templates — check the
existing `t()` interpolation conventions (e.g. `{{pct}}`) and follow them.

**Verify**: `cd frontend && npx vitest run src/lib/i18n.copy.test.ts` → pass.

### Step 5: e2e — mode-aware updates

Update the e2e specs with precise locators (plan 028 discipline — roles,
not bare text):
1. `workflows.spec.ts` — the flow specs that reach the start control must
   first switch to Lab: seed the ModeSwitcher interaction (click the Lab
   tab by role) or, for the cold-init spec, assert the Quick view renders
   its button, then switch. Keep every existing assertion's strength.
2. `accessibility-i18n.spec.ts` — the 'History' heading assertion and the
   region-chip assertions live in Lab: the spec must switch modes first
   (the chips are Lab-only). The Quick tab has no region machinery —
   that's the point.
3. Add one new scenario: Quick check end-to-end — cold init → Quick
   verdict renders with a mocked done run (fixture) → Apply opens the
   guided modal → Open in Lab lands in the Lab view.
4. `fixtures.ts` — the mode doesn't change mocked endpoints; check whether
   a `GET /api/dns/system` mock is already registered (it is — used by
   the providers flow). No fixture change expected beyond what the new
   scenario needs.

**Verify**: `cd frontend && npx playwright test --reporter=line` (port-shifted) → all pass (26 existing + 1 new, minus none).

### Step 6: Component tests

`ModeSwitcher.test.tsx` + `QuickCheckPanel.test.tsx` (model on
`WatchPanel.test.tsx` — jsdom pragma, mocked hooks/i18n wrapper):
1. ModeSwitcher: renders two tabs, aria-selected follows clicks, arrow-key
   navigation, callback fires.
2. QuickCheckPanel: idle renders the single button; running renders the
   measuring line; done renders the verdict with the numbers row and both
   actions; failed renders the error + retry; the Apply callback fires.

**Verify**: `cd frontend && npx vitest run src/components/ModeSwitcher.test.tsx src/components/QuickCheckPanel.test.tsx` → all pass.

### Step 7: Final gates

**Verify**: full frontend gate + e2e green; `git status` shows only in-scope files; screenshots of both modes captured into `docs/screenshots/` (e.g. `instrument-quick-verdict.png`, `instrument-lab-benchmark.png`).

## Test plan

- New: `ModeSwitcher.test.tsx`, `QuickCheckPanel.test.tsx` (Step 6).
- Updated: the two e2e specs (Step 5) — mode-aware, same assertion strength.
- Existing: all vitest suites + e2e stay green; `i18n.copy.test.ts` gates
  the new keys.

## Done criteria

ALL must hold:

- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `cd frontend && npx playwright test --reporter=line` — all pass (26 + new scenario)
- [ ] `cd frontend && npx vitest run src/components/ModeSwitcher.test.tsx src/components/QuickCheckPanel.test.tsx src/lib/i18n.copy.test.ts` — all pass
- [ ] Default mode is Quick check; the ModeSwitcher is keyboard-operable (`role=tablist`)
- [ ] `grep -rn "mode.quick\|mode.lab" frontend/src/lib/i18n-translations.ts` matches ≥ 3 (ES/EN/PT)
- [ ] Quick mode's `start()` payload uses `mode:'quick'`, `goal:'speed'`, system-DNS resolvers (no control surface)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 041 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- An e2e assertion cannot be preserved at equal strength after the mode
  split (report the conflict instead of weakening it).
- Moving panels under the sub-nav breaks a hook's unmount/abort behavior
  that plan 027's tests pin (fix the wiring, not the tests; if the hooks
  themselves need changes, STOP and report).
- The Quick verdict needs a backend capability that doesn't exist (it
  must not — `start()` + the done state's recommendation suffice).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The mode is presentation-only: `sessionStorage` persistence means a
  reload keeps the choice; a future "remember my mode" setting can extend
  it trivially.
- The sub-nav mount-on-demand pattern keeps the watch/history polling
  hooks dormant until their section opens — the hook suites pin the
  cleanup; watch for regressions there in review.
- Plan 042 (charts) and plan 043 (polish: sortable tables, empty-state
  passes) build on this IA.
- The verdict-copy templates are the contract for the plain-language tone;
  keep them free of jargon in all three languages.
