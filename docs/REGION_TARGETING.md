# Region targeting and egress policy

Decision record for the approved region-targeting and automatic-location
semantics. Approved on 2026-08-11 by the product/architecture owner (Carlos
Ortega) as the written answer to the plan-004 decision gate.

## Region semantics

- A region choice is a **Target Profile constraint**: it replaces the selected
  resolver set with the set derived from the normalized target scope and is
  recorded in the plan-003 `target_snapshot` sent with the benchmark. The
  visible selected set and the measured resolver array are always the same
  collection.
- A region choice never mutates a scoring profile (plan-003 separation).
- Supported target-scope values are the closed union `global`, `europe`,
  `south-america`, `north-america`, `asia`, `all`, and `unknown`:
  - `all` means every eligible catalog provider plus detected system DNS.
  - `global` means providers tagged global plus detected system DNS.
  - `unknown` is the safe fallback; it behaves as `all` for selection purposes
    and is never passed to a catalog region filter.
  - A raw ISO country code (for example `CL` or `US`) is **not** a valid
    target scope and must never reach a catalog filter or the target
    snapshot.
- `auto` is a *source* of a scope, not a catalog label. Automatic detection
  applies only while no manual scope has been selected.

## Manual changes

- When a user changes the region chip, the UI **replaces** the selected
  resolver set with the scope-derived set (catalog providers for that scope,
  globals, and detected system DNS), even if resolvers were toggled manually
  beforehand. A later manual resolver toggle deviates the set and is recorded
  as a manual selection.
- Region changes are disabled while a benchmark is active.
- Available manual choices come from the approved, catalog-supported scope
  union only. Oceania and Africa are not offered because the current catalog
  has no targets for them; this is an explicit product-scope decision, not a
  hidden defect.

## Automatic egress location

- Automatic egress detection **is permitted** with this exact data flow:
  1. One request to `https://api.ipify.org?format=json` (no other data leaves
     the device; no query parameters beyond `format=json`), with a 5-second
     timeout and an `AbortSignal` path.
  2. One request to the local backend `/api/geoip?ip=<ip>` with an
     `AbortSignal` path. Only the backend-normalized `region` field is
     consumed; the `country_code` field is never used to choose a target
     scope.
- No caching, no retries, no additional third-party endpoints.
- Egress resolution is best-effort and non-blocking: it never delays the
  initial providers/system-DNS rendering, and a late result is applied only if
  the component is still mounted and the user has not chosen a manual scope.
- Fallback behavior:
  - Unknown/absent/failed/aborted egress → scope `unknown` (behaves as `all`).
  - Known egress scope with catalog targets → that scope.
  - Known egress scope with **no** catalog targets → `global` semantics
    (globals plus detected system DNS).

## Future catalog additions

Any future catalog expansion that adds regional targets requires a product
decision on whether the supported target-scope union and manual chip list
change. Existing runs keep the snapshot actually measured; historical
comparisons never reinterpret old snapshots with new scopes.
