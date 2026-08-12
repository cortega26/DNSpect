# Plan 039: Frontend revamp — design spike ("the instrument" + two-mode UX)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat b70ca05..HEAD -- frontend/src/styles.css frontend/src/App.tsx frontend/index.html frontend/src/lib/types.ts frontend/src/components/*.tsx frontend/src/lib/i18n-translations.ts frontend/src/lib/theme-context.ts frontend/src/lib/theme.tsx frontend/tests/e2e/*.spec.ts docs/DESIGN_SYSTEM.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (product direction — the user's explicit request)
- **Effort**: L (design spike: audit, design language, prototype, decisions — no production code merged)
- **Risk**: LOW (spike; the build plans that follow carry the real risk)
- **Depends on**: none
- **Category**: direction (frontend revamp: intention, style, intuitiveness, two-mode UX, anti-slop)
- **Planned at**: commit `b70ca05`, 2026-08-12

## Why this matters

The user asked for a full front-end revamp: intention, style, intuitiveness
(a possible non-technical vs. savvy two-tab split), and elimination of the
"clear AI slop" aesthetics. The audit confirms the charge — the current UI
is the generic generated-dashboard template: **Inter + JetBrains Mono**
loaded from Google Fonts (`frontend/index.html:13-15`), teal-on-pale-gray
palette (`styles.css:20-34`), tailwind-classic radii (8/12/16/pill,
`styles.css:11-14`), 29 chip/segmented elements, centered max-width column
layout, and a `design-system/MASTER.md` that is itself a generated token
doc (2026-05-08) enshrining the cliché. The product's identity — "a
precision DNS performance laboratory" (per the product stance) — deserves a
visual language that reads as an instrument, not a SaaS dashboard. This
spike picks the direction with evidence, prototypes it, and leaves the
maintainer a short decision list; build plans follow.

## Current state (the slop inventory — audit evidence)

- `frontend/index.html:13-15` — Google Fonts: Inter (UI) + JetBrains Mono (data). Both generic; also an external-font dependency for a local-first Flatpak app (CSP at index.html:29 whitelists fonts.googleapis.com; offline the app falls back to system fonts — invisible branding drift).
- `frontend/src/styles.css` — 2707 lines; `--font-ui: 'Inter'`, `--font-heading: var(--font-ui)` (styles.css:16-18); light-by-default `--bg:#f4f7fb` teal `--accent:#0D9488` (20-34) with a `[data-theme='dark']` toggle (81-82); radii 8/12/16/pill; standard card grid with `--shadow-md/lg` tails.
- Components: 15 components + App.tsx (1450 lines) — hero → controls (DashboardControls, 29 chip/segmented elements) → run → dashboard (live ranking, charts, history, watch, comparisons). One long single-screen flow for every user.
- `frontend/src/lib/theme-context.ts` / `theme.tsx` — light/dark toggle exists; no design tokens beyond the color vars.
- Test-gated contracts the revamp must respect: `accessibility-i18n.spec.ts` (locale switching, specific copy assertions like 'History'/'Histórico', region chips), `i18n.copy.test.ts` (ES source of truth, key parity), the hook/component suites, e2e 26 specs, WCAG 2.2 contract (focus traps, skip link, keyboard).
- Recharts (lazy) renders the charts — must be re-skinned to the new palette, not replaced (bundle constraint).

## The proposed direction — "The Instrument"

**Concept**: DNSpect is a measurement instrument, not a marketing dashboard.
The UI should read like the front panel of precision lab equipment:
dark chassis, phosphor accents, hairline grids, tick-marks, and
mono-forward numeric data — calm, exact, technical. One strong moment:
the run-in-progress ranking pulses like a live instrument readout.

**Design language (primary proposal)**:
- **Theme**: dark-first (the chassis); light mode optional and secondary,
  decision-gated. Near-black instrument background (`#0B0E13`-class), not
  blue-gray.
- **Accents**: a restrained two-tone phosphor set — amber (`#E8A33D`-class)
  for "live/attention" and a cold cyan (`#5CC8D7`-class) for
  "active/info"; success/destructive kept semantically distinct. One
  dominant + sharp accent, never evenly-distributed multi-color.
- **Typography**: self-hosted woff2 (no Google Fonts — Flatpak offline +
  egress-aligned): display/UI = **Bricolage Grotesque** (distinctive,
  industrial-print character, OFL); data/mono = **Martian Mono**
  (characterful technical mono, OFL). Fallbacks to system mono stack.
- **Surfaces**: hairline `1px` borders (instrument bezels), flat panels
  with minimal elevation (no floating-card shadows), tick/scale marks in
  section headers, a faint noise/grain on the chassis for depth.
- **Motion**: one orchestrated run-complete reveal + a live-ranking
  "readout" pulse; everything else restrained. Respect
  `prefers-reduced-motion` (existing `motion.ts` machinery reused).
- **Anti-slop rules (enforced)**: no Inter/Roboto/Arial/system-ui for UI;
  no purple gradients; no tailwind-classic radii/8/12/16 pill as the only
  shape language (instrument corners: small radii or square + chamfer
  accents); no floating shadows as the primary depth signal; no generic
  empty states (each gets an instrument-flavored illustration/iconography).

**Alternative direction (for the decision gate)**: "The Field Manual" —
ivory paper background, ink typography (e.g. **Fraunces** display +
**Newsreader**-adjacent body... or a monospaced-accented editorial system),
red-stamp accents, ruled-line grids. Warmer, more human; distinct from
every other DNS tool. Two real options, one recommended.

## The two-mode UX (intention)

The current single-flow serves both audiences poorly. Proposed IA:
- **Quick check (novice tab)**: one primary action — "Check my DNS" — which
  runs the current system-DNS resolvers against the speed goal with
  sensible defaults and renders a single verdict card (recommendation +
  plain-language explanation + apply-DNS guidance). No protocol/region/
  goal machinery visible; progressive disclosure: one "Advanced" link into
  Lab. Hides ranking tables by default; shows them behind a toggle.
- **Lab (savvy tab)**: the full current surface, reorganized — controls
  always visible, results/dashboard/watch/comparison as a proper sub-nav
  instead of one long scroll.
- The mode is presentation/orchestration only: both modes call the same
  hooks and backend; determinism, manifests, and guardrails untouched.
- A top-level `ModeSwitcher` (two-tab segmented control with keyboard
  support per the a11y contract).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat b70ca05..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Spike tests | `cd frontend && npx vitest run src/lib/utils.test.ts src/hooks/useBenchmarkSession.test.ts` | all pass (prototype must not regress core suites) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| e2e (port-shifted) | per the environment note in prior plans (the :5173 operator server) | all pass |

## Scope

**In scope** (spike artifacts only — no production code merged):
- `docs/DESIGN_SYSTEM.md` (new) — the design language: tokens (colors,
  typography with the chosen fonts' rationale, spacing, radii, elevation,
  motion), component skin specs (buttons, chips, cards, tables, badges,
  empty states), the two-mode IA diagram, and the anti-slop rules
- `spikes/design-prototype/` (branch-local, deleted before merge unless
  kept by the reviewer) — a Vite playground page: the Quick-check verdict
  card, the Lab sub-nav, re-skinned buttons/chips/tables, the
  instrument-chassis background, the run-complete reveal, the new font
  loading (self-hosted woff2 dropped into `frontend/public/fonts/` for the
  spike; real bundling is a build-plan concern)
- `frontend/src/styles.css` — ONLY to the extent the spike needs a
  prototype stylesheet (prefer a separate spike CSS file; do NOT restructure
  the 2707-line production file in this plan)
- Font license files (OFL) for the chosen fonts, in the spike dir

**Out of scope** (explicitly deferred to build plans 040+):
- Any production component, App.tsx, index.html, i18n, or e2e changes
- Recharts re-skinning (build plan)
- The light-theme decision and implementation (decision gate)
- Quick-mode backend work (none needed — it reuses existing endpoints; a
  "system DNS quick run" is just `start()` with defaults)
- i18n keys for new copy (build plan, with the copy-test gate)

## Git workflow

- Branch: `plan/039-frontend-revamp-design-spike`
- Commits: `docs(design): add the instrument design language and two-mode IA`, `spike(design): prototype the instrument skin and quick mode`. Merge commit: `merge: plan 039 — frontend revamp design spike`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Inventory the slop (done above; verify against live code)

Re-verify the audit excerpts (fonts, palette, radii, chip count, CSP) and
record them as the baseline in the design doc's "current state" section,
with the file:line evidence. Also capture the current screenshots
(`docs/screenshots/`) as the before-state reference.

**Verify**: the design doc's current-state section contains the exact
excerpts with file:line.

### Step 2: Write `docs/DESIGN_SYSTEM.md`

Sections:
1. **Direction** — "The Instrument" concept statement (and the Field
   Manual alternative summarized), with the product-identity grounding.
2. **Design tokens** — full token table: chassis/panel/bezel colors,
   phosphor accent set, semantic colors (ok/warn/destructive, with
   contrast-checked values for the a11y contract), spacing scale, radii
   (instrument language: square + small radii + chamfer accents; specify
   exact token values), elevation (hairlines over shadows), typography
   (chosen fonts + fallback stacks + usage rules: display for headings,
   mono for ALL numeric data — latency, percentages, scores, timestamps),
   motion (durations, the one orchestrated moment, reduced-motion
   behavior).
3. **Component skin specs** — buttons (primary/lab/ghost with the new
   language), chips/segmented (the two-mode switcher), cards/panels
   (bezel + hairline, no floating shadows), tables (tick-row headers,
   mono numeric cells), badges, empty states (instrument-flavored),
   modals (focus-trap contract preserved).
4. **Two-mode IA** — the Quick/Lab diagram: what each mode shows, how
   they share hooks/state, the ModeSwitcher behavior (keyboard, ARIA
   roles per the existing segmented-control pattern), progressive
   disclosure rules.
5. **Anti-slop rules** — the checklist (no Inter/Roboto/system-ui, no
   purple gradients, no 8/12/16-only radii, no floating-shadow depth, no
   generic empty states, no centered-max-width-only layouts).
6. **Decision gates** — the maintainer's list (see Step 5).

**Verify**: all six sections present (`grep -c "^## " docs/DESIGN_SYSTEM.md` ≥ 6).

### Step 3: Font selection and self-hosting spike

Pick the primary pair (Bricolage Grotesque + Martian Mono — verify current
OFL releases and their variable-font woff2 availability; if either is
unavailable on the chosen platform, swap from a shortlist of equally
characterful alternatives and record why) and download the woff2 files into
`spikes/design-prototype/fonts/` with their OFL licenses. Record the
self-hosting plan for the build phase: files under `frontend/public/fonts/`
(or a vite-plugin), `@font-face` declarations with `font-display: swap`,
CSP update (drop fonts.googleapis.com/gstatic from the allowlist,
index.html:29), and the Flatpak packaging note (fonts ship with the static
assets — verify the PyInstaller/Flatpak asset bundling already covers
`frontend/dist`).

**Verify**: the woff2 files + OFL licenses exist in the spike dir; the doc
records the fallback stacks and the CSP/packaging plan.

### Step 4: Prototype — `spikes/design-prototype/`

A standalone Vite playground page (its own `index.html` + `style.css` +
small TSX-free demo or a minimal React mount — keep it dependency-free of
the app's components):
1. The instrument chassis background (grain + hairline grid) with the new
   token set applied.
2. Re-skinned controls: primary/lab buttons, chips, a two-tab ModeSwitcher
   mock (Quick/Lab), a table with mono numeric cells and tick-row headers,
   badges, an empty state.
3. The **Quick-check verdict card**: big verdict (recommended resolver +
   plain-language sentence), latency/score readouts in mono, the
   "Advanced → Lab" link.
4. The **run-complete reveal**: the one orchestrated motion moment
   (staggered verdict + readout pulse), with `prefers-reduced-motion`
   respected.
5. Screenshots of the prototype captured to `spikes/design-prototype/`
   for the review.

**Verify**: the prototype renders in a browser (serve via `npx vite` in
the spike dir or a static server); screenshots exist; `prefers-reduced-motion`
check produces the static variant.

### Step 5: Decision gates (for the maintainer — recorded in the doc)

1. **Direction**: The Instrument (recommended) vs The Field Manual.
2. **Light theme**: keep a light variant (if so, it is secondary and gets
   its own token set) or dark-only.
3. **Font pair**: Bricolage Grotesque + Martian Mono vs the shortlist.
4. **Quick-mode scope v1**: system-DNS + speed goal + verdict card only
   (recommended) vs also exposing goal choice in Quick.
5. **IA restructure depth in Lab**: sub-nav (recommended) vs keep the
   single-scroll layout in Lab, only re-skinned.

**Verify**: the doc's decision-gate section lists all five with the
recommendations.

### Step 6: Spike hygiene + gates

The spike must not regress the repo: run the frontend gates (the spike dir
is excluded from the app build; verify `npm run build` and the vitest
suites pass untouched) and confirm `git status` shows only the in-scope
files. Unless the reviewer asks to keep it, `spikes/design-prototype/`
is deleted before merge (the design doc + screenshots capture the
findings — screenshots are moved into the doc or `docs/screenshots/`).

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; e2e (port-shifted) → all pass.

## Test plan

- No new production tests — the spike is prototype + doc.
- The existing suites must stay green (the spike touches nothing
  production).
- The build plans that follow (040+) will carry the test obligations:
  updated e2e copy assertions if labels change, new component tests for
  ModeSwitcher/Quick mode, token-level tests (a check that
  Inter/JetBrains references are gone from the production stylesheet —
  a grep-gate done criterion), and the i18n copy test for new keys.

## Done criteria

ALL must hold:

- [ ] `docs/DESIGN_SYSTEM.md` exists with ≥ 6 sections incl. tokens, skins, two-mode IA, anti-slop rules, and the 5 decision gates
- [ ] The spike prototype renders with screenshots captured under `spikes/design-prototype/`
- [ ] Font woff2 + OFL licenses present in the spike dir; the self-hosting/CSP/packaging plan recorded in the doc
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0 (production untouched)
- [ ] e2e (port-shifted) — all pass
- [ ] No production files modified: `git status` shows only the in-scope list
- [ ] `plans/README.md` status row for 039 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- A chosen font is not OFL-licensed or its woff2 is unavailable — swap from
  the shortlist and record the change; if no shortlist font works, STOP
  and report the licensing question.
- The prototype requires touching production components/App.tsx to work —
  STOP (the spike must be self-contained; production changes are build
  plans).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- This spike's decision gates bind the build plans: do not let 040+ reopen
  them without new evidence.
- The anti-slop rules are the contract the build plans are graded against;
  the "no Inter/JetBrains/teal" grep-gate belongs in every build plan's
  done criteria.
- Recharts re-skinning (042) must map the new tokens onto Recharts' props,
  not replace the lazy-loaded dependency (bundle constraint).
- The e2e copy assertions (`accessibility-i18n.spec.ts`) will need
  careful updating when labels change in the build phase — the locator
  discipline from plan 028 (precise roles, not bare text) is the
  precedent.
- The Quick mode reuses existing endpoints (`start()` with defaults +
  system DNS) — no backend work is expected; if a build plan finds a
  backend gap, it must come back through a plan amendment, not improvise.
