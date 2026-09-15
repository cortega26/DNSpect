# Plan 043: Polish pass — staleness readouts, charts re-skin, verdict-template pinning

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 65ad0a5..HEAD -- frontend/src/components/LiveRankingPanel.tsx frontend/src/App.tsx frontend/src/components/ChartsPanel.tsx frontend/src/components/ResolverDetailModal.tsx frontend/src/lib/i18n-translations.ts frontend/src/lib/i18n.copy.test.ts frontend/src/lib/runtime.ts frontend/src/lib/runtime.test.ts frontend/src/styles.css`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: 040/041/042 (merged — tokens, IA, type scale)
- **Category**: direction (build — revamp polish)
- **Planned at**: commit `65ad0a5`, 2026-08-12

## Why this matters

Three polish items from the revamp review: (1) **staleness readouts** — the
"Update Xs ago" counter (`UpdatedAgoLabel`) and the "Last progress: Xs ago"
label are ticking noise while healthy (the user flagged them; the audits
also flagged the per-second re-render churn) — they should be
**state-based**: nothing while fresh, amber/red only when stale;
(2) **charts re-skin** — Recharts still renders with default styling,
breaking the Instrument language where it is most visible; (3)
**verdict-template pinning** — the 041 executor flagged that the
Quick-mode verdict/reason copy templates exist but their placeholder
contract is unpinned (the copy test gates key presence, not content).

## Current state

- `frontend/src/components/LiveRankingPanel.tsx:35-56` — `UpdatedAgoLabel`
  (memo'd) sets `textContent` to `liveRanking.updatedAgo` every
  `intervalMs` while running (`aria-live="off"`); rendered at line 250.
  It ticks even at 0-2s elapsed — pure churn.
- `frontend/src/App.tsx:543-570` — `lastProgressAgeMs` +
  `runningHealthMessage` (normal/slow/stalled via
  `computeStallThresholds(status.timeout_sec)`) + `lastProgressLabel`
  (`status.lastProgressAgo`, `{{seconds}}`). The label renders in the
  healthy state too, and re-computes every `nowMs` tick.
- `frontend/src/lib/runtime.ts` — `computeStallThresholds` exists
  (verify the exported names; it returns `{ slowMs, stalledMs }`).
- `frontend/src/components/ChartsPanel.tsx:3` — Recharts
  (`BarChart`, `CartesianGrid`, `Tooltip`, `XAxis`, `YAxis`, `Cell`) with
  default styling; `ResolverDetailModal` may also chart (check).
- `frontend/src/lib/i18n-translations.ts:26-31` — the verdict/reason
  templates (`{{id}}`, `{{provider}}`, `{{pct}}`, `{{ms}}`, `{{count}}`,
  `{{total}}`, `{{delta}}`).
- `frontend/src/lib/i18n.copy.test.ts` — "i18n completeness gate"
  (key parity) + "i18n copy contract gate" (some content assertions at
  line 46 — extend it).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 65ad0a5..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| e2e (port-shifted) | `cd frontend && npx playwright test --reporter=line` | 27 passed |

## Scope

**In scope**:
- `frontend/src/components/LiveRankingPanel.tsx` — staleness-based `UpdatedAgoLabel`
- `frontend/src/App.tsx` — healthy-state suppression of the progress-age label
- `frontend/src/lib/runtime.ts` — a `stalenessState(ageMs, thresholds)` pure helper (testable)
- `frontend/src/lib/runtime.test.ts` — its tests
- `frontend/src/components/ChartsPanel.tsx` (+ `ResolverDetailModal.tsx` if it charts) — Recharts re-skin via the instrument tokens
- `frontend/src/lib/i18n-translations.ts` — new keys (`liveRanking.updatedSlow`, `liveRanking.updatedStalled`, `status.lastProgressSlow/Stalled` variants if needed) ×3 locales
- `frontend/src/lib/i18n.copy.test.ts` — verdict/reason placeholder-pinning cases
- `frontend/src/styles.css` — chart/readout styles (tooltip, ticks) via the tokens

**Out of scope** (do NOT touch):
- The health-message tri-state logic (already good) — only the counter's visibility changes
- The verdict templates' wording (pinning is about placeholders, not copy edits)
- Backend, i18n key removal (keep `liveRanking.updatedAgo`/`status.lastProgressAgo` — still used by the stale variants)

## Git workflow

- Branch: `plan/043-revamp-polish`
- Commits: `feat(ui): state-based staleness readouts`, `feat(charts): instrument re-skin of chart components`, `test(i18n): pin verdict template placeholders`. Merge commit: `merge: plan 043 — revamp polish`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Staleness state helper

`frontend/src/lib/runtime.ts` — add (near `computeStallThresholds`):

```ts
export type StalenessState = 'fresh' | 'slow' | 'stalled'
export function stalenessState(ageMs: number | null, thresholds: { slowMs: number; stalledMs: number }): StalenessState {
  if (ageMs === null) return 'fresh'
  if (ageMs > thresholds.stalledMs) return 'stalled'
  if (ageMs > thresholds.slowMs) return 'slow'
  return 'fresh'
}
```

`frontend/src/lib/runtime.test.ts` — table tests: null → fresh; boundary
values at slowMs/stalledMs (exclusive/inclusive per the helper); the three
states.

**Verify**: `cd frontend && npx vitest run src/lib/runtime.test.ts` → all pass.

### Step 2: Staleness-based `UpdatedAgoLabel`

Rewrite `UpdatedAgoLabel` (LiveRankingPanel.tsx:35-56):
- Compute `state = stalenessState(ageMs, thresholds)` on each timer tick
  (thresholds: `slowMs = 3 × intervalMs`, `stalledMs = 10 × intervalMs`
  — pick sensible constants, document them).
- `fresh` → render **nothing** (empty span; stop the interval — no timer
  churn while healthy).
- `slow` → `liveRanking.updatedSlow` ("no update in {{seconds}}s" — amber,
  `--accent-live`).
- `stalled` → `liveRanking.updatedStalled` (red, `--bad`).
- Keep `aria-live="off"` and the memo.
- The elapsed text uses the existing seconds formatting; add the two new
  keys to all three locales.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0.

### Step 3: Suppress the healthy progress-age counter

`frontend/src/App.tsx` — `lastProgressLabel` renders only when the health
state is NOT normal (i.e. only `slow`/`stalled`); while healthy, the
label is absent (the status dot + health message carry liveness). Adjust
the i18n so the slow/stalled variants read diagnostically
(`status.lastProgressSlow`, `status.lastProgressStalled` — "last progress
{{seconds}}s ago (slow)"-class copy), keeping `status.lastProgressAgo`
for the stale case if useful.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0.

### Step 4: Charts re-skin

`ChartsPanel.tsx` (and `ResolverDetailModal.tsx` if it renders Recharts):
- Axis ticks: `tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--ink-muted)' }}`.
- Grid: `stroke="var(--hairline)"`, `strokeDasharray` minimal or none.
- Series colors from the tokens: primary series `var(--accent-active)`,
  comparisons use the token set (`--ok`, `--bad`, `--accent-live`).
- Tooltip: `contentStyle={{ background: 'var(--panel-raised)', border: '1px solid var(--hairline)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)' }}`
  (the "instrument readout" tooltip); label styles in the same language.
- Any chart container styles in `styles.css` (`.chart-*`) aligned to the
  scale (Caption/Data tiers).

**Verify**: `cd frontend && npm run build` → exit 0; charts render with
the token styling (screenshot `instrument-charts.png` into
`docs/screenshots/`).

### Step 5: Verdict-template pinning

`frontend/src/lib/i18n.copy.test.ts` — extend the copy-contract gate:
for each `quick.verdict.*` and `quick.reason.*` key, assert the ES source
contains exactly the documented placeholder set AND that EN/PT preserve
the same placeholders (extract `{{...}}` occurrences and compare sets
across locales). This pins the templates so a translation can't drop a
placeholder silently.

**Verify**: `cd frontend && npx vitest run src/lib/i18n.copy.test.ts` → all pass (existing + new cases).

### Step 6: Gates

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; e2e (port-shifted) → 27 passed; `git status` shows only in-scope files.

## Test plan

- `runtime.test.ts` — the `stalenessState` table.
- `i18n.copy.test.ts` — the placeholder-pinning cases.
- Any component behavior worth a unit test (the label's fresh/slow/stalled
  rendering) — add to a LiveRankingPanel-adjacent test if one exists or a
  new small test; prefer the pure-helper + e2e split if component tests
  are heavy (state that choice in NOTES).
- e2e stays green (the labels are `aria-live="off"` and copy-driven
  assertions don't reference them — verify).

## Done criteria

ALL must hold:

- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] e2e — 27 passed (port-shifted if needed)
- [ ] `grep -n "stalenessState" frontend/src/lib/runtime.ts frontend/src/components/LiveRankingPanel.tsx` match
- [ ] `UpdatedAgoLabel` renders empty while fresh (probe or code review): no ticking counter in the healthy state
- [ ] `grep -n "updatedSlow\|updatedStalled" frontend/src/lib/i18n-translations.ts` matches ≥ 3 (ES/EN/PT)
- [ ] Recharts components use the token vars (grep `var(--accent-active)\|var(--hairline)\|var(--panel-raised)` in ChartsPanel.tsx)
- [ ] The copy-contract gate includes the verdict/reason placeholder cases
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 043 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- An e2e assertion references the ticking labels (it must not — if one
  does, STOP rather than edit the spec).
- Recharts re-skin requires a dependency change (it must not — props only).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The staleness constants (3×/10× interval) are tuning knobs; document
  them next to the helper.
- The verdict placeholder-pinning makes the copy contract stronger than
  key-parity — new verdict/reason keys must be added to the pin list too.
- The charts re-skin is the last piece of the Instrument rollout; after
  this, the anti-slop grep gates apply to the charts as well.
