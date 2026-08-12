# Plan 034: Session and egress hardening (error clear, backoff reset, selection clobber, region vocabulary)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 930dfb6..HEAD -- frontend/src/hooks/useProtocolComparison.ts frontend/src/hooks/useProtocolComparison.test.ts frontend/src/App.tsx frontend/src/lib/egress.ts frontend/src/lib/egress.test.ts frontend/src/lib/targetScope.ts frontend/src/lib/targetScope.test.ts backend/app/geoip.py backend/tests/test_geoip.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness (deep-reaudit findings 4, 5, 23)
- **Planned at**: commit `930dfb6`, 2026-08-13

## Why this matters

Three small races/gaps from the deep reaudit: (1) `useProtocolComparison`
never clears a transient poll error — a single dropped poll leaves a
permanent error message under a comparison that completed fine — and its
backoff counter leaks across sessions (a session that ended after 4 errors
starts its successor retrying at 8s/16s/30s); plan 028 fixed this exact
pattern in `useBenchmarkSession` and the sibling hook was left behind.
(2) The approved egress flow can clobber a manual resolver selection made
during the ~5s resolution window: the `isCurrent` guard checks only the
scope source, not whether the user edited the resolver set. (3) `geoip.py`
emits `oceania`/`africa` regions that `targetScope.ts` maps to `unknown` —
the automatic flow silently skips region targeting for those IPs.

## Current state

- `frontend/src/hooks/useProtocolComparison.ts:126-135` — success path:
  `setComparison(next); setComparisonLoading(false); consecutiveErrorsRef.current = 0`
  — `comparisonError` is never cleared. `start()` (184-204) clears it only on
  a new start. `consecutiveErrorsRef` is not reset in `start()`/`clear()`.
  Contrast `useBenchmarkSession.ts` (the 028 pattern): `pollFailedRef` +
  `setError(null)` on recovery.
- `frontend/src/App.tsx:333-339` — egress write-back:
  `resolveEgressScope({ ..., isCurrent: () => scopeSourceRef.current === 'auto' })`
  then `setSelectedResolvers(new Set(deriveTargetResolvers(...)))`.
  `toggleResolver` (`App.tsx:799-806`) and `handleScopeSelect` mutate
  `selectedResolvers`/scope without touching `scopeSourceRef`; the egress
  result applies up to ~5s after the UI is interactive.
- `backend/app/geoip.py:246-317` — `_country_to_region` maps AU/NZ/FJ… to
  `"oceania"` and 40+ African countries to `"africa"`.
  `frontend/src/lib/targetScope.ts:3` — `CATALOG_SCOPES` is
  `['global', 'europe', 'south-america', 'north-america', 'asia']`;
  `normalizeScopeFromRegion` returns `'unknown'` for oceania/africa.
  `docs/REGION_TARGETING.md` records the explicit product decision:
  Oceania/Africa are not offered because the catalog has no targets.
- Tests: `egress.test.ts` covers the superseded-scope path (scope changes),
  not resolver edits; `useProtocolComparison.test.ts` has no
  fail-then-recover poll sequence; `test_geoip.py` asserts the current
  country→region table.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 930dfb6..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Frontend tests | `cd frontend && npx vitest run src/hooks/useProtocolComparison.test.ts src/lib/egress.test.ts src/lib/targetScope.test.ts` | all pass |
| Backend tests | `cd backend && . .venv/bin/activate && pytest tests/test_geoip.py -q` | all pass |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| Full backend gate | `make backend-check`     | exit 0 |

## Scope

**In scope**:
- `frontend/src/hooks/useProtocolComparison.ts` — error clear + backoff reset
- `frontend/src/hooks/useProtocolComparison.test.ts` — the recover sequence
- `frontend/src/App.tsx` — egress write-back guard (selection-version ref)
- `frontend/src/lib/egress.ts` / `egress.test.ts` — only if the guard
  belongs there (prefer App-level ref; move only if a helper is extracted)
- `backend/app/geoip.py` — region vocabulary alignment
- `backend/tests/test_geoip.py` — updated expectations

**Out of scope** (do NOT touch, even though they look related):
- The other session hooks (026/028 fixes stay as they are).
- `targetScope.ts`'s `unknown → all` fallback semantics (unchanged).
- The catalog/scope union decision itself (documented in
  `docs/REGION_TARGETING.md` — this plan makes the code match it).
- Frontend i18n for new scope labels (none needed — option (b) below).

## Git workflow

- Branch: `plan/034-session-egress-hardening`
- Commits: `fix(session): clear transient comparison errors and reset backoff on start`, `fix(egress): never clobber a manual resolver selection`, `fix(geoip): map unsupported regions to None per region policy`. Merge commit: `merge: plan 034 — session and egress hardening`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Error clear + backoff reset in `useProtocolComparison`

Mirror the `useBenchmarkSession` pattern (read it first — `pollFailedRef`
was added by plan 028):
1. Add `const pollFailedRef = useRef(false)`; set true in the poll catch
   (alongside the error increment), and on the success path:
   `if (pollFailedRef.current) { setComparisonError(null); pollFailedRef.current = false }`.
2. Reset `consecutiveErrorsRef.current = 0` at the top of `start()` and in
   `clear()`.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0.

### Step 2: Test the recover sequence

`useProtocolComparison.test.ts` — add `transient poll error clears and backoff resets on recovery`: mock `getProtocolComparisonStatus`-style api to reject once then resolve; assert `comparisonError` set, then cleared after the successful poll, and a subsequent `start()` begins polling at the base cadence (not the inflated backoff). (Check the hook's actual api call name and test file structure first; adapt.)

**Verify**: `cd frontend && npx vitest run src/hooks/useProtocolComparison.test.ts` → all pass.

### Step 3: Egress must not clobber manual selection

`frontend/src/App.tsx`:
1. Add `const selectionVersionRef = useRef(0)`; bump it in every place that
   mutates the resolver set outside the egress write-back itself:
   `toggleResolver`, `handleScopeSelect`, and any bulk setter (find them
   via grep of `setSelectedResolvers`).
2. Change the egress `isCurrent` guard to also require the selection
   version unchanged since egress started:
   ```tsx
   const selectionVersionAtStart = selectionVersionRef.current
   resolveEgressScope({ ..., isCurrent: () =>
       scopeSourceRef.current === 'auto' &&
       selectionVersionRef.current === selectionVersionAtStart })
   ```
   (the fallback — skip write-back — already matches the "unknown" path).
3. If a helper extraction in `egress.ts` makes this testable there, prefer
   it; otherwise test at the App level via the existing e2e or a new
   `egress.test.ts` case for the guard combinator.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0.

### Step 4: Region vocabulary alignment (option (b))

`backend/app/geoip.py` — in `_country_to_region`, return `None` (or map to
no region) for the `oceania` and `africa` sets instead of emitting regions
the product does not support (per `docs/REGION_TARGETING.md`: the scopes are
not offered; a GeoIP result for them must degrade consistently to the
`unknown` fallback, not a phantom scope). Update `backend/tests/test_geoip.py`
expectations accordingly (the AU/AF country entries now yield the no-region
outcome). Do NOT touch `targetScope.ts` — its `unknown → all` fallback is
the intended consumer.

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_geoip.py -q` → all pass.

### Step 5: Gates

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; `make backend-check` → exit 0.

## Test plan

- `useProtocolComparison.test.ts` — the recover/backoff-reset case.
- `egress.test.ts` (or App-level) — the selection-version guard.
- `test_geoip.py` — updated region expectations.
- Existing suites stay green.

## Done criteria

ALL must hold:

- [ ] `cd frontend && npx vitest run src/hooks/useProtocolComparison.test.ts src/lib/egress.test.ts src/lib/targetScope.test.ts` — all pass
- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_geoip.py -q` — all pass
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `make backend-check` exits 0
- [ ] `grep -n "pollFailedRef\|setComparisonError(null)" frontend/src/hooks/useProtocolComparison.ts` matches
- [ ] `grep -n "selectionVersionRef" frontend/src/App.tsx` matches ≥ 2 (bump sites + guard)
- [ ] `grep -n '"oceania"\|"africa"' backend/app/geoip.py` returns no matches (unsupported regions no longer emitted)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 034 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any code at the "Current state" locations doesn't match the excerpts.
- `geoip.py`'s region table is consumed elsewhere (frontend region filter,
  docs) in a way that makes removing oceania/africa a behavior break beyond
  the egress flow — check `grep -rn "oceania" frontend/src backend/app`
  first; if a real consumer exists, STOP and report.
- The egress guard's `isCurrent` combinator is already partially handled in
  `egress.ts` (read it first) — adapt; if the design requires moving the
  write-back out of App.tsx, STOP and report.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If the catalog ever gains Oceania/Africa targets (the region-policy
  decision would be revisited), the geoip mapping returns alongside the new
  `CATALOG_SCOPES` entries — both changes in one plan, with i18n.
- The `pollFailedRef` pattern is now the established idiom in both session
  hooks; any future polling hook should copy it.
- The egress guard is a deliberate asymmetry: scope-source changes still
  apply (the `auto` check), resolver-set edits now win. Document this in
  `docs/REGION_TARGETING.md` if the behavior proves surprising.
