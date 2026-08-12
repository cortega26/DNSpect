# Plan 042: Typographic hierarchy pass — the instrument type scale

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46ad483..HEAD -- frontend/src/styles.css docs/DESIGN_SYSTEM.md docs/screenshots`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (user-requested fix — "all texts, titles, descriptions, buttons seem to have the exact same font size")
- **Effort**: S
- **Risk**: LOW (styles-only; no copy, no behavior)
- **Depends on**: 040/041 (merged — the Instrument tokens and the new components)
- **Category**: direction (build — typographic hierarchy per the design system)
- **Planned at**: commit `46ad483`, 2026-08-12

## Why this matters

The mono-forward instrument system collapsed the type scale. The
stylesheet's sizes are all `rem`-based and compressed: hero `clamp(1.2-1.45rem)`,
body `1rem`, labels `0.7-0.9rem` — and the plan-041 components
(ModeSwitcher, QuickCheckPanel, status strip, sub-nav, verdict card) have
**no font-size rules at all**, so they inherit the 16px body size. The
verdict line — the Quick mode's centerpiece — renders at body size. Result:
titles, descriptions, buttons, and data all read at the same size. The fix
is a real type scale, recorded in the design system and applied across the
stylesheet.

## Current state (verified)

- `frontend/src/styles.css` — sizes are `rem`-based (base `1rem` = 16px):
  - hero `h1` ~`clamp(1.2rem, 1.8vw, 1.45rem)` (line 285)
  - `.card-header h2` `1.08rem` (lines 243/608)
  - body defaults `0.8-1rem` throughout; labels `0.7-0.8rem`
  - **the plan-041 additive section has NO font-size rules** — verify by
    grepping the 2-mode-IA section (ModeSwitcher, QuickCheckPanel, verdict,
    status strip, sub-nav all inherit 1rem)
- `docs/DESIGN_SYSTEM.md` §3 (Typography) — defines fonts and usage but has
  **no numeric type scale**; this plan adds one (the contract for the
  build).

## The instrument type scale (binding)

| Role | Size | Font | Weight/tracking | Used for |
|---|---|---|---|---|
| Display-1 | `clamp(1.75rem, 3vw, 2.25rem)` | Bricolage | 700, -0.01em | hero `h1`, verdict line |
| Display-2 | `1.25rem` | Bricolage | 600, 0 | section/card titles (`h2`), dashboard-hero-title |
| Display-3 | `1rem` | Bricolage | 600, 0.01em | `h3`, panel titles |
| Body | `0.95rem` | Martian Mono | 400, 0 | default text, descriptions |
| UI | `0.85rem` | Martian Mono | 500, 0.04em | buttons, chips, inputs, mode/sub-nav tabs |
| Data | `1.25rem` | Martian Mono | 600, tabular | metric values, numbers rows, score readouts |
| Caption | `0.7rem` | Martian Mono | 500, 0.12em uppercase | labels, table headers, eyebrows, timestamps, brand tagline |

The hierarchy is size **plus** weight/tracking/case — captions are tiny
uppercase, data is large tabular, display carries the character font.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 46ad483..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| e2e (port-shifted if :5173 busy) | `cd frontend && npx playwright test --reporter=line` | 27 passed |
| Scale audit | computed-style probe (see Step 3) | sizes match the scale |

## Scope

**In scope**:
- `frontend/src/styles.css` — the type-scale application (rem-based, matching the file's convention)
- `docs/DESIGN_SYSTEM.md` — add the type-scale table to §3 (Typography)

**Out of scope** (do NOT touch):
- Copy/i18n, layout, behavior, colors
- The charts re-skin (now plan 043) and the verdict-template pinning (plan 043)
- Components — this pass is pure CSS (plus any *style-only* class the scale
  needs; prefer CSS-only)

## Git workflow

- Branch: `plan/042-typographic-hierarchy`
- Commits: `docs(design): define the instrument type scale`, `feat(design): apply the type scale across components`. Merge commit: `merge: plan 042 — typographic hierarchy`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record the scale in the design system

Add the type-scale table above to `docs/DESIGN_SYSTEM.md` §3 (Typography),
after the font-usage rules, as the binding contract.

**Verify**: `grep -n "Display-1\|type scale" docs/DESIGN_SYSTEM.md` matches.

### Step 2: Apply the scale in `styles.css`

Walk the stylesheet and set explicit sizes per the scale:
1. Hero/headlines: `h1`, `.hero h1`, `.dashboard-hero-title` → Display-1
   (keep/raise the existing clamp).
2. Titles: `.card-header h2`, section titles, `.dashboard-top5 > h3`,
   panel titles → Display-2/Display-3 (Bricolage).
3. Body/descriptions: default text, intro copy, helper texts → Body
   (`0.95rem`); adjust the `1rem`-inheriting blocks that are prose.
4. UI controls: `.btn-*`, `.chip`, `.segmented-option`, `.mode-tab`,
   `.subnav-tab`, inputs → UI (`0.85rem`, keep uppercase tracking where
   present).
5. Data readouts: `.metric-*` values, `.num-value` (Quick numbers row),
   `td.num`, score/latency cells, `LiveRankingPanel` numbers → Data
   (`1.25rem`, tabular, 600). The lone `19px` value (likely a metric or
   stat) becomes `1.25rem`.
6. Captions: table headers, `.label-caption`, `.verdict-eyebrow`,
   `.status-strip`, `.num-label`, timestamps, badges → Caption (`0.7rem`,
   uppercase, 0.12em).
7. The 041 components explicitly: `.verdict-line` → Display-1;
   `.verdict-reasons li` → Body; `.mode-tab`/`.subnav-tab` → UI;
   `.status-strip` → Caption; `.brand-name` stays Display-2-ish (`1.1rem`).
   (Add these rules to the 041 section — the components currently inherit.)
8. Set a baseline on `body` explicitly (`0.95rem` Body) so nothing falls
   back to the browser default unnoticed.

Keep every change a size/weight/tracking edit — no layout or copy changes.

**Verify**: `cd frontend && npm run build` → exit 0; `grep -c "font-size" frontend/src/styles.css` grew by roughly the number of explicit rules; the page renders with visible hierarchy.

### Step 3: Scale audit (computed-style probe)

Write a throwaway Playwright probe (like the 040 spike's verify.py pattern
— a script under /tmp, not committed): load the built app (vite preview on
5174 + the /tmp config), read computed `font-size`/`font-family`/`font-weight`
for: the hero `h1`, a card-header `h2`, the Quick verdict line, a primary
button, a data cell, a caption label. Assert the values match the scale
table (hero ≥ 28px, verdict ≥ 28px, h2 ≥ 20px, button ≈ 13.6px, data ≥
20px, caption ≤ 11.2px). Delete the probe after.

**Verify**: probe passes; `prefers-reduced-motion` unaffected (no motion
changes).

### Step 4: Gates

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; e2e (port-shifted) → 27 passed; screenshots refreshed into `docs/screenshots/` (overwrite the 041 ones with the new hierarchy).

## Test plan

- No new tests (styles-only; e2e is the regression net and must pass
  untouched — copy assertions are size-agnostic).
- The computed-style probe is the verification instrument (Step 3).

## Done criteria

ALL must hold:

- [ ] `grep -n "Display-1" docs/DESIGN_SYSTEM.md` matches (the scale is in the contract)
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] e2e — 27 passed (port-shifted if needed)
- [ ] The computed-style probe confirms: hero/verdict ≥ 28px, card titles ≥ 20px, buttons ≈ 13-14px, data cells ≥ 20px, captions ≤ 11px
- [ ] `grep -c "font-size" frontend/src/styles.css` has explicit rules for `.verdict-line`, `.mode-tab`, `.status-strip`, `.card-header h2`, `td.num` (the previously-inheriting components)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 042 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- The e2e suite fails from a size change (it must not — assertions are
  text/role-based; if one fails, STOP rather than edit the spec).
- The scale requires changing a component file (it must not — CSS only).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The scale table in DESIGN_SYSTEM.md is now the contract: new components
  must pick sizes from it, not invent new ones.
- Plan 043 (charts re-skin + verdict-template pinning) consumes the Data
  and Caption tiers for chart labels/tooltips.
- The mono-forward voice stays — hierarchy comes from size/weight/tracking,
  not from adding a second body font.
