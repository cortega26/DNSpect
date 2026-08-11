# Plan 003: Separate scoring profiles from immutable resolver target snapshots

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- AGENTS.md backend/app/models.py backend/app/runner.py backend/app/stats.py backend/tests frontend/src/App.tsx frontend/src/lib/api.ts frontend/src/lib/types.ts frontend/src/lib/utils.ts frontend/src/components/DashboardControls.tsx docs`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: direction, tech-debt, migration
- **Planned at**: commit `e09fd2d`, 2026-08-10
- **Merged**: `3e3c390`, 2026-08-10

## Why this matters

DNSpect's governing architecture requires User Profiles (ranking policy) and
Target Profiles (resolver selection) to be independent. Today the single
`goal` field controls both the backend scoring weights and the frontend's
selected resolver set. That makes it impossible to benchmark one fixed target
set under two scoring policies, invalidates profile comparison, and makes a
change labelled as a preference silently alter what was measured.

This plan establishes one backward-compatible contract: a scoring profile is
the policy used after measurement, while a target snapshot is the immutable
description of the resolver set that was measured. It deliberately does not
create a saved-profile library or expand geographic selection; those are
separate follow-up concerns.

## Current state

- `AGENTS.md` — repository contract. It says profiles are independent and
  must never be conflated.
- `backend/app/models.py` — FastAPI request schema and current `BenchmarkGoal`
  enum.
- `backend/app/runner.py` — turns requests into `BenchmarkConfig` and stores
  state sent to the API.
- `backend/app/stats.py` — applies goal-specific ranking weights.
- `frontend/src/App.tsx` — owns current goal, resolver selection, and benchmark
  request construction.
- `frontend/src/lib/types.ts` and `frontend/src/lib/api.ts` — frontend API
  contract.

Current policy/target conflation:

```markdown
# AGENTS.md:16-18
- **Profiles**: User Profiles (ranking policy) and Target Profiles (resolver selection) are independent. Never conflate.
```

```python
# backend/app/models.py:67-76
class BenchmarkRequest(BaseModel):
    ...
    mode: BenchmarkMode = BenchmarkMode.standard
    goal: BenchmarkGoal = BenchmarkGoal.speed
    protocol: BenchmarkProtocol = BenchmarkProtocol.udp
```

```python
# backend/app/runner.py:140-148 and 273-297
class BenchmarkConfig:
    resolvers: list[str]
    ...
    goal: str
    protocol: str

return BenchmarkConfig(..., goal=req.goal.value, protocol=req.protocol.value)
```

```python
# backend/app/stats.py:13-25 and 90-92
GOAL_WEIGHTS: dict[str, tuple[float, float, float, float]] = {
    "speed": (0.55, 0.25, 0.10, 0.10),
    ...
}
...
weights = GOAL_WEIGHTS.get(goal or DEFAULT_GOAL, GOAL_WEIGHTS[DEFAULT_GOAL])
```

```tsx
// frontend/src/App.tsx:201-203 and 757-798
const [goal, setGoal] = useState<Goal>('speed')
...
const payload = { mode, goal, protocol, runs, timeout_sec: timeoutSec,
  resolvers: Array.from(selectedResolvers) }
...
function onGoalChange(nextGoal: Goal) {
  setGoal(nextGoal)
  setSelectedResolvers(() => {
    const matching = new Set<string>()
    const filtered = providersByGoal(providers, nextGoal)
    filtered.forEach((p) => p.dns.forEach((ip) => matching.add(ip)))
    systemDns?.resolvers?.forEach((ip) => matching.add(ip))
    return matching
  })
}
```

Existing conventions to preserve:

- Backend request validation uses Pydantic enums and validators in
  `backend/app/models.py`; retain strict bounded inputs and Spanish error
  messages.
- Benchmark result ordering must remain deterministic; use
  `backend/tests/test_ranking_determinism.py` as the structural test pattern.
- Frontend API request construction lives in `frontend/src/lib/api.ts`, while
  `App.tsx` owns async orchestration. Keep the lazy chart imports and current
  polling lifecycle unchanged.
- Frontend type aliases and API payloads are explicit TypeScript interfaces,
  as in `frontend/src/lib/types.ts` and `frontend/src/lib/api.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend focused tests | `cd backend && pytest -q tests/test_stats.py tests/test_ranking_determinism.py tests/test_manager_lifecycle.py tests/test_validation.py` | Exit 0; all focused tests pass. |
| Backend quality gate | `make backend-check` | Exit 0 with Ruff, format check, mypy, Bandit, and pytest passing in a Python 3.13+ project venv. |
| Frontend typecheck | `cd frontend && npm run typecheck` | Exit 0 with no TypeScript errors. |
| Frontend tests | `cd frontend && npm test` | Exit 0; all Vitest tests pass. |
| Frontend quality/build | `cd frontend && npm run lint && npm run build` | Exit 0; lint and production build pass. |

## Suggested executor toolkit

- Use CodeGraph, if available, to inspect callers/impact before renaming any
  request or state field. In particular, inspect `BenchmarkRequest`,
  `BenchmarkState.as_response`, `apply_normalized_scoring`, and `onGoalChange`.
- Use the repository's Python 3.13+ environment. Do not silently make a
  Python 3.11 environment work around the declared project requirement.

## Scope

**In scope** (the only files you should modify):

- `docs/PROFILE_MODEL.md` (new) — concise decision record for the contract
  introduced here.
- `backend/app/models.py`
- `backend/app/runner.py`
- `backend/app/stats.py`
- `backend/tests/test_stats.py`
- `backend/tests/test_ranking_determinism.py`
- `backend/tests/test_manager_lifecycle.py`
- `backend/tests/test_validation.py`
- `frontend/src/App.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/types.ts`
- `frontend/src/lib/utils.ts`
- `frontend/src/components/DashboardControls.tsx`
- New or existing frontend tests under `frontend/src/**` only where they test
  this contract.

**Out of scope**:

- Geographic target filtering and external-IP/GeoIP behavior — handled by
  `plans/004-region-targeting-and-egress.md` after this contract lands.
- Persisted-history sorting and historical UI refresh — handled by
  `plans/005-run-history-integrity.md`, which will build on the fields here.
- A UI for named, syncable, or cloud-stored target profiles. This plan creates
  an immutable per-run snapshot only.
- Changing scoring weights, DNS measurement classification, provider catalog
  data, or recommendation guardrails.
- Removing the legacy request field in the same release; preserve a migration
  window.

## Git workflow

- Branch: `advisor/003-profile-target-model`
- Use the repository's conventional-commit style, for example
  `feat(profile): separate scoring policy from target selection`.
- Keep the decision record, contract migration, and tests in reviewable
  commits. Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Record and ratify the profile vocabulary before changing the API

Create `docs/PROFILE_MODEL.md` with the following implementation decision:

1. `scoring_profile` is the canonical User Profile. Its currently supported
   values are the existing `BenchmarkGoal` values and it affects only scoring.
2. A Target Profile is represented for each run by an immutable
   `target_snapshot` object with exactly `resolver_ips` (the non-empty,
   deduplicated canonical IP strings in submitted order), `selection_source`
   (`manual`, `catalog`, or `system`), and optional `provider_ids` (a mapping
   from a subset of those resolver IPs to unambiguous provider IDs known at
   selection time). A provider-ID key not in `resolver_ips` is invalid. It is
   measurement metadata, not a future live filter.
3. Existing `goal` request payloads remain accepted as a deprecated alias for
   `scoring_profile` for one documented compatibility release. Supplying both
   different values must return a validation error; supplying both equal values
   is valid.
4. The initial UI offers the existing scoring selector and current manual
   resolver selection independently. It does not add persistent named-profile
   storage in this plan.

State why an immutable snapshot is required: rankings can only be compared
when the policy and target set that produced them are known. Link the later
history plan by filename, but do not implement it here.

**Verify**: `test -s docs/PROFILE_MODEL.md && rg -n "scoring_profile|target_snapshot|deprecated" docs/PROFILE_MODEL.md` → each term is present and the file is non-empty.

### Step 2: Add the backward-compatible backend request and state contract

In `backend/app/models.py`, introduce explicit Pydantic types for the scoring
profile and the exact target-snapshot shape above. Keep resolver IP validation
as the authority for the actual measurement targets; target-snapshot metadata
must never bypass or weaken it. Normalize `target_snapshot.resolver_ips` with
the same canonical IP representation and deduplication used by
`BenchmarkRequest.resolvers`; validate that any `provider_ids` key is one of
those normalized IPs.

Add `scoring_profile` as the canonical field and retain `goal` only as the
deprecated compatibility alias. Use a model-level validation path that derives
one effective value and rejects conflicting values. Document the deprecation in
the field description and schema. Do not make a missing snapshot change the
existing default resolver behavior.

Thread the resolved `scoring_profile` and immutable target snapshot through
`BenchmarkConfig` and `BenchmarkState` in `backend/app/runner.py`. Use the
scoring profile exclusively when invoking `apply_normalized_scoring`. Expose
both canonical fields in live responses so later persistence/history work has
one unambiguous response shape. Preserve legacy `goal` in responses for the
compatibility window only if existing frontend/versioned exports require it;
make it exactly equal to `scoring_profile`, never separately mutable.

**Verify**: `cd backend && pytest -q tests/test_validation.py tests/test_stats.py` → exit 0, including new cases for legacy-only, canonical-only, equal-both, and conflicting-both payloads.

### Step 3: Make scoring selection independent in the frontend

In `frontend/src/lib/types.ts` and `frontend/src/lib/api.ts`, model the
canonical request/response fields explicitly. Keep any temporary `goal` alias
at the API boundary rather than allowing two independent frontend state values.

In `frontend/src/App.tsx`, rename the semantic state/callback to reflect
scoring policy (for example `scoringProfile` and `onScoringProfileChange`).
Changing it must not mutate `selectedResolvers`, call `providersByGoal`, or
alter any target-selection state. Build one target snapshot immediately before
`startBenchmark` with the exact `resolver_ips`, `selection_source`, and
unambiguous `provider_ids` shape above from the normalized current selection
and currently known provider associations; the payload's `resolvers` remains
the executable target list.

Update `DashboardControls.tsx` labels and props so users can distinguish
ranking policy from resolver selection. Do not introduce a promise that a
"privacy" scoring profile validates provider privacy claims; that is an
explicit repository non-goal.

**Verify**: `cd frontend && npm run typecheck && npm test` → exit 0. Add a
component or extracted-handler test proving a scoring-profile change preserves
the selected resolver set and a start payload carries the same resolver list
with the requested scoring profile.

### Step 4: Characterize cross-profile determinism and migration behavior

Extend backend tests using the existing fake-measurement pattern in
`backend/tests/test_ranking_determinism.py`. For identical raw samples and an
identical target snapshot, repeated scoring with the same profile must produce
identical ordering and recommendation. A different profile may change scores
or rank ordering, but it must never change the recorded resolver targets.

Add lifecycle/API-shape assertions that canonical profile and target-snapshot
fields survive queued, running, and terminal live responses. Do not assert
persisted history here; that belongs to plan 005.

**Verify**: `cd backend && pytest -q tests/test_stats.py tests/test_ranking_determinism.py tests/test_manager_lifecycle.py` → exit 0 with the new profile/snapshot cases included.

### Step 5: Run complete gates and document the migration boundary

Run both repository quality gates. In the decision record, identify the first
release in which clients may be warned about `goal` deprecation and the future
release only after which removal can be considered. Ensure any API/client
compatibility note says that saved runs from before this plan lack a target
snapshot; they remain readable but cannot claim full profile comparability.

**Verify**: `make backend-check && cd frontend && npm run lint && npm run typecheck && npm test && npm run build` → all commands exit 0.

## Test plan

- In `backend/tests/test_validation.py`, test canonical-only, legacy-only,
  equal canonical/legacy, conflicting canonical/legacy, and malformed target
  snapshot input without weakening resolver validation.
- In `backend/tests/test_stats.py`, assert scoring selects its weights from the
  canonical profile and does not inspect target-snapshot metadata.
- In `backend/tests/test_ranking_determinism.py`, use the existing monkeypatch
  pattern to prove fixed samples plus fixed profile plus fixed target snapshot
  are deterministic regardless of input order.
- In `backend/tests/test_manager_lifecycle.py`, assert the normalized canonical
  fields are exposed in a live response throughout a run.
- Add focused frontend coverage following the current Vitest conventions. It
  must prove changing the scoring selector leaves `selectedResolvers` intact
  and that `startBenchmark` receives the canonical profile and target
  snapshot. If component rendering cannot be tested yet, add a small pure
  helper test now and leave full browser coverage to plan 010.

## Done criteria

- [ ] `docs/PROFILE_MODEL.md` defines independent User and Target Profiles,
  the exact immutable `resolver_ips` / `selection_source` / optional
  `provider_ids` target-snapshot shape, and a legacy `goal` migration window.
- [ ] A canonical `scoring_profile` drives backend scoring; it cannot silently
  change the submitted resolver list.
- [ ] Requests with conflicting `goal` and `scoring_profile` are rejected;
  legacy-only requests remain compatible during the documented window.
- [ ] Live benchmark responses expose the canonical profile and target
  snapshot, with no divergent duplicate values.
- [ ] Tests prove same samples + same profile + same target snapshot are
  deterministic, and a frontend scoring change preserves target selection.
- [ ] `make backend-check` and `cd frontend && npm run lint && npm run typecheck && npm test && npm run build` exit 0.
- [ ] No files outside this plan's in-scope list are modified; `plans/README.md`
  remains coordinator-owned.

## STOP conditions

Stop and report back if any of the following is true:

- The maintainer rejects immutable per-run target snapshots or requires named,
  synchronized target profiles now; that is a product/storage expansion beyond
  this plan.
- The repository's "no continent-based grouping" non-goal is intended to
  remove all regional selection. Plan 004 must then be rewritten as removal,
  not normalization.
- Existing external API consumers cannot tolerate additive canonical fields or
  a deprecated alias window cannot be supported.
- Capturing provider IDs requires treating duplicate catalog IP ownership as
  unambiguous. Complete plan 006 or omit ambiguous provider IDs rather than
  guessing.
- Any proposed change alters scoring weights, recommendation guardrails, or
  raw resolver validation; those are outside this plan.

## Maintenance notes

- Reviewers should ensure `resolvers` is always the actual measurement target,
  while `target_snapshot` is reproducibility metadata. Never re-derive past
  targets from a changed provider catalog.
- Plan 004 should consume the target-profile vocabulary rather than adding a
  second regional-selection representation. Plan 005 must persist and sort
  the canonical fields for historical comparison.
- When the deprecated `goal` field is eventually removed, update all supported
  clients, exports, saved-run migration logic, documentation, and release
  notes together.
