# Plan 025: Manifest target-snapshot synthesis for API/CLI runs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d5002d0..HEAD -- backend/app/runner.py backend/tests/test_manifest_snapshot.py backend/tests/test_cli_run.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: correctness (audit finding 3 — post-`e09fd2d` churn reaudit)
- **Planned at**: commit `d5002d0`, 2026-08-11

## Why this matters

The run manifest's `target_snapshot` is the comparison key for the measured
destination set (`RunManifest.target_snapshot`, `models.py:168`). But
`_build_config` leaves it `None` whenever the request omits `target_snapshot`
— which is every CLI run (`cli_run.py:123-131` never sets it) and any direct
API run without the frontend's snapshot. Two such runs measured against
**different resolver populations** then satisfy
`baseline.target_snapshot != candidate.target_snapshot` as `False != False`,
so they compare as `comparable=True` with partial (or empty) rows — exactly
the "unión parcialmente comparable" that `docs/ARCHITECTURE.md:110-114`
declares must never happen, and that `test_comparisons.py:404`
(`test_target_snapshot_mismatch_never_produces_partial_union`) exists to
prevent for the populated case. The frontend always sends the snapshot, so
only the API/CLI path is affected — the path plan 020 just shipped.

## Current state

- `backend/app/runner.py:736-739` — in `_build_config`:
  ```python
  scoring_profile = req.effective_scoring_profile()
  target_snapshot_dict: dict[str, object] | None = None
  if req.target_snapshot is not None:
      target_snapshot_dict = req.target_snapshot.model_dump()
  ```
  The snapshot is None for every request that omits it.
- `runner.py:167-181` — `_build_run_manifest(config, ...)` stores
  `config.target_snapshot` verbatim in the manifest; `_manifest_mismatch_reason_codes`
  (207-264) maps a snapshot difference to `target_snapshot_mismatch`.
- `models.py:39-55` — `TargetSnapshot` shape:
  `resolver_ips: list[str]` (min_length=1), `selection_source: SelectionSource`
  (`manual | catalog | system`, models.py:33-36), `provider_ids: dict[str, str] | None`.
- `runner.py:725-731` — the actual measured resolver list is decided here:
  `config.resolvers = req.resolvers` when given, else `default_resolvers +
  system_dns` (deduped), then protocol-filtered.
- `cli_run.py:117-131` — `build_request` maps CLI args to `BenchmarkRequest`
  without `target_snapshot`.
- The manifest field is `dict | None` (`models.py:168`), so populating it is
  backward-compatible at the schema level. Runs persisted before this fix
  keep `null`; a pre-fix vs post-fix comparison of otherwise identical runs
  yields `target_snapshot_mismatch` — which is the contract working as
  intended (the destination set genuinely cannot be proven equal).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat d5002d0..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| New tests | `cd backend && . .venv/bin/activate && pytest tests/test_manifest_snapshot.py -q` | all pass |
| Full gate | `make backend-check`     | exit 0 |

## Scope

**In scope**:
- `backend/app/runner.py` — snapshot synthesis in `_build_config`
- `backend/tests/test_manifest_snapshot.py` (new)
- `backend/tests/test_cli_run.py` — add one CLI-path assertion (snapshot
  populated for a CLI-style request)

**Out of scope** (do NOT touch, even though they look related):
- `RUN_MANIFEST_VERSION` — no bump: the field semantics are unchanged, only
  populated. Old-vs-new mismatch surfaces as `target_snapshot_mismatch`,
  which is correct.
- `cli_run.py` — the synthesis lives in `_build_config`, so the CLI gets it
  for free; no CLI code change.
- `models.py`, `docs/PROFILE_MODEL.md`, `docs/REGION_TARGETING.md` — no
  schema or doc changes needed (REGION_TARGETING already says the snapshot
  records "the exact ordered normalized resolver-IP list actually measured").
- The frontend (`App.tsx` sends snapshots already).
- Protocol-comparison requests — they already require `target_snapshot`
  (models.py:248).

## Git workflow

- Branch: `plan/025-manifest-target-snapshot-synthesis`
- Commits: conventional (`fix(manifest): synthesize target snapshot for API/CLI runs`, `test(manifest): cover snapshot synthesis`). Merge commit on main:
  `merge: plan 025 — manifest target-snapshot synthesis`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Synthesize the snapshot in `_build_config`

In `runner.py:736-739`, replace the pass-through with synthesis when the
request omitted the snapshot. The snapshot must reflect **exactly** what will
be measured — i.e. `config.resolvers` after the protocol filter (line 731),
not the raw request:

```python
scoring_profile = req.effective_scoring_profile()
if req.target_snapshot is not None:
    target_snapshot_dict = req.target_snapshot.model_dump()
else:
    target_snapshot_dict = {
        "resolver_ips": list(resolvers),
        "selection_source": "manual" if req.resolvers else "catalog",
        "provider_ids": {
            ip: provider.get("id", "")
            for ip in resolvers
            for provider in [self.provider_index.get(ip) or {}]
            if provider.get("id")
        },
    }
```

Notes:
- `resolvers` is the final, protocol-filtered list from line 731 (the local
  variable in `_build_config`; use whatever name it has at that point).
- `selection_source`: `"manual"` when the caller supplied resolvers;
  `"catalog"` for the implicit default set (catalog defaults + detected
  system DNS) — the closest single label for a mixed default set; document
  this choice in a one-line comment.
- `provider_ids` maps measured IPs to provider ids for catalog resolvers;
  unknown/system IPs are simply absent (matches how the frontend builds it).
- Keep the `TargetSnapshot` validation semantics: the dict is stored in the
  manifest as-is (a plain dict, as today) — do NOT construct a `TargetSnapshot`
  model here; `_build_config`'s contract is `BenchmarkConfig`, and the manifest
  builder (167-181) already accepts the dict.

**Verify**: `cd backend && . .venv/bin/activate && python -c "
from app.models import BenchmarkRequest
from app.runner import BenchmarkManager
m = BenchmarkManager()
cfg = m._build_config(BenchmarkRequest(resolvers=['1.1.1.1', '8.8.8.8'], mode='quick', goal='speed'))
assert cfg.target_snapshot is not None
assert cfg.target_snapshot['resolver_ips'] == ['1.1.1.1', '8.8.8.8']
assert cfg.target_snapshot['selection_source'] == 'manual'
assert cfg.target_snapshot['provider_ids']['1.1.1.1'] == 'cloudflare'
print('synthesis-ok')"` → `synthesis-ok`.

### Step 2: Verify the request-with-snapshot path is untouched

A request that supplies `target_snapshot` must keep it verbatim (no
synthesis, no overwrite).

**Verify**: `cd backend && . .venv/bin/activate && python -c "
from app.models import BenchmarkRequest, TargetSnapshot, SelectionSource
from app.runner import BenchmarkManager
m = BenchmarkManager()
snap = TargetSnapshot(resolver_ips=['9.9.9.9'], selection_source=SelectionSource.manual)
cfg = m._build_config(BenchmarkRequest(resolvers=['9.9.9.9'], target_snapshot=snap, mode='quick'))
assert cfg.target_snapshot == snap.model_dump()
print('passthrough-ok')"` → `passthrough-ok`.

### Step 3: Tests — `backend/tests/test_manifest_snapshot.py`

1. `test_config_synthesis_manual_resolvers` — explicit resolvers → snapshot
   populated with exactly the filtered list, `selection_source == "manual"`,
   `provider_ids` includes catalog providers (use `1.1.1.1` → `cloudflare`).
2. `test_config_synthesis_default_resolvers` — no resolvers → snapshot
   populated, `selection_source == "catalog"`, `provider_ids` non-empty
   (catalog defaults include known providers; assert it covers the measured
   list).
3. `test_config_synthesis_respects_protocol_filter` — request
   `protocol="dot"` with a resolver mix (one with `dot_hostname`, one
   without, e.g. `1.1.1.1` and a system-only IP); the snapshot's
   `resolver_ips` equals the protocol-filtered config resolvers (the
   unsupported IP is absent).
4. `test_request_snapshot_passthrough_unchanged` — supplied snapshot
   verbatim (Step 2 assertion as a test).
5. `test_manifest_contains_synthesized_snapshot` — build a config and call
   `_build_run_manifest`; assert the manifest's `target_snapshot` equals the
   config's.
6. `test_different_resolver_sets_are_not_comparable` — two done runs built
   from synthesized snapshots with different resolver lists, persisted via
   the manager's temp runs dir, `compare_runs` → `comparable is False` with
   `target_snapshot_mismatch` in `reason_codes`. (Model on
   `test_comparisons.py:404`'s fixture approach but with synthesized
   snapshots.)

Extend `backend/tests/test_cli_run.py` with one test
`test_cli_request_builds_manifest_compatible_snapshot`: run
`build_request(parsed_args)` for a CLI invocation and assert
`request.target_snapshot is None` AND that feeding it through
`BenchmarkManager._build_config` yields a populated snapshot (the CLI path
gets synthesis via the backend, not the request).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_manifest_snapshot.py tests/test_cli_run.py -q` → all pass (7 new + 6 existing).

### Step 4: Full gate

**Verify**: `make backend-check` → exit 0.

## Test plan

- `backend/tests/test_manifest_snapshot.py` — the 6 cases in Step 3
  (synthesis for manual/default/protocol-filtered sets, passthrough,
  manifest wiring, cross-set non-comparability).
- `backend/tests/test_cli_run.py` — one additive CLI-path test.
- Structural patterns: `test_comparisons.py` (manifest-comparison fixtures),
  `test_cli_run.py` (arg parsing + fake manager), `test_export_csv.py`
  (temp-dir/state injection if needed).
- `make backend-check` must pass end to end.

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_manifest_snapshot.py tests/test_cli_run.py -q` — all pass
- [ ] `make backend-check` exits 0
- [ ] `python -c "from app.runner import BenchmarkManager; import inspect; src = inspect.getsource(BenchmarkManager._build_config); assert 'selection_source' in src; print('synth-ok')"` (run from `backend/` with the venv active) → `synth-ok`
- [ ] `grep -n "RUN_MANIFEST_VERSION" backend/app/runner.py | head -1` still shows `RUN_MANIFEST_VERSION = 1` (no bump)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 025 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the "Current state" locations doesn't match the excerpts.
- Existing tests fail in a way that indicates the snapshot synthesis changes
  persisted-run behavior beyond new runs (e.g. an existing test asserts a
  `null` manifest snapshot for non-frontend runs) — report the conflict
  instead of weakening the existing test.
- A step's verification fails twice after a reasonable fix attempt.
- The task appears to require a `RUN_MANIFEST_VERSION` bump or a
  `models.py`/`cli_run.py` change to proceed.

## Maintenance notes

- The synthesized `selection_source == "catalog"` for implicit default sets
  is a documented approximation (the set mixes catalog defaults with
  detected system DNS). If a future plan separates "system" and "catalog"
  into distinct snapshot entries, it must bump the manifest version.
- Pre-fix runs (snapshot `null`) will now mismatch against post-fix runs —
  expected; a reviewer should confirm no UI regression in the history
  comparison panel (it already renders mismatch reason codes).
- Plan 024 touches `runner.py` too; merge-order conflicts are limited to
  line regions and are trivial to rebase.
