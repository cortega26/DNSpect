# Plan 039: Frontend revamp — design spike ("The Instrument" + two-mode UX)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 02ed0e9..HEAD -- frontend/src/styles.css frontend/src/App.tsx frontend/index.html frontend/src/lib/types.ts frontend/src/components/*.tsx frontend/src/lib/i18n-translations.ts frontend/src/lib/theme-context.ts frontend/src/lib/theme.tsx frontend/tests/e2e/*.spec.ts docs/DESIGN_SYSTEM.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (product direction — user-requested revamp, direction approved)
- **Effort**: L (design spike: design doc + prototype; no production code merged)
- **Risk**: LOW (spike; build plans 040+ carry the real risk)
- **Depends on**: none
- **Category**: direction (frontend revamp: "The Instrument" + Quick/Lab two-mode UX)
- **Planned at**: commit `02ed0e9`, 2026-08-12
- **Decisions**: the design direction, palette, typography, IA, and the five
  gates were presented to the operator as a full recommendation and
  **approved** ("I like it, go ahead"). The executor treats the spec below
  as binding; only implementation-level surprises are reportable.

## Why this matters

The current UI is the generic generated-dashboard template (Inter +
JetBrains Mono via Google Fonts, teal-on-gray, tailwind radii, 29
chip/segmented elements). The product is "a precision DNS performance
laboratory"; the revamp gives it a visual language that reads as an
instrument: calm, exact, technical, trustworthy. Two audiences get two
modes (Quick check for non-technical, Lab for savvy) without touching the
backend, determinism, or the manifest contract.

## The approved design spec (binding)

### Concept
"The Instrument" — the front panel of precision lab equipment. Dark
chassis, hairline bezels, tick-marks, mono-forward numeric data, one
orchestrated motion moment. Restraint: one accent at a time, no decoration
that isn't functional. NOT a CRT/terminal cliché (no green-on-black,
no scanlines), NOT glassmorphism, NOT a marketing dashboard.

### Typography
- Display/headings: **Bricolage Grotesque** (OFL), tight tracking — brand,
  verdict, section titles only.
- UI/body/data: **Martian Mono** (OFL) — mono-forward instrument voice:
  labels, buttons, body text, and EVERY numeric value in tabular figures
  (latency ms, percentages, scores, timestamps).
- **Self-hosted woff2** under `frontend/public/fonts/` (spike: under
  `spikes/design-prototype/fonts/`), `font-display: swap`. CSP drops
  `fonts.googleapis.com`/`fonts.gstatic.com` from the allowlist
  (index.html:29). Fallbacks: monospace stack; body fallback to
  `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Verify current OFL releases + variable woff2 availability; if a font is
  unavailable, swap from the shortlist (display: "Instrument Sans" then
  "Spline Sans Mono"-class alternatives; data: "Fragment Mono") and record
  the change — do not silently substitute.

### Color (dark-first)
| Token | Value | Use |
|---|---|---|
| `--chassis` | `#0B0E13` | page background (near-black, slight cool cast) |
| `--panel` | `#12161D` | cards, panels |
| `--panel-raised` | `#171C25` | hover/active surfaces, modals |
| `--hairline` | `#232A36` | 1px borders, dividers, grid lines |
| `--ink` | `#E6EAF1` | primary text |
| `--ink-muted` | `#98A2B3` | secondary text |
| `--accent-live` | `#E8A33D` | amber — live/attention (running, alerts) |
| `--accent-active` | `#5FC9D6` | cyan — active/info (selection, links, progress) |
| `--ok` | `#5BB98C` | success, healthy readouts |
| `--bad` | `#E06C5F` | destructive, failure (muted red, not neon) |
| `--focus` | `#5FC9D6` | keyboard focus rings (contrast-checked) |

Light theme: secondary, re-tokened (paper `#F5F6F8`, ink `#1A212B`,
hairline `#D9DEE6`, same accent semantics) — implemented in the build
phase as a `[data-theme='light']` block; dark remains the default. All
token pairs contrast-checked (WCAG AA; the a11y contract gates).

### Shape and elevation
- Radii: `2px` (micro, data chips), `4px` (default controls/panels), `8px`
  (largest surfaces only). Tables and readouts are square-cornered.
- The ONE distinctive detail: the primary CTA gets a **chamfered corner**
  (clipped corner via CSS `clip-path`) — a single instrument-flavored
  signature, used nowhere else.
- Elevation = hairlines and flat panels, NOT floating shadows. No
  `box-shadow`-as-primary-depth.

### Motion
- Transitions 120–200ms; states fade/translate 2–4px max.
- The one orchestrated moment: run-complete verdict reveal — staggered
  fade+rise of the verdict card elements, values settle with a brief
  pulse on the key number. `prefers-reduced-motion` → instant (existing
  `motion.ts` machinery reused).

### Two-mode IA
- **Header**: brand mark (reworked in instrument style), **ModeSwitcher**
  (two-tab segmented control: Quick check / Lab — keyboard-operable,
  `role=tablist` per the existing a11y patterns), theme toggle, locale.
- **Quick check** (default tab): one primary action — "Check my DNS".
  Flow: single status line (Measuring…) → **verdict card**:
  1. Big verdict in Bricolage ("Your DNS is good — keep it" / "Switch to
     Cloudflare — ~34% faster median here");
  2. Three plain-language reasons in bullet form (faster median, fewer
     failures, better stability — each backed by a number in mono);
  3. The numbers row (mono, tabular): median / p95 / failure rate / score;
  4. Primary action: Apply (opens the existing GuidedApplyModal) +
     secondary "Open in Lab".
  Progressive disclosure: everything else behind "Open in Lab". No
  protocol/region/goal machinery visible.
- **Lab** (savvy tab): the full surface reorganized with a sub-nav:
  **Benchmark** (controls), **Results** (ranking + charts), **History**
  (runs + comparison), **Watch** (monitoring), **Protocol Lab**
  (comparisons). Persistent context: the current run's status is always
  visible in the header strip (Idle/Measuring/Complete/Failed + progress
  + ETA).
- Both modes are presentation over the existing hooks; determinism,
  manifests, and guardrails untouched. No backend work expected.

### Component skins (prototype coverage)
- Buttons: primary (chamfered, amber-on-dark for the one CTA; semantic
  `--ok`/`--bad` variants), lab/ghost (hairline, mono labels, uppercase
  small-caps optional). 
- Chips/segmented: square 2px, hairline, active = `--accent-active` fill
  with dark text.
- Ranking rows: resolver identity (name + provider in UI type), numbers
  in mono with aligned decimals, rank badge (square, not pill),
  protocol badge, reliability/blocking readouts.
- Tables: tick-row headers (hairline + tick mark), mono numeric cells
  right-aligned with tabular figures.
- Empty states: instrument-flavored (e.g. "No runs yet — start one in the
  Lab"), not generic illustration.
- Modals: `--panel-raised`, square corners, focus-trap contract intact.
- Charts (note for build plan 042): Recharts re-skinned via tokens —
  mono ticks, hairline grids, series from the token palette, tooltip as
  instrument readout. Not replaced (bundle constraint).

### Anti-slop rules (enforced in build plans' done criteria)
No Inter/Roboto/Arial/system-ui for UI; no purple gradients; no
8/12/16/pill-only radii; no floating-shadow depth; no generic empty
states; no centered-max-width-only layouts; no scanlines/CRT gimmicks.

## Current state (the slop inventory)

- `frontend/index.html:13-15` — Google Fonts: Inter + JetBrains Mono.
- `frontend/src/styles.css` — 2707 lines; `--font-ui: 'Inter'`,
  `--font-heading: var(--font-ui)` (16-18); light-by-default
  `--bg:#f4f7fb`, teal `--accent:#0D9488` (20-34); radii 8/12/16/pill
  (11-14); card grid with shadow tokens; `[data-theme='dark']` block (81-82).
- Components: 15 components + App.tsx (1450 lines); one long single-screen
  flow; DashboardControls has 29 chip/segmented elements.
- `design-system/dnspect/MASTER.md` — a generated token doc (2026-05-08)
  enshrining the generic aesthetic; superseded by `docs/DESIGN_SYSTEM.md`.
- Test-gated contracts: `accessibility-i18n.spec.ts` (copy assertions,
  locale switching), `i18n.copy.test.ts`, hook/component suites, e2e 26
  specs, WCAG 2.2 (focus traps, skip link, keyboard).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 02ed0e9..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Spike sanity | `cd frontend && npx vitest run src/lib/utils.test.ts src/hooks/useBenchmarkSession.test.ts` | all pass (production untouched) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |

## Scope

**In scope** (spike artifacts only — no production code merged):
- `docs/DESIGN_SYSTEM.md` (new) — the full spec above, written out:
  tokens, typography with the self-hosting plan, component skins, the
  two-mode IA, the anti-slop rules, and the decided gates (recorded as
  decided, with rationale).
- `spikes/design-prototype/` (branch-local) — a self-contained Vite
  playground: the instrument chassis, re-skinned controls, the
  ModeSwitcher mock, the Quick-check verdict card with the orchestrated
  reveal, the Lab sub-nav, mono data readouts, one empty state.
  `fonts/` holds the woff2 + OFL licenses. Screenshots captured into the
  spike dir and referenced from the doc.
- `frontend/index.html` — ONLY if the spike needs a scratch HTML file
  (prefer the spike's own file; do NOT modify the production index.html).

**Out of scope** (deferred to build plans 040+):
- Production components, App.tsx, styles.css restructure, i18n keys, e2e
  updates, Recharts re-skin, light-theme implementation, Quick-mode
  wiring.

## Git workflow

- Branch: `plan/039-frontend-revamp-design-spike`
- Commits: `docs(design): add the instrument design language and two-mode IA`, `spike(design): prototype the instrument skin and quick mode`. Merge commit: `merge: plan 039 — frontend revamp design spike`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Verify the slop inventory and capture the before-state

Re-verify the "Current state" excerpts against live files; record them in
the doc with file:line. Note the current screenshots under
`docs/screenshots/` as the before-state reference.

**Verify**: the doc's current-state section carries the exact excerpts.

### Step 2: Write `docs/DESIGN_SYSTEM.md`

Sections (all from the approved spec — write it out completely and
precisely, it is the contract for build plans 040+):
1. Concept ("The Instrument")
2. Design tokens (the full table above + spacing scale + radii + elevation)
3. Typography (fonts, usage rules, self-hosting plan, fallbacks, OFL)
4. Component skins (buttons/chips/ranking rows/tables/empty states/modals/charts-notes)
5. Two-mode IA (Quick anatomy, Lab sub-nav, header, status strip)
6. Motion (durations, the one moment, reduced-motion)
7. Anti-slop rules
8. Decided gates (the five, with the approved answers and rationale)

**Verify**: `grep -c "^## " docs/DESIGN_SYSTEM.md` ≥ 7.

### Step 3: Fonts

Download the variable woff2 files for Bricolage Grotesque and Martian Mono
from their official OFL distribution points into
`spikes/design-prototype/fonts/` with their OFL license texts. If either
is unavailable, use the shortlist and record the swap. Record the
self-hosting plan for the build phase (public/fonts + `@font-face` +
`font-display: swap` + CSP change + Flatpak asset note).

**Verify**: woff2 + OFL files present; the doc records the CSP/packaging plan.

### Step 4: Prototype

`spikes/design-prototype/` (own index.html + style.css + minimal script;
no dependency on app components):
1. Chassis background (grain via subtle SVG noise data-URI + hairline
   grid), token set applied as CSS custom properties.
2. Re-skinned controls: primary (chamfered) + lab/ghost buttons, chips,
   ModeSwitcher mock (Quick check / Lab), a data table with mono tabular
   cells and tick-row headers, rank badges, one instrument empty state.
3. **Quick-check verdict card** (the centerpiece): Bricolage verdict
   line, three plain-language reasons with mono numbers, numbers row
   (median/p95/failure/score), Apply + "Open in Lab" buttons.
4. **Run-complete reveal**: staggered fade+rise with the key-number pulse;
   `prefers-reduced-motion` yields the static variant.
5. Screenshots (full page + verdict card detail + reduced-motion state)
   into the spike dir.

**Verify**: prototype renders (`npx vite` or a static server in the spike
dir); screenshots exist.

### Step 5: Spike hygiene + gates

Run the frontend gates (production untouched — the spike is self-
contained). Confirm `git status` shows only in-scope files. Unless the
reviewer asks to keep it, `spikes/design-prototype/` is deleted before
merge; the screenshots move into the doc or `docs/screenshots/`.

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; `git status` clean.

## Test plan

- No new production tests (spike).
- Existing suites stay green.
- Build plans 040+ carry the test obligations (e2e copy updates with the
  precise-locator discipline, new component tests for ModeSwitcher/Quick
  mode, token-level grep gates: no `Inter`/`JetBrains`/teal leftovers).

## Done criteria

ALL must hold:

- [ ] `docs/DESIGN_SYSTEM.md` exists with ≥ 7 sections implementing the approved spec verbatim-in-substance
- [ ] Spike prototype renders with screenshots under `spikes/design-prototype/`
- [ ] Font woff2 + OFL licenses in the spike dir; the self-hosting/CSP/packaging plan recorded in the doc
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] No production files modified (`git status`)
- [ ] `plans/README.md` status row for 039 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- A chosen font is not OFL or its woff2 is unavailable AND the shortlist
  also fails — report the licensing question.
- The prototype requires touching production components to work.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The spec in this plan is the signed-off contract: build plans 040+
  (design-system rollout, two-mode IA, charts re-skin) are graded against
  it, and the anti-slop rules are their done-criteria grep gates.
- Recharts re-skin (042) maps tokens onto Recharts props — no dependency
  replacement.
- e2e copy assertions change in the build phase with precise-locator
  discipline (plan 028 precedent).
- Quick mode reuses existing endpoints; no backend work expected — any
  gap found in the build phase returns via plan amendment.
