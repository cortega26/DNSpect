# Plan 031: Watch runs must measure the configured target snapshot

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 930dfb6..HEAD -- backend/app/watch.py backend/tests/test_watch.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (deep-reaudit finding 1 — the watch subsystem measures the wrong population)
- **Planned at**: commit `930dfb6`, 2026-08-13

## Why this matters

Every watch run benchmarks the **entire default catalog plus detected system
DNS** instead of the resolvers in the watch's `target_snapshot`. The deep
reaudit found that `WatchScheduler._build_request` passes the snapshot only
as manifest metadata and never sets `resolvers`, so `BenchmarkManager._build_config`
falls back to `default_resolvers + system_dns` (the full ~49-provider set).
The manifest's `target_snapshot` is the tiny configured set while the
measured set is the whole catalog — so manifest equality passes across
cycles (snapshot constant) while the actual measured populations are huge
and drift with system DNS changes. Every threshold alert is computed over
resolvers the user never selected, and the designed "pin its whole
measurement contract" guarantee (`docs/MONITORING_MODE.md:39-47`) is silently
broken. Each tick also wastes minutes of DNS traffic measuring ~45
unrequested providers.

## Current state

- `backend/app/watch.py:419-429` — `WatchScheduler._build_request`:
  ```python
  def _build_request(self, config: dict[str, Any]) -> BenchmarkRequest:
      return BenchmarkRequest(
          mode=BenchmarkMode(config.get("mode") or "quick"),
          scoring_profile=BenchmarkGoal(config.get("scoring_profile") or "speed"),
          protocol=BenchmarkProtocol(config.get("protocol") or "udp"),
          runs=config.get("runs"),
          timeout_sec=float(config.get("timeout_sec") or 2.0),
          queries=config.get("queries"),
          target_snapshot=TargetSnapshot.model_validate(config["target_snapshot"]),
          origin=WatchOrigin.watch,
      )
  ```
  Note: `resolvers` is absent; the snapshot's `resolver_ips` are the
  intended measured set.
- `backend/app/runner.py:769-773` — `_build_config`:
  ```python
  if req.resolvers:
      resolvers = req.resolvers
  else:
      system_dns = self.system_dns_payload().get("resolvers", [])
      resolvers = list(dict.fromkeys(self.default_resolvers + system_dns))
  ```
  The fallback is the whole catalog.
- `backend/app/models.py:429-460` — `WatchConfigRequest.target_snapshot` is a
  `TargetSnapshot` whose `resolver_ips` (models.py:44-47) is `min_length=1`
  with **no IP normalization and no cap** — the same boundary gap flagged as
  audit SEC-01. Fix the boundary here while touching this path (a garbage
  snapshot currently flows into `start()`'s `resolvers` only after 031 makes
  them actually used — normalize before use).
- `backend/tests/test_watch.py:350-376` — the integration-style test uses a
  `NoopExecutor` and never asserts which resolvers a watch run measures.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 930dfb6..HEAD -- backend/app/watch.py backend/tests/test_watch.py` | exit 0 (empty or only expected merged-plan context) |
| Watch tests | `cd backend && . .venv/bin/activate && pytest tests/test_watch.py -q` | all pass |
| Full gate | `make backend-check`     | exit 0 |

## Scope

**In scope**:
- `backend/app/watch.py` — `_build_request` sets `resolvers` from the
  snapshot; snapshot IP normalization/cap at creation time
- `backend/app/models.py` — `WatchConfigRequest` validates `target_snapshot`
  IPs (normalize + `max_items=256`), mirroring `ProtocolComparisonRequest`
- `backend/tests/test_watch.py` — the measured-set assertions

**Out of scope** (do NOT touch, even though they look related):
- The `BenchmarkRequest.target_snapshot` boundary (SEC-01 covers the plain
  benchmark path too) — this plan fixes the watch path only; a follow-up
  plan (035) addresses the shared `TargetSnapshot` validation if warranted.
- The scheduler reliability cluster (plan 033) and the UI refresh (plan 032).
- `detect_system_dns` behavior — the fallback itself is correct for plain
  benchmarks; only the watch path is wrong.

## Git workflow

- Branch: `plan/031-watch-measures-snapshot`
- Commits: `fix(watch): measure the configured target snapshot, not the default catalog`, then `test(watch): assert watch runs measure the snapshot set`. Merge commit: `merge: plan 031 — watch measures the configured snapshot`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Normalize the snapshot at creation

`backend/app/models.py` — in `WatchConfigRequest`, add a validator on
`target_snapshot` (mirror `ProtocolComparisonRequest.validate_target_snapshot`,
models.py:276-289):

```python
@field_validator("target_snapshot")
@classmethod
def validate_target_snapshot(cls, value: TargetSnapshot) -> TargetSnapshot:
    normalized = _normalize_resolvers(value.resolver_ips, max_items=256)
    if not normalized:
        raise ValueError("Sin resolvers en el snapshot de destino")
    provider_ids: dict[str, str] | None = None
    if value.provider_ids is not None:
        provider_ids = {ip: pid for ip, pid in value.provider_ids.items() if ip in normalized}
    return TargetSnapshot(
        resolver_ips=normalized,
        selection_source=value.selection_source,
        provider_ids=provider_ids,
    )
```

(`_normalize_resolvers` already exists in models.py:65-78.)

**Verify**: `cd backend && . .venv/bin/activate && python -c "
from app.models import WatchConfigRequest
w = WatchConfigRequest(target_snapshot={'resolver_ips': ['1.1.1.1', '9.9.9.9', 'not-an-ip'], 'selection_source': 'manual'})
assert w.target_snapshot.resolver_ips == ['1.1.1.1', '9.9.9.9']
print('normalize-ok')"` → `normalize-ok` (invalid IPs rejected via pydantic — adjust the assertion to a `ValidationError` raise if `_normalize_resolvers` rejects instead of dropping; the contract is: invalid IPs fail creation, valid ones are normalized/capped).

### Step 2: Measure the snapshot

`backend/app/watch.py` — in `_build_request`, after building the snapshot,
set the resolvers from it:

```python
snapshot = TargetSnapshot.model_validate(config["target_snapshot"])
return BenchmarkRequest(
    ...
    target_snapshot=snapshot,
    resolvers=list(snapshot.resolver_ips),
    origin=WatchOrigin.watch,
)
```

**Verify**: `cd backend && . .venv/bin/activate && python -c "
from app.watch import WatchScheduler
from app.models import WatchConfigRequest
sched = WatchScheduler(manager=None)  # manager unused by _build_request
cfg = WatchConfigRequest(target_snapshot={'resolver_ips': ['1.1.1.1'], 'selection_source': 'manual'})
req = sched._build_request(cfg.model_dump())
assert req.resolvers == ['1.1.1.1']
print('measure-ok')"` → `measure-ok`.

### Step 3: Tests

`backend/tests/test_watch.py`:
1. `test_watch_run_measures_snapshot_resolvers` — create a watch with a
   non-default snapshot (e.g. two resolvers); drive the scheduler with a
   facade whose `start` records the request; assert `request.resolvers ==
   snapshot.resolver_ips` and the request carries `origin == "watch"`.
2. `test_watch_config_rejects_non_ip_snapshot` — `WatchConfigRequest` with a
   non-IP in `target_snapshot.resolver_ips` → validation error.
3. Extend the existing `test_watch_run_is_tagged_origin_watch` to assert the
   started request's `resolvers` equals the snapshot's list (the current
   test only checks the persisted JSON).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_watch.py -q` → all pass.

### Step 4: Full gate

**Verify**: `make backend-check` → exit 0.

## Test plan

- `backend/tests/test_watch.py` — the 3 additions in Step 3 (measured-set
  equality, snapshot validation, origin+resolvers on the started request).
- Structural patterns: the existing `test_watch.py` facade/temp-dir setup.

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_watch.py -q` — all pass
- [ ] `make backend-check` exits 0
- [ ] `grep -n "resolvers=list(snapshot.resolver_ips)" backend/app/watch.py` matches
- [ ] `grep -n "validate_target_snapshot" backend/app/models.py` matches (the WatchConfigRequest validator)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 031 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the "Current state" locations doesn't match the excerpts.
- `_build_config`'s resolver logic has changed such that setting `resolvers`
  alone no longer produces the snapshot set (e.g. protocol filtering alters
  it — note: DoQ/DoT filtering already applies after `resolvers` is set and
  is correct behavior; only a *change* in that contract is a STOP).
- An existing watch test's fixture relies on the full-catalog measurement
  (it should not — report rather than adjust silently).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Existing watch configs created before 031 have snapshots that already
  passed `WatchConfigRequest` (no IP normalization) — after this plan they
  are normalized at first `_build_request` via `model_validate`? No — the
  stored config dicts are re-validated per tick with
  `TargetSnapshot.model_validate(config["target_snapshot"])` (watch.py:427).
  Pre-031 stored snapshots may contain raw strings that now flow into
  `resolvers`; `_build_request` should wrap the snapshot construction so a
  legacy garbage snapshot fails the tick cleanly (plan 033's per-watch
  isolation turns that into a `watch_config_error` event instead of a silent
  skip).
- This plan changes what watch runs measure — the point of the fix. Alert
  history before/after the fix is not directly comparable; expected.
- The scheduler's manifest-equality baseline logic is unaffected (the
  snapshot is constant per watch; now the measured set matches it).
