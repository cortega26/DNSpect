# Plan 040: Design-system rollout — tokens, self-hosted fonts, component skins

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1c42b08..HEAD -- frontend/src/styles.css frontend/index.html frontend/public/fonts frontend/src/components/*.tsx frontend/src/lib/theme-context.ts frontend/src/lib/theme.tsx frontend/src/App.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (user-requested revamp — the visible change)
- **Effort**: L
- **Risk**: MED (2707-line stylesheet restructure; theme default flips to dark)
- **Depends on**: `plans/039-frontend-revamp-design-spike.md` (merged — its `docs/DESIGN_SYSTEM.md` is the binding contract; its prototype at `spikes/design-prototype/` is the visual reference)
- **Category**: direction (build — "The Instrument" design-system rollout)
- **Planned at**: commit `1c42b08`, 2026-08-12

## Why this matters

Plan 039 delivered the signed-off design (doc + prototype) but no production
change — the UI still looks like the generic Inter/teal template. This plan
makes the Instrument real in production: self-hosted Bricolage Grotesque +
Martian Mono (Google Fonts dependency removed, CSP updated), the
dark-first instrument token set, and the component skins (buttons, chips,
cards, tables, badges, empty states, focus). Copy, behavior, and
information architecture are UNCHANGED in this plan (plan 041 owns the
two-mode IA) — so the e2e suite must pass with zero spec changes.

## Current state

- `frontend/index.html:10-17` — Google Fonts preconnects + Inter/JetBrains
  Mono link; CSP at line 29 allowlists `fonts.googleapis.com`/`gstatic`.
- `frontend/src/styles.css` — 2707 lines; `:root` tokens at 1-50
  (`--font-ui: 'Inter'`, `--font-mono: 'JetBrains Mono'`, `--bg:#f4f7fb`,
  `--accent:#0D9488`, radii 8/12/16/pill, shadow tokens); `[data-theme]`
  blocks at ~51-90; component styles throughout (buttons, chips,
  segmented, cards, tables, badges, panels, modals, empty states, focus).
- `frontend/src/lib/theme-context.ts` / `theme.tsx` — `Theme` type and
  toggle; `data-theme` attribute drives the CSS blocks.
- `spikes/design-prototype/fonts/` (on main since 039) — the variable woff2
  files + OFL licenses for Bricolage Grotesque and Martian Mono.
- `docs/DESIGN_SYSTEM.md` — the binding spec: token table, typography rules,
  component skins, motion, anti-slop rules.
- The frontend test net: vitest (166), e2e (26 — copy-driven, no style
  assertions), `i18n.copy.test.ts`, lint/typecheck.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 1c42b08..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| e2e | `cd frontend && npx playwright test --reporter=line` (port-shifted if :5173 is occupied) | 26 passed |
| Anti-slop greps | `grep -rn "Inter\|JetBrains" frontend/src frontend/index.html` | no matches |
| | `grep -rn "#0D9488" frontend/src` | no matches |

## Scope

**In scope**:
- `frontend/public/fonts/` (new) — the woff2 files + OFL licenses from the
  spike (copy, don't move — the spike stays for the build reference)
- `frontend/index.html` — remove the Google Fonts links/preconnects; update
  CSP (drop `fonts.googleapis.com`/`fonts.gstatic.com`; keep
  `style-src 'self' 'unsafe-inline'`)
- `frontend/src/styles.css` — the token layer and the component skins
- `frontend/src/lib/theme-context.ts` / `theme.tsx` — ONLY if the theme
  default/mechanics need a change (dark default: check how `theme.tsx`
  initializes; the toggle must remain)
- `frontend/src/components/*.tsx` — ONLY for class names/structural hooks
  the skins require (e.g. adding a `btn-chamfer` class to the primary CTA,
  tick-header spans in tables) — NO copy, NO layout/IA changes

**Out of scope** (do NOT touch, even though they look related):
- Copy/i18n (plan 041), IA/modes (plan 041), App.tsx layout (plan 041)
- Recharts re-skin (plan 042)
- The spike files under `spikes/design-prototype/` (reference only)
- Backend of any kind

## Git workflow

- Branch: `plan/040-design-system-rollout`
- Commits: `feat(design): self-host instrument fonts and update CSP`, `feat(design): instrument token set and component skins`. Merge commit: `merge: plan 040 — design-system rollout`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Self-host the fonts

1. Copy `spikes/design-prototype/fonts/*` (both woff2 + both OFL files)
   into `frontend/public/fonts/`.
2. `frontend/index.html` — delete the Google Fonts `<link>` and the two
   preconnects (lines 10-17); update the CSP at line 29: remove
   `https://fonts.googleapis.com` from `style-src` and
   `https://fonts.gstatic.com` from `font-src`.
3. `frontend/src/styles.css` — add the two `@font-face` blocks (from the
   spike stylesheet, lines 6-20: variable weights, `font-display: swap`,
   relative `url('fonts/...')` — vite serves `public/` at the root, so
   use `url('/fonts/BricolageGrotesque.woff2')`).

**Verify**: `cd frontend && npm run build` → exit 0; the built `dist/`
contains `fonts/` assets; `grep -rn "fonts.googleapis" frontend/index.html`
→ no matches.

### Step 2: Token layer

In `frontend/src/styles.css`:
1. Replace the `:root` token block with the DESIGN_SYSTEM.md section-2
   values. Strategy: keep the EXISTING variable names where a semantic
   equivalent exists so untouched component rules keep working, and map
   them to instrument values (e.g. `--bg → #0B0E13` chassis,
   `--surface → #12161D`, `--accent → #5FC9D6` accent-active,
   `--text → #E6EAF1`, `--muted → #98A2B3`, `--border → #232A36`), then
   ADD the new named tokens (`--chassis`, `--panel`, `--panel-raised`,
   `--hairline`, `--ink`, `--ink-muted`, `--accent-live`, `--accent-active`,
   `--ok`, `--bad`, `--focus`, `--radius-micro`, `--radius-default`,
   `--radius-large`, `--font-display`). Record the mapping in the commit
   message.
2. Radii: change the generic `--radius-sm/md/lg/pill` VALUES to 2/4/8 (keep
   the old names as aliases if component rules reference them, so no
   component breaks; the pill stays only where a pill is genuinely
   required — badges that were pills become square per the spec).
3. Elevation: replace the shadow tokens' usage as primary depth — set
   `--shadow-*` to hairline-based values or `none` where the spec calls
   for flat panels; surfaces use `1px solid var(--hairline)` borders
   instead. Do NOT delete the tokens if components reference them; null
   them out.
4. Theme blocks: `[data-theme='dark']` becomes the DEFAULT (the base
   `:root` values ARE dark now; the dark block may become redundant —
   check `theme.tsx` initialization and keep the toggle functional with a
   light block that re-tokens paper `#F5F6F8`, ink `#1A212B`, hairline
   `#D9DEE6`, same accent semantics). Verify the toggle still flips
   `data-theme` and both blocks render.

**Verify**: `cd frontend && npm run build && npx vitest run src/lib` → all
pass; the page (via the dev server or `vite preview`) shows the chassis
background with the new fonts.

### Step 3: Component skins

Per the DESIGN_SYSTEM.md section 4, restyle the component rules in
`styles.css` (and add structural hooks in the components ONLY where the
CSS cannot express the skin):
1. Buttons — primary CTA gains the chamfer (`clip-path`), `--accent-live`
   amber fill with dark text; lab/ghost hairline buttons; disabled states.
2. Chips/segmented — square `--radius-micro`, hairline, active =
   `--accent-active` fill with dark text.
3. Cards/panels — `--panel` + hairline border, `--radius-default`
   (or `--radius-large` for the largest surfaces), flat (no shadow).
4. Tables — tick-row headers (the `::before` tick mark from the spike),
   mono numeric cells right-aligned with `font-variant-numeric: tabular-nums`.
5. Rank badges — square `--radius-micro`, hairline.
6. Empty states — the dashed-ring gauge mark (spike pattern).
7. Focus — `--focus` outline rings everywhere (2px, offset).
8. Body/UI text — `--font-mono` (Martian Mono) with the display font for
   headings (`.brand-name`, section titles, the hero headline).
9. The status/measuring dots — the blink animation from the spike
   (steps-based, respect reduced motion).

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; `npx playwright test` (port-shifted) → 26 passed.

### Step 4: Anti-slop gates

- `grep -rn "Inter\|JetBrains" frontend/src frontend/index.html` → no matches
- `grep -rn "#0D9488" frontend/src` → no matches
- `grep -n "border-radius: 8px\|border-radius: 12px\|border-radius: 16px" frontend/src/styles.css` → only where the spec's 2/4/8 radii appear (and the pill where genuinely required)
- `grep -c "box-shadow" frontend/src/styles.css` → only hairline/elevation-neutral usages
- Screenshot the result (dark default + light toggle) into
  `docs/screenshots/` (e.g. `instrument-dark-main.png`) as the after-state.

**Verify**: all greps as specified; screenshots captured.

### Step 5: Final gates

**Verify**: full frontend gate + e2e green; `git status` shows only in-scope files.

## Test plan

- No new tests (styles-only; copy/IA unchanged — e2e is the regression net
  and must pass untouched).
- Add grep-gate assertions to the done criteria (anti-slop).
- If a component needed a structural hook (chamfer class, tick spans),
  that change is compile-gated by typecheck.

## Done criteria

ALL must hold:

- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `cd frontend && npx playwright test --reporter=line` — 26 passed (port-shifted if needed)
- [ ] `grep -rn "Inter\|JetBrains" frontend/src frontend/index.html` → no matches
- [ ] `grep -rn "#0D9488" frontend/src` → no matches
- [ ] `grep -rn "fonts.googleapis\|fonts.gstatic" frontend/index.html` → no matches
- [ ] `ls frontend/public/fonts/` shows the 4 files (2 woff2 + 2 OFL)
- [ ] The dark theme is the default and the toggle still works (light block renders paper tokens)
- [ ] Screenshots captured under `docs/screenshots/`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 040 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- The e2e suite fails in a way that requires a spec/copy change (styles
  must not affect the copy-driven assertions) — STOP rather than edit e2e.
- The theme-toggle mechanics require changing `theme.tsx` beyond the
  initialization default (report the design conflict).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Plan 041 (two-mode IA) builds on these tokens; the ModeSwitcher and
  Quick-mode components must consume the same tokens — no new palettes.
- Plan 042 (charts) re-skins Recharts with the same tokens.
- The `--bg`/`--accent` legacy aliases stay mapped to instrument values
  until 041's component pass can rename them cleanly — record the mapping
  in the commit so the alias removal is a mechanical follow-up.
- The light theme is secondary; contrast-check the paper/ink pairs when
  implementing (a11y contract).
