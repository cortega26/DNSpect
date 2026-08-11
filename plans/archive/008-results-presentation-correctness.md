# Plan 008: Make result charts, rank labels, and live-ranking layout truthful

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A reviewer dispatched this plan and maintains the
> index, so do not edit plans/README.md.
>
> **Drift check (run first)**: <code>git diff --stat e09fd2d..HEAD -- frontend/src/components/ChartsPanel.tsx frontend/src/components/ResolverRankingPanel.tsx frontend/src/components/LiveRankingPanel.tsx frontend/src/lib/motion.ts frontend/src/lib/motion.test.ts frontend/src/lib/chartPresentation.ts frontend/src/lib/chartPresentation.test.ts</code>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug, perf, tests
- **Planned at**: commit <code>e09fd2d</code>, 2026-08-10
- **Merged**: `f58b8b8`, 2026-08-10

## Why this matters

The comparison views currently encode some measurements with the wrong visual
direction: lower reliability and lower blocking efficacy receive the favorable
color, while higher blocking is sorted first but still colored unfavorably.
The reliability axis also clips values below 95 percent. Those are
high-confidence result-presentation regressions, not subjective design
preferences, because they can reverse a measurement's apparent meaning.

Rank labels produce malformed values such as #44 after the third result, and
the live ranking reads layout geometry even when its own motion policy disables
reorder animation. This plan makes the metric semantics explicit, fixes the
rank text, and removes unnecessary layout work while retaining current chart
lazy loading and styling.

## Current state

- frontend/src/components/ChartsPanel.tsx — Recharts rendering and metric
  sorting/coloring.
- frontend/src/components/ResolverRankingPanel.tsx — compact final rank list.
- frontend/src/components/LiveRankingPanel.tsx — live rows and FLIP-style
  reorder animation.
- frontend/src/lib/motion.ts — pure live-motion budget policy.
- frontend/src/lib/motion.test.ts — current policy regression tests.
- frontend/src/App.tsx — retains the ChartsPanel lazy import; read-only for
  this plan.

The chart color helper always treats lower numeric values as better:

    # frontend/src/components/ChartsPanel.tsx:37-44
    const thresholdLow = sortedValues[Math.floor(sortedValues.length / 3)]
    const thresholdHigh = sortedValues[Math.floor((sortedValues.length * 2) / 3)]
    if (value <= thresholdLow) return 'var(--success)'
    if (value <= thresholdHigh) return 'var(--warning)'
    return 'var(--danger)'

Reliability is sorted ascending, whereas blocking is sorted descending:

    # frontend/src/components/ChartsPanel.tsx:89-114
    reliability value = success_rate * 100
    blocking value = blocking_efficacy * 100
    ...
    chartView === 'blocking'
      ? descending value
      : ascending value

Both use the same lower-is-better color helper. A reliability score of 80 is
therefore green and 100 red; a blocking score of 100 can be first in the
chart but red. The reliability Y axis hides values below 95:

    # frontend/src/components/ChartsPanel.tsx:173-181
    domain={chartView === 'reliability' ? [95, 100]
      : chartView === 'blocking' ? [0, 100] : ['auto', 'auto']}
    ...
    fill={performanceColor(entry.value, sortedValues)}

The ranking component includes the index twice for ranks after three:

    # frontend/src/components/ResolverRankingPanel.tsx:31-40
    const rankLabel = index === 0 ? '#' : index === 1 ? '#' :
      index === 2 ? '#' : '#' + (index + 1)
    <span className="ranking-rank">{rankLabel}{index + 1}</span>

Live ranking computes a bounding rectangle for every row before checking the
already-derived policy:

    # frontend/src/components/LiveRankingPanel.tsx:172-193
    for (const row of ranking) {
      const node = rowElementRef.current.get(row.ip)
      if (!node) continue
      nextTopMap.set(row.ip, node.getBoundingClientRect().top)
    }
    if (!allowReorderAnimation) {
      previousTopRef.current = nextTopMap
      return
    }

    # frontend/src/lib/motion.ts:13-17
    const isMotionBudgetExceeded = rowCount > normalizedBudget
    const allowReorderAnimation = !prefersReducedMotion && !isMotionBudgetExceeded

Existing conventions to preserve:

- ChartsPanel must remain lazily imported with React.lazy from
  frontend/src/App.tsx:12. Do not import Recharts into App or a new main-chunk
  helper.
- Results are measurement outputs. Sort, scale, and color choices must
  describe the metric rather than make a recommendation based on brand or
  geography.
- Plan 009 owns i18n. Do not expand this plan into the existing hard-coded
  Failure rate, Score, or Bloqueo copy work.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused presentation tests | <code>cd frontend && npm test -- chartPresentation.test.ts motion.test.ts</code> | Exit 0; metric direction and motion-policy tests pass. |
| Typecheck | <code>cd frontend && npm run typecheck</code> | Exit 0 with no TypeScript errors. |
| Full frontend tests | <code>cd frontend && npm test</code> | Exit 0; all Vitest tests pass. |
| Lint/build | <code>cd frontend && npm run lint && npm run build</code> | Exit 0; lint and production build pass. |

## Suggested executor toolkit

- Use CodeGraph, if available, to check all imports of ChartsPanel and
  resolveLiveMotionPolicy before extracting pure helpers.
- Do not add a React component test library merely to test numeric ordering.
  Keep chart semantics in a pure module with Vitest coverage.

## Scope

**In scope** (the only files you should modify):

- frontend/src/components/ChartsPanel.tsx
- frontend/src/components/ResolverRankingPanel.tsx
- frontend/src/components/LiveRankingPanel.tsx
- frontend/src/lib/motion.ts
- frontend/src/lib/motion.test.ts
- frontend/src/lib/chartPresentation.ts (new)
- frontend/src/lib/chartPresentation.test.ts (new)

**Out of scope** (do NOT touch, even though they look related):

- plans/README.md — the reviewer maintains the plan index.
- frontend/src/App.tsx — keep its existing lazy ChartsPanel boundary; inspect
  it but do not rewrite App in this plan.
- Translation keys and literal-label localization — plan 009 owns those.
- Ranking/scoring algorithm, recommendation guardrails, result API fields, or
  provider data. This plan only presents existing measurements correctly.
- The live-ranking visual design, animation duration, and rank-quality formula
  except where a geometry-read guard is needed.
- Browser test harness setup — plan 010 owns it.

## Git workflow

- Branch: <code>advisor/008-results-presentation-correctness</code>
- Use conventional commits, for example
  <code>fix(results): align chart color direction with metric semantics</code>.
- Keep pure semantic helpers/tests separate from component consumption and the
  live-layout guard. Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Encode metric direction and safe domains in a pure helper

Create frontend/src/lib/chartPresentation.ts. It must expose a small typed
metric-definition contract for median, p95, reliability, and blocking:

- Median and p95 are lower-is-better, sort ascending, and retain an automatic
  numeric axis.
- Reliability and blocking are higher-is-better, sort descending, and use a
  non-clipping 0-to-100 percentage axis.
- Null/non-finite values are omitted before sorting/coloring.
- Equal values use a deterministic resolver tie-breaker, so chart order does
  not depend on incidental engine order.
- Color tiers receive the direction as input: for a three-or-more value set,
  best is success, middle is warning, and worst is danger; small data sets use
  the neutral accent as today.

Do not put translation text or Recharts imports in the helper. Unit-test all
four metric definitions and the two color directions. Include the concrete
regressions: median 10 versus 30, reliability 80 versus 100, blocking 20
versus 100, a value below 95, ties, nulls, and two-row neutral behavior.

**Verify**: <code>cd frontend && npm test -- chartPresentation.test.ts</code> → exit 0; tests show 100 percent reliability/blocking as favorable and 80 percent reliability as unfavorable.

### Step 2: Render charts from the tested metric contract

Refactor ChartsPanel to obtain value extraction, comparator, color direction,
and Y-axis domain from chartPresentation.ts. Preserve top-N selection before
metric sorting, provider/DNS labels, tooltip data, empty state, responsive
container, and lazy component boundary. For reliability use the full 0-to-100
domain; do not silently clip poor data to make the chart look better.

Do not alter the hard-coded tooltip label in this step; plan 009 will
internationalize it. Confirm only ChartsPanel imports Recharts for this chart
path and App still contains its React.lazy import.

**Verify**: <code>cd frontend && npm run typecheck && npm test -- chartPresentation.test.ts</code> → exit 0; helper tests and TypeScript compilation pass.

### Step 3: Render one rank number per ranking row

Simplify ResolverRankingPanel so the visible rank is generated once from
index plus one. It must render #1 through #N exactly once, including #4 and
#5, without changing result ordering, protocol badges, click behavior, or
the still-out-of-scope localized meta labels.

Add a focused assertion to chartPresentation.test.ts only if rank formatting
is extracted there; otherwise add a small new pure formatter in the same
module and test #1, #3, #4, and #12. Do not use a screenshot as the sole
regression test.

**Verify**: <code>cd frontend && npm test -- chartPresentation.test.ts && rg -n "rankLabel.*index" frontend/src/components/ResolverRankingPanel.tsx</code> → tests pass and the old conditional/double-concatenation pattern is absent.

### Step 4: Skip live-layout reads whenever animation is disallowed

Restructure the useLayoutEffect in LiveRankingPanel so it returns before
calling getBoundingClientRect when allowReorderAnimation is false. Clear or
invalidate the previous geometry map while disabled. When animation becomes
allowed again, measure once to seed current geometry and suppress a transition
from stale disabled-mode coordinates; then resume the existing FLIP behavior.

If a pure boolean helper is needed to make the state transition testable, add
it to motion.ts and extend motion.test.ts. Tests must cover both budget-exceeded
and reduced-motion policies. Do not change the policy that disables highlights
only for an over-budget list unless a separate requirement calls for it.

**Verify**: <code>cd frontend && npm test -- motion.test.ts && npm run lint</code> → exit 0; budget and reduced-motion cases retain disabled reorder animation.

### Step 5: Run complete gates and inspect the lazy boundary

Run the full frontend gate and ensure the production build still code-splits
the chart implementation. Inspect the source import rather than adding
Recharts to a utility or App.

**Verify**: <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run build && rg -n "const ChartsPanel = lazy" src/App.tsx</code> → all commands exit 0 and the lazy import is found.

## Test plan

- Add chartPresentation.test.ts for sort direction, best/worst colors, percent
  domains, null filtering, deterministic tie ordering, and full 0-to-100
  reliability visibility.
- Extend motion.test.ts for any new geometry-measurement guard predicate and
  retain existing over-budget/reduced-motion behavior.
- Add rank-format regression coverage through a pure formatter; include #4 so
  the duplicate-digit bug cannot return.
- Use existing motion.test.ts as the structure for a small policy-level test.
- Verification: <code>cd frontend && npm test -- chartPresentation.test.ts motion.test.ts && npm test</code> → all tests pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Median/p95 chart values are ascending and lower-is-better colored.
- [ ] Reliability and blocking values are descending and higher-is-better
  colored; reliability data below 95 is visible on a 0-to-100 domain.
- [ ] Final ranking renders #1 through #N with no duplicate numeric suffix.
- [ ] LiveRankingPanel does not call getBoundingClientRect when the policy
  disables reorder animation, including reduced-motion mode.
- [ ] <code>cd frontend && npm test -- chartPresentation.test.ts motion.test.ts</code> exits 0 with the stated regressions.
- [ ] <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run build</code> exits 0.
- [ ] <code>rg -n "const ChartsPanel = lazy" frontend/src/App.tsx</code> finds the existing lazy boundary.
- [ ] No files outside the in-scope list are modified; plans/README.md is
  unchanged.

## STOP conditions

Stop and report back (do not improvise) if:

- A backend/product owner says lower score is favorable for reliability or
  blocking, or the incoming fields do not mean success rate and blocking
  efficacy on a 0-to-1 scale. That would invalidate the presentation contract.
- A new result type exposes a different unit/range without a documented chart
  metric definition.
- Moving the geometry guard would break a verified animation transition and
  requires a new animation-product decision rather than a one-time reseed.
- The ChartsPanel import is no longer lazy or touching it requires moving
  Recharts into a main-chunk module.
- The code has drifted so rank/animation ownership lies outside the in-scope
  components, or a required fix touches an out-of-scope file.

## Maintenance notes

- Every new chart metric must declare unit, sort direction, favorable
  direction, null handling, and axis domain in chartPresentation.ts before it
  is rendered.
- Reviewers should verify semantic colors against the raw measurement values,
  not against the visual order alone.
- Keep visual copy changes out of metric semantics. Plan 009 owns localization,
  and plan 010 can add browser-level regression coverage once its harness
  exists.
