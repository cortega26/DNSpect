# Plan 048: Frontend hardening — permanent theme test plus legacy-alias removal

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 57a8e34..HEAD -- frontend/src/styles.css frontend/tests/e2e docs/DESIGN_SYSTEM.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (locks in the revamp's gains; the alias layer is pure tech debt)
- **Effort**: M
- **Risk**: MED (142 consumer touch-points, but the theme spec written in Step 1 pins behavior first)
- **Depends on**: none (needs 044 merged — it is, `0a5526f`)
- **Category**: tests + tech-debt
- **Planned at**: commit `57a8e34`, 2026-09-15

## Why this matters

Two maintenance notes from the revamp demand collection. Plan 044's note:
"the e2e suite has no theme assertions; if a future plan adds a theme
test, the dual-theme probe should become it" — today a one-line token
regression in either theme ships silently. Plan 040's note: the legacy
aliases (`--bg`, `--surface`, `--text`, `--accent`, …) remain as a
compatibility layer "until a cleanup plan renames them" — 142 consumer
hits keep two token vocabularies alive, which is how the half-themed
044 bug happened in the first place. This plan does both, in the safe
order: pin behavior with a test, then delete the layer.

## Current state

- `frontend/src/styles.css` — dual vocabulary: `:root` instrument tokens
  (`--chassis`, `--panel`, `--ink`, `--accent-live`, `--accent-active`,
  …) plus legacy aliases (`--bg: var(--chassis)`, `--surface`, `--text`,
  `--muted`, `--border`, `--accent`, …). Consumer count (verified
  2026-09-15): `grep -c "var(--bg)\|var(--surface\|var(--text)\|var(--accent)\|var(--muted)\|var(--border)"`
  → **142 hits**.
- `frontend/tests/e2e/` — 27 specs, zero theme assertions (verified:
  `grep -rn "data-theme" frontend/tests/e2e/` → no matches).
- `docs/DESIGN_SYSTEM.md` §2 — the token contract including the plan-044
  light table; the alias-compatibility note lives in 040's context.
- E2e conventions: Playwright, role-based locators (plan-028 discipline),
  port-shift when :5173 is busy. Existing spec pattern: see
  `frontend/tests/e2e/workflows.spec.ts` (fixture seeding + role locators).

## Commands you will need

| Purpose | Command | Provenance | Expected on success |
|---|---|---|---|
| Drift check | `git diff --stat 57a8e34..HEAD -- <in-scope paths>` | declared | exit 0 (empty) |
| Alias census | `grep -rn "var(--bg)\|var(--surface\|var(--text)\|var(--accent)\|var(--muted)\|var(--border)" frontend/src/styles.css \| wc -l` | declared | 142 pre-removal, 0 post-removal |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | declared | all exit 0 |
| e2e | `cd frontend && npx playwright test --reporter=line` (port-shifted if needed) | declared | 27 + new theme spec count, all pass |
| Scope | `git diff --name-only <base>...HEAD` (three dots) | declared | only in-scope files |

## Scope

**In scope** (the only files you should modify):
- `frontend/tests/e2e/theme.spec.ts` (new) — the permanent dual-theme regression spec
- `frontend/src/styles.css` — alias-consumer remaps + alias-definition deletion
- `docs/DESIGN_SYSTEM.md` — record the alias removal (one short paragraph in §2)

**Out of scope** (do NOT touch):
- Token VALUES in either theme (this is a rename, not a recolor — computed styles must be byte-identical before/after)
- Components, copy, layout, behavior
- Backend of any kind

## Git workflow

- Branch: `plan/048-frontend-hardening`
- Commits: `test(e2e): pin dual-theme token contract`, then
  `refactor(css): remove legacy token aliases`. Merge commit:
  `merge: plan 048 — frontend hardening`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Permanent theme spec (pins behavior BEFORE the rename)

Create `frontend/tests/e2e/theme.spec.ts` (model on the plan-044 probe's
assertions and the existing spec style):

1. Load the app, set `document.documentElement.dataset.theme = 'dark'`,
   assert computed styles: chassis background `rgb(11, 14, 19)`, a card
   panel `rgb(18, 22, 29)`, primary ink `rgb(230, 234, 241)`, an active
   tab fill `rgb(95, 201, 214)` (`--accent-active`) with dark text.
2. Flip to `'light'`, assert: page background `rgb(244, 245, 247)`-class
   paper, verdict card `rgb(255, 255, 255)`, ink `rgb(26, 33, 43)`,
   active fill `rgb(15, 124, 140)` with `rgb(255, 255, 255)` text, amber
   primary button with dark text.
3. Keep it to ≤10 assertions, role/selector-robust ( tolerant to copy
   changes — assert on stable regions: body, `.verdict-card` or card
   panel, one active tab, one primary button).

**Verify**: `cd frontend && npx playwright test tests/e2e/theme.spec.ts --reporter=line` → all pass on the UNMODIFIED stylesheet.

### Step 2: Remap alias consumers (mechanical, no value changes)

For each of the 142 hits, replace the legacy alias with its instrument
equivalent per this fixed map (no judgment calls — if a hit doesn't fit
the map, STOP):

| Legacy | Replacement |
|---|---|
| `var(--bg)` | `var(--chassis)` |
| `var(--bg-soft)` | `var(--panel-raised)` in dark-fallback contexts — NO. STOP instead: `--bg-soft` has no single equivalent; record each hit and report rather than guessing. (The map covers only exact 1:1 rows; `--bg-soft`, `--surface-2/3`, `--surface-elevated`, `--accent-soft`, `--accent-warm*`, `--primary*`, `--success/info/warning/danger*` are NOT 1:1 — leave every one of them untouched.) |
| `var(--surface)` | `var(--panel)` |
| `var(--text)` | `var(--ink)` |
| `var(--muted)` | `var(--ink-muted)` |
| `var(--border)` | `var(--hairline)` |
| `var(--accent)` | `var(--accent-active)` |
| `var(--accent-contrast)` | `var(--accent-active-contrast)` |

Rules: only the seven exact rows above; `var(--surface-...)`,
`var(--accent-...)` (except `-contrast`), `var(--bg-soft)`,
`var(--text-...)`, `var(--success/info/warning/danger*)`, `var(--primary*)`
stay as-is. After remapping, delete ONLY the alias definitions whose
consumers reached zero (verify each with grep before deleting); the rest
of the compat layer stays with a comment pointing at this plan.

**Verify**: census grep → count equals the untouched remainder (record the
number; the seven mapped families must read 0); `npm run build` → exit 0.

### Step 3: Prove byte-identical rendering + full gates

1. Re-run the theme spec → pass (same assertions, renamed tokens).
2. Full gates: `cd frontend && npm run lint && npm run typecheck &&
   npm run build && npm test` → all exit 0; full e2e → all pass
   (27 + theme spec).
3. `docs/DESIGN_SYSTEM.md` §2: one paragraph recording which aliases were
   removed and which compat rows remain (with the grep count).

**Verify**: all green; `git status` / three-dot diff shows only in-scope files.

## Test plan

- New: `frontend/tests/e2e/theme.spec.ts` (Step 1) — the permanent
  dual-theme pin; runs in the normal e2e suite thereafter.
- Existing: all vitest + e2e stay green; the spec passing both before AND
  after the rename is the proof the refactor changed no value.

## Done criteria

ALL must hold:

- [ ] `frontend/tests/e2e/theme.spec.ts` exists and passes pre- AND post-rename
- [ ] The seven mapped alias families grep to 0 consumers in `styles.css`
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] e2e — all pass (27 + theme spec)
- [ ] `git diff --name-only <base>...HEAD` lists only the three in-scope paths
- [ ] `plans/README.md` status row for 048 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files (including a different alias-hit count — the census is load-bearing).
- A consumer hit doesn't fit the seven-row map (report the selector + property; do not invent a mapping).
- The theme spec fails post-rename (a value changed — find it via computed-style diff, don't adjust the spec).
- A `declared` command fails on the unmodified checkout (broken baseline — report, don't repair).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- New components must use instrument tokens directly; the remaining compat
  rows are tech debt with a recorded count — grep it in review.
- If a future plan re-tokens any value, the theme spec's expected rgb()
  values must move with it (they are exact, by design).
- **Deferred:** removing the remaining non-1:1 compat rows
  (`--bg-soft`, `--surface-2/3`, `--accent-soft/warm`, semantic
  `--success/info/warning/danger`) — needs per-rule design judgment, not
  mechanical renaming; unblocked by nothing.
