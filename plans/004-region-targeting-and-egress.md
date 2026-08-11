# Plan 004: Make target-region selection use one normalized scope and an approved egress signal

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A reviewer dispatched this plan and maintains the
> index, so do not edit plans/README.md.
>
> **Drift check (run first)**: <code>git diff --stat e09fd2d..HEAD -- AGENTS.md plans/003-profile-target-model.md frontend/src/App.tsx frontend/src/components/DashboardControls.tsx frontend/src/lib/api.ts frontend/src/lib/types.ts frontend/src/lib/utils.ts frontend/src/lib/targetScope.ts frontend/src/lib/targetScope.test.ts frontend/src/lib/egress.ts frontend/src/lib/egress.test.ts docs/REGION_TARGETING.md</code>
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/003-profile-target-model.md
- **Category**: direction, bug, migration
- **Planned at**: commit <code>e09fd2d</code>, 2026-08-10

## Why this matters

The current Region control is internally inconsistent: browser and GeoIP
auto-detection produce country codes, while the provider catalog and the
filter expect catalog-region labels. It also filters only the displayed
controls; the initial selected set contains every provider and the start
payload sends that full set. A user can therefore see a regional choice while
measuring a different, all-provider target set.

This must land only after plan 003 has separated scoring policy from the
immutable target snapshot. It will make a region choice a clearly documented
target-selection input and make automatic egress detection best-effort,
non-blocking, and privacy-policy-approved. It deliberately does not turn
continents into recommendations or expand the resolver catalog.

## Current state

- AGENTS.md — governing product constraints. It both prohibits
  continent-based grouping and puts Region filter after Target Profiles on the
  roadmap; this contradiction requires a product decision before code changes.
- plans/003-profile-target-model.md — prerequisite contract for an
  independent scoring profile and immutable target snapshot.
- frontend/src/App.tsx — owns initialization, selected resolver state,
  region state, and benchmark payload construction.
- frontend/src/components/DashboardControls.tsx — renders region chips and
  receives a presentation-level region callback.
- frontend/src/lib/utils.ts — detects a locale country code but filters by a
  catalog-region string.
- frontend/src/lib/api.ts — obtains a third-party public IP and asks the local
  API for GeoIP.
- backend/app/geoip.py — existing backend mapping returns a normalized region
  compatible with the catalog; it is read-only for this plan.

The repository contains an unresolved policy conflict:

    # AGENTS.md:16-18,31-37
    Profiles: User Profiles (ranking policy) and Target Profiles
    (resolver selection) are independent. Never conflate.
    ...
    No continent-based grouping ...
    ...
    Target Profiles → Region filter → DoH/DoT comparison ...

Auto detection produces a country code, but filtering compares that value
directly with catalog labels:

    # frontend/src/lib/utils.ts:11-17,25-28
    const locale = new Intl.Locale(navigator.language)
    return locale.region || null
    ...
    return providers.filter((p) =>
      p.region === region || p.region === 'global' || p.id === 'isp-detectado')

The same mismatch is repeated after external IP lookup:

    # frontend/src/App.tsx:291-319
    providersRes.forEach((p) => p.dns.forEach((ip) => defaults.add(ip)))
    ;(dnsRes?.resolvers ?? []).forEach((ip) => defaults.add(ip))
    setSelectedResolvers(defaults)
    ...
    const publicIp = await getPublicIp()
    const geo = await lookupGeoIp(publicIp)
    if (geo.country_code && !cancelled) setDetectedRegion(geo.country_code)

The rendered provider list changes, but the benchmark request is still built
from the pre-existing complete selection:

    # frontend/src/App.tsx:439-443,757-765,1225-1228
    const effectiveRegion = regionOverride ?? detectedRegion
    const regionFilteredProviders = providersByRegion(goalFilteredProviders, effectiveRegion)
    ...
    resolvers: Array.from(selectedResolvers)
    ...
    onRegionChange={setRegionOverride}

The chip list contains global, Europe, South America, North America, and Asia:

    # frontend/src/components/DashboardControls.tsx:194-223
    ['global', 'europe', 'south-america', 'north-america', 'asia']

Oceania and Africa are intentionally not treated as a bug in this plan. The
current catalog has records only for global, Europe, South America, North
America, and Asia; adding regions or providers is a separate catalog/product
decision. The backend GeoIP map has more labels, which is another reason the
supported target-scope namespace must be explicit.

The existing GeoIP endpoint already returns a catalog-style region:

    # backend/app/geoip.py:60-65
    return {
        "country_code": ...,
        "country_name": ...,
        "region": _country_to_region(country.get("iso_code") or ""),
        "city": ...,
    }

The external public-IP lookup has a timeout, whereas the local GeoIP lookup
does not accept a signal:

    # frontend/src/lib/api.ts:41-55
    lookupGeoIp(ip) fetches /api/geoip?ip=<encoded ip>
    getPublicIp() fetches https://api.ipify.org?format=json
    with AbortSignal.timeout(5000)

Conventions to preserve:

- Plan 003 target snapshots are measurement metadata; a region choice must
  never mutate a scoring profile or make an unrecorded target change.
- A failed optional egress lookup must not delay initial providers/system-DNS
  rendering or turn an unknown location into a false regional assertion.
- Recharts stays lazy-loaded; do not introduce heavy mapping or GeoIP
  dependencies into the main frontend chunk.
- Spanish is the translation source. This plan does not add copy; plan 009
  owns the user-facing localization contract.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prerequisite check | <code>git log -1 --oneline -- plans/003-profile-target-model.md && test -f docs/PROFILE_MODEL.md</code> | Plan 003 is present and its decision record exists. |
| Backend GeoIP contract | <code>cd backend && pytest -q tests/test_geoip.py</code> | Exit 0; country-to-region and invalid-IP cases pass. |
| Focused target tests | <code>cd frontend && npm test -- targetScope.test.ts egress.test.ts</code> | Exit 0; all new scope and egress cases pass. |
| Frontend typecheck | <code>cd frontend && npm run typecheck</code> | Exit 0 with no TypeScript errors. |
| Frontend tests | <code>cd frontend && npm test</code> | Exit 0; all Vitest tests pass. |
| Frontend quality/build | <code>cd frontend && npm run lint && npm run build</code> | Exit 0; lint and production build pass. |

## Suggested executor toolkit

- Use CodeGraph, if available, to trace DashboardControls through App to
  startBenchmark before changing selection ownership.
- Read the approved decision recorded in docs/REGION_TARGETING.md before
  writing the egress request. Do not infer an acceptable third-party endpoint
  or consent model.

## Scope

**In scope** (the only files you should modify):

- docs/REGION_TARGETING.md (new) — approved vocabulary, egress policy, and
  manual-region-change semantics.
- frontend/src/App.tsx
- frontend/src/components/DashboardControls.tsx
- frontend/src/lib/api.ts
- frontend/src/lib/types.ts
- frontend/src/lib/utils.ts
- frontend/src/lib/targetScope.ts (new) and
  frontend/src/lib/targetScope.test.ts (new) — pure normalization and target
  derivation.
- frontend/src/lib/egress.ts (new) and frontend/src/lib/egress.test.ts (new)
  — cancellable, non-blocking egress-resolution policy adapter.

**Read-only policy/dependency inputs** (inspect, never modify):

- AGENTS.md — contains the contradiction that must be resolved.
- plans/003-profile-target-model.md and docs/PROFILE_MODEL.md — define the
  prerequisite target snapshot vocabulary.
- backend/app/geoip.py and backend/tests/test_geoip.py — existing normalized
  GeoIP contract to consume, not duplicate.
- data/dns_providers.es.json — catalog availability; do not add providers or
  regions in this plan.

**Out of scope** (do NOT touch, even though they look related):

- plans/README.md — the reviewer maintains the plan index.
- Backend scoring/ranking, benchmark execution, or profile compatibility
  fields — plan 003 owns those.
- Backend GeoIP database acquisition, proxy-header trust, or a new third-party
  geo-location service. Escalate those as policy/architecture work instead of
  quietly adding network behavior.
- Translation strings and regional chip wording — plan 009 owns localization.
- Adding Oceania/Africa chips, country catalog data, or providers. The current
  omission is a catalog/product-scope question, not this correctness fix.
- Brand recommendations, privacy-claim validation, and continent-based
  recommendation grouping.

## Git workflow

- Branch: <code>advisor/004-region-targeting-and-egress</code>
- Use the repository conventional-commit style, for example
  <code>feat(targeting): normalize region scope from egress GeoIP</code>.
- Keep the approved decision record, pure target logic, UI wiring, and tests
  in reviewable commits. Do NOT push or open a PR unless the operator asks.

## Steps

### Step 1: Stop for an explicit region and egress policy decision

Before modifying any application file, give the product/architecture owner the
following facts and obtain a written answer:

1. Is a region a Target Profile constraint that changes the resolver snapshot
   sent to a benchmark, or only a catalog-view filter? The implementation must
   not claim one while doing the other.
2. Which normalized target-scope values are allowed? Confirm whether the
   existing catalog labels are acceptable target labels despite the
   no-continent-grouping non-goal, and whether all and global have distinct
   meanings.
3. When a user changes a region after manually toggling resolvers, must the
   UI replace the selection with the scope-derived set, preserve manual
   overrides, or offer an explicit reset? Record one behavior; do not invent
   it.
4. Is automatic egress location permitted? If yes, name the approved
   public-IP mechanism, whether notice/consent is required, what information
   may leave the device, timeout/retry rules, and whether it may be cached.
   If no, auto must remain unknown/all and make no external request.
5. For a known egress scope with no regional catalog entries, should the
   default include globals only or all catalog targets? Confirm this explicitly.

If an owner cannot resolve these questions, stop. Do not create
docs/REGION_TARGETING.md as a speculative decision record.

**Verify**: <code>test -f docs/REGION_TARGETING.md && rg -n "target snapshot|manual|egress|all|global|unknown" docs/REGION_TARGETING.md</code> → after approval, the record contains each term and names the approving owner/date.

### Step 2: Define one normalized target-scope contract after approval

Create docs/REGION_TARGETING.md and frontend/src/lib/targetScope.ts. Model the
approved scope as a closed TypeScript union rather than a free-form string.
Keep these distinctions explicit:

- auto is a source of a scope, not a catalog label.
- all means every eligible catalog provider; global means only providers
  tagged global plus whatever the approved contract says about system DNS.
- A raw ISO country code such as CL or US is not a valid catalog scope.
- An unknown, absent, or unsupported egress result follows the approved safe
  fallback; it must never be passed to providersByRegion as a matching scope.

Put normalization, eligibility filtering, deterministic IP deduplication, and
selected target-snapshot derivation in targetScope.ts. App must call this
single module; do not retain an independent initial all-provider selection
path. Preserve plan 003 separation: scoring-profile changes cannot call the
target-scope derivation unless the approved target-selection operation was
explicitly invoked.

Tests must prove that GeoIP region south-america maps to the same scope as the
manual South America choice, while country code CL alone does not become a
filter value. Include global, all, unknown, duplicate DNS IP, system DNS, and
no-region-provider cases using the approved fallback.

**Verify**: <code>cd frontend && npm test -- targetScope.test.ts</code> → exit 0 with country-code rejection and deterministic target-snapshot cases passing.

### Step 3: Make automatic egress detection approved, cancellable, and non-blocking

Create frontend/src/lib/egress.ts as the sole adapter that implements the
approved policy from step 1. It may call existing getPublicIp and lookupGeoIp
only if the decision explicitly permits that data flow. Pass an AbortSignal
through every fetch added or changed, enforce the approved finite timeout, and
treat abort/failure/no normalized GeoIP region as the approved unknown fallback
without surfacing a benchmark error.

Update api.ts to accept an optional AbortSignal on the relevant helpers. Do
not use GeoIP country_code to choose a target scope: consume the backend
normalized region only. Do not wait for egress enrichment inside the critical
providers/system-DNS initialization path. Render usable controls as soon as
those calls settle, then apply a still-current egress result only if the user
has not selected a manual scope and the component remains mounted.

Unit-test the adapter with injected fake functions: approved success,
country-only response, absent database/empty response, public-IP failure,
abort, and a late response after manual override. Tests must assert no
unbounded promise is required to finish initial rendering.

**Verify**: <code>cd frontend && npm test -- egress.test.ts && npm run typecheck</code> → exit 0; no test permits a country code to reach the catalog filter.

### Step 4: Wire scope changes to the target snapshot, not just presentation

In App, replace unrelated detected-region and override values with approved
source/value state and one derived effective target scope. On initialization,
derive the selected resolver set from that scope using targetScope.ts, then
construct the plan-003 target snapshot at start time from that exact set. A
manual region change must perform the approved selection operation, not only
write an override field.

Update DashboardControls so it receives the normalized scope value and an
explicit callback describing a target-scope change. Disable changes while a
benchmark is active as today. Keep the selected-resolver count and start
helper accurate: they must update from the same set startBenchmark sends. Do
not add unsupported chips; available manual choices must come from approved,
catalog-supported values rather than hard-coded country codes.

Check three concrete flows on the dev server: manual region selection,
automatic normalized GeoIP success, and automatic failure/unknown. In every
case inspect the outgoing benchmark request and confirm its resolver array
equals the visible selected set and plan-003 target snapshot.

**Verify**: <code>cd frontend && npm run lint && npm test -- targetScope.test.ts egress.test.ts</code> → exit 0; selected-set and request-construction tests pass.

### Step 5: Run complete gates and document the boundary

Run all frontend and existing GeoIP tests. In the decision record, state the
approved public-IP exposure and fallback, whether automatic detection is
opt-in, the absence of Oceania/Africa catalog targets, and the rule for future
catalog additions. Confirm the UI still lazily imports ChartsPanel from App;
this plan must not change the main-chunk chart boundary.

**Verify**: <code>cd backend && pytest -q tests/test_geoip.py && cd ../frontend && npm run lint && npm run typecheck && npm test && npm run build</code> → all commands exit 0.

## Test plan

- Add targetScope.test.ts cases for valid normalized catalog regions, raw
  country-code rejection, all versus global, manual override precedence,
  deterministic DNS deduplication, system DNS treatment, and no-local-provider
  fallback.
- Add egress.test.ts cases for approved GeoIP-region success, country-only
  response, public-IP failure, aborted request, unknown location, and a late
  auto result that must not overwrite a manual choice.
- Retain backend/tests/test_geoip.py as the structural contract for the
  backend-produced region field; do not duplicate the country map in
  JavaScript.
- Verification: <code>cd frontend && npm test -- targetScope.test.ts egress.test.ts && npm test</code> → all new and existing tests pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] An approved docs/REGION_TARGETING.md records exact region,
  manual-override, egress, and unknown-fallback semantics.
- [ ] A raw country code cannot reach providersByRegion or the target snapshot;
  tests cover this regression.
- [ ] A manual region change changes the exact selected resolver set that the
  benchmark request and plan-003 target snapshot use.
- [ ] Egress resolution uses only the approved mechanism, has a finite timeout
  and AbortSignal path, and cannot delay initial controls indefinitely.
- [ ] <code>cd backend && pytest -q tests/test_geoip.py</code> exits 0.
- [ ] <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run build</code> exits 0.
- [ ] <code>rg -n "lazy.*ChartsPanel" frontend/src/App.tsx</code> finds the existing lazy boundary.
- [ ] No files outside the in-scope list are modified; plans/README.md is
  unchanged.

## STOP conditions

Stop and report back (do not improvise) if:

- The AGENTS.md non-goal against continent-based grouping and its Region filter
  roadmap item remain unresolved by an authorized product/architecture owner.
- Plan 003 has not landed, its target-snapshot contract differs materially
  from the prerequisite described here, or a target scope would mutate a
  scoring profile.
- The owner has not explicitly approved the public-IP/GeoIP data flow,
  consent/notice, timeout, cache, and fallback behavior.
- Implementing the approved egress path requires modifying backend GeoIP
  acquisition, proxy trust, Flatpak permissions, or an external service not
  named in the decision record.
- The catalog contains no target for a requested scope and the owner has not
  selected the globals-only versus all-targets fallback.
- The live code differs from the excerpts in a way that makes region selection
  or request construction owned by a different module.

## Maintenance notes

- Treat normalized target scope and plan-003 target snapshot as historical
  measurement metadata. If catalog membership changes, old runs must retain
  the snapshot actually measured.
- A future catalog expansion may add regional targets only after the product
  owner decides whether that changes the supported target-scope union and
  manual chip list. Oceania/Africa are explicitly deferred, not hidden defects.
- Reviewers should scrutinize network disclosure, fallback behavior, and
  whether selected count, submitted resolver list, and recorded snapshot are
  exactly the same collection.
