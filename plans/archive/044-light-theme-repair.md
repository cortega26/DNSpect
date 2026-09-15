# Plan 044: Repair the light theme — full instrument token set on paper

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 704494a..HEAD -- frontend/src/styles.css docs/DESIGN_SYSTEM.md docs/screenshots`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (user-reported: "The Light Colored Theme looks awful")
- **Effort**: S
- **Risk**: LOW (styles-only; the dark theme must stay byte-identical in behavior)
- **Depends on**: 040-043 (merged — the Instrument tokens and components)
- **Category**: direction (build — light-theme repair)
- **Planned at**: commit `704494a`, 2026-08-12

## Why this matters

Plan 040 implemented the light theme as a re-token of the LEGACY aliases
only (`--bg`, `--surface`, `--text`, `--accent`…). The revamp components
(040-043: ModeSwitcher, QuickCheckPanel, verdict card, status strip,
sub-nav, charts, stale labels, tables) render through the NEW token names
(`--chassis`, `--panel`, `--panel-raised`, `--hairline`, `--ink`,
`--ink-muted`, `--accent-live`, `--accent-active`, `--ok`, `--bad`,
`--focus`) which the light block does NOT override. Result in light mode:
a paper page (`--bg: #f5f6f8`) mixed with near-black new-token surfaces
(`--panel: #12161d`), light text where `--ink` is used, and a muddy
"amber" (`--accent-warm: #8a5a00`). It looks broken — because it is
half-implemented.

## Current state (verified)

- `frontend/src/styles.css:97-131` — `[data-theme='light']` overrides ONLY
  the legacy aliases (`--bg`, `--bg-soft`, `--surface`, `--surface-2/3`,
  `--surface-elevated`, `--text`, `--muted`, `--border`, `--accent`,
  `--accent-contrast`, `--accent-soft`, `--accent-warm`,
  `--accent-warm-soft`, `--primary*`, `--success*`, `--warning*`,
  `--info*`, `--danger*`, `--shadow*`).
- The NEW tokens are defined once in `:root` (lines 51-66:
  `--chassis: #0b0e13`, `--panel: #12161d`, `--panel-raised: #171c25`,
  `--hairline: #232a36`, `--ink: #e6eaf1`, `--ink-muted: #98a2b3`,
  `--accent-live: #e8a33d`, `--accent-active: #5fc9d6`, `--ok: #5bb98c`,
  `--bad: #e06c5f`, `--focus: #5fc9d6`) with **no light overrides**.
- Component rules reference both sets: legacy-alias consumers (locale
  menu, segmented controls, live-ranking rows at ~434-1531) DO get the
  light values; new-token consumers (verdict card ~2905+, ModeSwitcher,
  status strip, sub-nav, charts, tables via `td.num`/`th.num`, the
  stale labels) stay DARK in light mode.
- No hardcoded hex literals in component rules (verified — everything is
  token-based), so fixing the token block fixes the theme.
- `--accent-contrast` exists and is used by `.segmented-option.is-active`
  (line 777-778) — the pattern for the active-fill text color.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 704494a..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| e2e (port-shifted) | `cd frontend && npx playwright test --reporter=line` | 27 passed |
| Theme probe | computed-style probe in BOTH themes (Step 3) | contrast table passes |

## Scope

**In scope**:
- `frontend/src/styles.css` — the light token block (full new-token set +
  contrast-pair tokens) and any accent-fill text colors that need the
  contrast tokens
- `docs/DESIGN_SYSTEM.md` — record the light token set + contrast pairs in
  section 2 (the contract)

**Out of scope** (do NOT touch):
- The dark theme's values (behavior must be identical)
- Copy/i18n, layout, components, the theme toggle mechanics
- The charts/tables styling beyond what the tokens fix

## Git workflow

- Branch: `plan/044-light-theme-repair`
- Commits: `fix(theme): full instrument token set for the light theme`. Merge commit: `merge: plan 044 — light theme repair`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The light token set

In `[data-theme='light']` (styles.css:97), add overrides for the FULL new
token set, keeping the legacy aliases as-is (they already work):

```css
--chassis: #f4f5f7;          /* paper — slight cool cast */
--panel: #ffffff;
--panel-raised: #f8f9fb;     /* hover/active surfaces, modals */
--hairline: #d8dde5;
--ink: #1a212b;
--ink-muted: #5b6675;
--accent-live: #e8a33d;      /* amber fill — dark text on it (AA) */
--accent-live-ink: #a16207;  /* amber as TEXT on paper (AA) */
--accent-active: #0f7c8c;    /* cyan fill — white text on it (AA) */
--accent-active-ink: #0f7c8c;/* cyan as TEXT on paper (AA) */
--ok: #2e7d5b;
--bad: #b84a3e;
--focus: #0f7c8c;
--accent-contrast: #ffffff;  /* text on the cyan fill in light */
```

Contrast notes (verify with a quick calculation in the probe): white on
`#0f7c8c` ≈ 4.8:1 (AA); `#1a212b` on `#ffffff` ≫ 4.5; `#a16207` on
`#f4f5f7` ≈ 4.6:1 (AA); dark `#0b0e13` on `#e8a33d` ≫ 4.5 (the dark
theme's amber fill keeps its dark text). If any pair falls under AA, pick
the nearest darker/lighter value and note it.

**Verify**: `cd frontend && npm run build` → exit 0.

### Step 2: Contrast-pair consumers

Sweep for rules that put text on the accent fills and route them through
the contrast tokens:
- `.btn-primary` and any `background: var(--accent-live)` rule: ensure the
  text color is a dark ink that works on amber in BOTH themes (if it
  currently uses `var(--ink)`, that flips to dark text on amber in light —
  which is fine — but in DARK mode `--ink` is light-on-amber = broken;
  check the current value; if it's a literal or `--ink`, introduce
  `--accent-live-contrast: #0b0e13` and use it).
- `.segmented-option.is-active`, `.mode-tab.is-active`, `.chip.is-active`,
  `.subnav-tab.is-active`, `.locale-item.is-active` — any rule whose
  background is `var(--accent)`/`var(--accent-active)` and text is a
  fixed color must use `--accent-contrast` (or the new
  `--accent-active-contrast`) so light mode flips the text to white.
- Amber text-on-paper usages (the status dot is a fill — fine; any
  `color: var(--accent-live)` TEXT like the measuring line) should use
  `--accent-live-ink` in light: introduce `--accent-live-ink` and set
  `color: var(--accent-live-ink, var(--accent-live))`? NO — keep it
  simple: where the token set matters, define both `-ink` variants in
  BOTH themes (`--accent-live-ink: #e8a33d` in dark — it's already AA on
  the chassis, and `#a16207` in light) and switch text usages to them.

**Verify**: `grep -n "accent-live-ink\|accent-active-ink\|accent-live-contrast\|accent-active-contrast" frontend/src/styles.css` matches; `npm run typecheck && npm run lint` → exit 0.

### Step 3: Dual-theme probe

Write a throwaway Playwright probe (under /tmp, not committed) that loads
the built app, flips `data-theme` to both values, and asserts computed
styles:
- Dark (regression): chassis bg `rgb(11,14,19)`, panel `rgb(18,22,29)`,
  ink `rgb(230,234,241)`, hairline `rgb(35,42,54)` — unchanged from
  pre-fix values.
- Light: body bg `rgb(244,245,247)`-class paper, verdict card bg
  `rgb(255,255,255)`, ink `rgb(26,33,43)`, hairline `rgb(216,221,229)`;
  the active chip/segmented: background `rgb(15,124,140)` with text
  `rgb(255,255,255)`; the primary button: amber fill with dark text.
- The mode tabs and verdict card render with paper surfaces (no dark
  panels in light mode).

**Verify**: probe passes; screenshots `instrument-light-main.png` +
`instrument-light-quick.png` refreshed in `docs/screenshots/`.

### Step 4: Record the light set in the design system

Add the light token values + the contrast-pair tokens to
`docs/DESIGN_SYSTEM.md` §2 (a short "Light theme token set" table
referencing this plan's values).

**Verify**: `grep -n "accent-live-ink" docs/DESIGN_SYSTEM.md` matches.

### Step 5: Gates

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; e2e (port-shifted) → 27 passed; `git status` shows only in-scope files.

## Test plan

- No new tests (styles-only); the dual-theme probe is the verification
  instrument; the e2e suite must pass untouched (no copy/behavior change).
- The dark-theme regression check (Step 3) pins that the fix doesn't leak
  into the default theme.

## Done criteria

ALL must hold:

- [ ] `[data-theme='light']` overrides all 12 new tokens (grep `--chassis\|--panel\|--hairline\|--ink\|--accent-live\|--accent-active\|--ok\|--bad\|--focus` inside the light block)
- [ ] The probe confirms: no dark surfaces in light mode; active fills use the contrast text; dark theme values unchanged
- [ ] `grep -n "accent-live-ink\|accent-active-ink" docs/DESIGN_SYSTEM.md frontend/src/styles.css` match
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] e2e — 27 passed (port-shifted if needed)
- [ ] Screenshots refreshed (`instrument-light-main.png`)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 044 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- A contrast pair cannot reach AA with a reasonable value (report the pair
  instead of shipping a failing one).
- The probe shows the dark theme changed (regression) — fix, or STOP.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The `-ink`/`-contrast` variants are the pattern for any future
  fill+text token pair: one fill value per theme + one text-on-fill value
  per theme.
- The e2e suite has no theme assertions; if a future plan adds a theme
  test, the dual-theme probe should become it.
- The legacy aliases remain as a compatibility layer for the older
  components until a cleanup plan renames them (recorded in 040's
  maintenance note).
