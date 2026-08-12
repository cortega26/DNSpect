# DNSpect Design System — "The Instrument"

> **Status**: decided (plan 039, approved by operator, 2026-08-12)
> **Scope**: binding contract for build plans 040+ (design-system rollout, two-mode IA, charts re-skin)
> **Prototype**: `spikes/design-prototype/` (branch-local, plan 039)
> **Supersedes**: `design-system/dnspect/MASTER.md` (generated token doc, 2026-05-08, generic aesthetic)

DNSpect is a DNS performance laboratory. Resolvers are test targets, not
products; value comes from measurement integrity, not catalog size. The
visual language must read as an instrument: calm, exact, technical,
trustworthy. This document is the signed-off contract — build plans 040+
are graded against it, and the anti-slop rules are their done-criteria
grep gates.

---

## 1. Concept — "The Instrument"

The front panel of precision lab equipment: dark chassis, hairline bezels,
tick-marks, mono-forward numeric data, one orchestrated motion moment.

- **Restraint**: one accent at a time. No decoration that isn't functional.
- **NOT** a CRT/terminal cliché (no green-on-black, no scanlines).
- **NOT** glassmorphism.
- **NOT** a marketing dashboard.

Two audiences get two modes (Quick check / Lab) — presentation over the
existing hooks; determinism, manifests, and guardrails untouched.

---

## 2. Design tokens

### Color (dark-first; dark is the default theme)

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

### Spacing scale

`--space-1: 4px` … `--space-8: 40px` (existing scale kept: 4, 8, 12, 16,
20, 24, 32, 40).

### Radii

| Token | Value | Use |
|---|---|---|
| micro | `2px` | data chips |
| default | `4px` | controls, panels |
| largest | `8px` | largest surfaces only |

Tables and readouts are square-cornered. No pill radii.

### Elevation

Elevation = hairlines and flat panels, NOT floating shadows. No
`box-shadow`-as-primary-depth. The only shadow-like affordance is the
chamfered CTA's clipped corner (see Component skins).

---

## 3. Typography

| Role | Font | Notes |
|---|---|---|
| Display/headings | **Bricolage Grotesque** (OFL) | tight tracking — brand, verdict, section titles only |
| UI/body/data | **Martian Mono** (OFL) | mono-forward instrument voice: labels, buttons, body text, and EVERY numeric value in tabular figures (latency ms, percentages, scores, timestamps) |

### Usage rules

- Bricolage Grotesque: brand mark, verdict line, section titles. Never
  body text.
- Martian Mono: everything else — labels, buttons, body text, all numbers.
- Numbers render in tabular figures (Martian Mono has tabular figures by
  default; enforce `font-variant-numeric: tabular-nums` at the readout
  level as defense-in-depth).

### Self-hosting plan (build phase)

- Files live under `frontend/public/fonts/` as **variable woff2** +
  their OFL license texts.
- `@font-face` declarations with `font-display: swap`, local in
  `frontend/src/styles.css` (or a dedicated `fonts.css` imported by it).
- CSP: drop `fonts.googleapis.com` / `fonts.gstatic.com` from the
  allowlist in `frontend/index.html:29` (`style-src` and `font-src`
  become `'self'`-only for fonts).
- Remove the Google Fonts `<link>` + preconnects
  (`frontend/index.html:10-17`).
- Flatpak packaging: `fonts/` ships inside the bundle via the manifest
  (self-hosted = no network font fetch at runtime; note this in the
  Flatpak checklist so the sandboxed app needs no web-font exceptions).

### Fallbacks

- Mono stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Display stack: Bricolage Grotesque, then the mono stack (no generic
  sans — an instrument never falls back to a humanist sans).

### Verification of OFL status (plan 039)

- Bricolage Grotesque: OFL 1.1, variable woff2 available — verified,
  used. Downloaded as the latin subset of the variable file via the
  official Google Fonts distribution (CSS API on `fonts.googleapis.com`,
  woff2 on `fonts.gstatic.com`).
- Martian Mono: OFL 1.1, variable woff2 available — verified, used.
  Same distribution path.
- Note: `github.com/google/fonts` (the Google-hosted source repo) ships
  TTF only; the woff2 comes from the Google Fonts CDN, which serves the
  OFL-licensed variable files subsetted per script.
- License texts shipped alongside the woff2 in
  `spikes/design-prototype/fonts/`; both are OFL, no licensing question.
- Shortlist if either had been unavailable (not needed): display
  "Instrument Sans" → "Spline Sans Mono"-class alternatives; data
  "Fragment Mono". Any swap must be recorded, never silent.

---

## 4. Component skins

### Buttons

- **Primary CTA**: chamfered corner (clipped corner via CSS
  `clip-path`) — the ONE distinctive instrument signature, used nowhere
  else. Amber on dark (`--accent-live`) for the single hero action;
  semantic `--ok` / `--bad` variants for success/destructive actions.
- **Lab/ghost**: hairline border (`--hairline`), mono labels, uppercase
  small-caps optional. Hover raises to `--panel-raised`.

### Chips / segmented controls

- Square `2px` radius, hairline border.
- Active state = `--accent-active` fill with dark text.

### Ranking rows

- Resolver identity: name + provider in UI type (label style).
- Numbers in mono, aligned decimals.
- Rank badge: square (not pill).
- Protocol badge; reliability/blocking readouts inline.

### Tables

- Tick-row headers: hairline + tick mark.
- Mono numeric cells right-aligned with tabular figures.
- Square corners.

### Empty states

- Instrument-flavored (e.g. "No runs yet — start one in the Lab"),
  never a generic illustration.

### Modals

- `--panel-raised` surface, square corners, focus-trap contract intact.

### Charts (note for build plan 042)

Recharts re-skinned via tokens — mono ticks, hairline grids, series from
the token palette, tooltip as instrument readout. Not replaced (bundle
constraint).

---

## 5. Two-mode IA

### Header

- Brand mark reworked in instrument style.
- **ModeSwitcher**: two-tab segmented control (Quick check / Lab) —
  keyboard-operable, `role=tablist` per the existing a11y patterns.
- Theme toggle, locale menu.

### Status strip

Persistent context in the header: the current run's status always
visible (Idle / Measuring / Complete / Failed + progress + ETA).

### Quick check (default tab)

One primary action — **"Check my DNS"**. Flow: single status line
(Measuring…) → **verdict card**:

1. Big verdict in Bricolage ("Your DNS is good — keep it" / "Switch to
   Cloudflare — ~34% faster median here");
2. Three plain-language reasons in bullet form (faster median, fewer
   failures, better stability — each backed by a number in mono);
3. The numbers row (mono, tabular): median / p95 / failure rate / score;
4. Primary action: **Apply** (opens the existing GuidedApplyModal) +
   secondary **"Open in Lab"**.

Progressive disclosure: everything else behind "Open in Lab". No
protocol/region/goal machinery visible.

### Lab (savvy tab)

The full surface reorganized with a sub-nav:

- **Benchmark** (controls)
- **Results** (ranking + charts)
- **History** (runs + comparison)
- **Watch** (monitoring)
- **Protocol Lab** (comparisons)

Both modes are presentation over the existing hooks; determinism,
manifests, and guardrails untouched.

---

## 6. Motion

- Transitions 120–200ms; states fade/translate 2–4px max.
- The one orchestrated moment: run-complete verdict reveal — staggered
  fade+rise of the verdict card elements; values settle with a brief
  pulse on the key number.
- `prefers-reduced-motion` → instant (existing `motion.ts` machinery
  reused in the build phase).

---

## 7. Anti-slop rules

Done-criteria grep gates for build plans 040+:

1. No Inter/Roboto/Arial/system-ui for UI.
2. No purple gradients.
3. No 8/12/16/pill-only radii.
4. No floating-shadow depth.
5. No generic empty states.
6. No centered-max-width-only layouts.
7. No scanlines/CRT gimmicks.

---

## 8. Decided gates

Presented to the operator as a full recommendation and approved
("I like it, go ahead"). Recorded as decided, with rationale:

| Gate | Decision | Rationale |
|---|---|---|
| Design direction | "The Instrument" — dark chassis, hairline bezels, mono-forward data | Product is a precision DNS laboratory; calm, exact, technical, trustworthy |
| Typography | Bricolage Grotesque + Martian Mono, self-hosted woff2 | Distinctive instrument voice; OFL both; removes Google Fonts runtime dependency (Flatpak-friendly) |
| Color | Dark-first, amber (`--accent-live`) + cyan (`--accent-active`) phosphor accents on near-black chassis | Reading as instrumentation; not a CRT cliché; contrast-checked pairs |
| Signature detail | Chamfered primary CTA (CSS `clip-path`), used nowhere else | One distinctive instrument-flavored detail; cheap, reversible |
| IA | Two modes: Quick check (non-technical) / Lab (savvy), ModeSwitcher in header | Two audiences without touching backend, determinism, or manifests |

---

## 9. Current state (the slop inventory — before-state)

Verified against the live tree at plan-039 execution (commit `02ed0e9`):

- `frontend/index.html:13-17` — Google Fonts: Inter + JetBrains Mono
  (link + preconnects at 10-11, CSP allowlist at 29).
- `frontend/src/styles.css` — 2707 lines; `--font-ui: 'Inter', ...`
  (16), `--font-mono: 'JetBrains Mono', ...` (17),
  `--font-heading: var(--font-ui)` (18); light-by-default
  `--bg: #f4f7fb` (20), teal `--accent: #0D9488` (26); radii 8/12/16/pill
  (11-14); `--shadow: 0 14px 38px ...` (38); `[data-theme='dark']` block
  (81-82).
- Components: 14 component files + `App.tsx` (1450 lines); one long
  single-screen flow; `DashboardControls.tsx` renders ~27 chip/segmented
  elements across 13 source lines matching `chip|segment`
  (3 mode + 4 protocol + 5 goal + 7 region + 1 comparison toggle +
  4 comparison protocols + 3 timeout presets).
- `design-system/dnspect/MASTER.md` — generated token doc (2026-05-08)
  enshrining the generic aesthetic; superseded by this document.
- `docs/screenshots/` — the before-state visual reference (e.g.
  `light-main.png`, `dark-main.png`, `ux-before.png`, `redesign-dark.png`).
- Test-gated contracts: `accessibility-i18n.spec.ts` (copy assertions,
  locale switching), `i18n.copy.test.ts`, hook/component suites, e2e 26
  specs, WCAG 2.2 (focus traps, skip link, keyboard).

---

## 10. Spike prototype (plan 039)

Self-contained playground: `spikes/design-prototype/` (branch-local,
own `index.html` + `style.css` + `script.js`; no dependency on app
components). Covers: chassis (grain + hairline grid), re-skinned
controls (chamfered primary, lab/ghost, chips, ModeSwitcher mock,
tick-row table, rank badges, instrument empty state), the Quick-check
verdict card with the orchestrated run-complete reveal, and the
reduced-motion static variant. Fonts: variable woff2 (latin subset of
the official Google Fonts variable files) + OFL texts in
`spikes/design-prototype/fonts/`.

Screenshots (captured with headless Chromium at plan-039 execution):

| File | State |
|---|---|
| `spikes/design-prototype/shot-full-quick-idle.png` | Quick check, idle, pre-run |
| `spikes/design-prototype/shot-full-verdict.png` | Run complete — verdict card revealed |
| `spikes/design-prototype/shot-verdict-detail.png` | Verdict card detail |
| `spikes/design-prototype/shot-full-lab.png` | Lab mode — sub-nav, table, empty state |
| `spikes/design-prototype/shot-reduced-motion.png` | Reduced-motion static variant |

Per the plan's hygiene rule, `spikes/design-prototype/` is deleted before
merge unless the reviewer keeps it; the screenshots then move into this
doc or `docs/screenshots/`.
