# Plan 035: Security and consistency hardening (containment, gates, dead code, lock completeness)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 930dfb6..HEAD -- backend/app/main.py backend/app/runner.py backend/app/models.py backend/app/providers.py backend/app/watch.py backend/constraints.txt backend/tests/test_main.py backend/tests/test_protocol_comparison.py frontend/src/lib/api.ts frontend/src/lib/types.ts frontend/src/App.tsx frontend/package.json frontend/package-lock.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (security items) / P2 (consistency)
- **Effort**: S-M
- **Risk**: MED (eligibility-gate unification)
- **Depends on**: none
- **Category**: security + tech-debt (deep-reaudit findings SEC-02, TD-01, TD-06, TD-07, 6-02, 6-04, 6-05)
- **Planned at**: commit `930dfb6`, 2026-08-13

## Why this matters

Four verified gaps from the deep reaudit: (1) the SPA fallback serves
static files using a `startswith` prefix check — the only non-exact
containment check in the repo (`main.py:251-252`); (2) three divergent
per-protocol eligibility gates already disagree on DoQ semantics
(`_resolver_supports_protocol` requires the `doq: "yes"` flag,
`_protocol_endpoint_eligibility` ignores it) — measurement sets can diverge
per feature, which the manifest determinism contract exists to prevent;
(3) a dead-code cluster (`getWatchStatus` with zero callers, unused
`RATE_METRICS` in watch.py, the `goal` field still sent by the frontend, an
unreachable wrong fallthrough in eligibility); (4) `maxminddb` (the geoip
extra) is outside `constraints.txt`, so `make dependency-audit` and the CI
audit jobs never see it. Plus two small dependency-consistency items.

## Current state

- `backend/app/main.py:251-252`:
  ```python
  requested = (FRONTEND_DIST / full_path).resolve()
  if requested.is_file() and str(requested).startswith(str(FRONTEND_DIST)):
  ```
  Every other containment check in the repo uses `resolve().is_relative_to`
  (runner.py, watch.py).
- `backend/app/runner.py:1866-1882` — `_resolver_supports_protocol`: `udp` →
  True; `dot` → `bool(features.get("dot_hostname") or features.get("dot") == "yes")`;
  `doh` → `bool(features.get("doh_url"))`; `doq` → `features.get("doq") == "yes" and bool(features.get("doq_hostname"))`; else False.
- `runner.py:315-357` — `_protocol_endpoint_eligibility`: doq branch checks
  `dns_quic_available()` + hostname validity but NOT the `doq: "yes"` flag;
  the final `return None, "dot_hostname_missing"` at :356 is unreachable
  dead code returning a wrong exclusion code.
- `runner.py:~1257` — `_plan_endpoints` re-reads `doq_hostname` from
  provider features with neither check.
- `backend/app/watch.py:31` — `RATE_METRICS` defined, never referenced.
- `frontend/src/lib/api.ts:229-233` — `getWatchStatus` exported, zero
  callers (grep-verified).
- `frontend/src/lib/api.ts:77` and `frontend/src/App.tsx:788` — both send
  the deprecated `goal` field alongside `scoring_profile`
  (`models.py:106-109`).
- `backend/constraints.txt` — header `--extra=dev --extra=pack --extra=doq`;
  no `maxminddb` entry (`backend/pyproject.toml:36` `geoip` extra).
- `frontend/package.json:7` — `"engines": { "node": "^24.0.0" }`; lockfile
  jsdom 30.0.1 requires `^22.22.2 || ^24.15.0 || >=26.0.0`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 930dfb6..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Backend tests | `cd backend && . .venv/bin/activate && pytest tests/test_protocol_comparison.py tests/test_doq.py tests/test_main.py -q` | all pass |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| Full gate | `make backend-check`     | exit 0 |

## Scope

**In scope**:
- `backend/app/main.py` — SPA containment
- `backend/app/runner.py` — eligibility-gate unification, fallthrough fix
- `backend/app/models.py` — `WatchConfigRequest.target_snapshot` validation
  (SEC-01's watch half, if not already landed via plan 031)
- `backend/app/watch.py` — delete the unused `RATE_METRICS`
- `frontend/src/lib/api.ts` / `types.ts` — delete `getWatchStatus`; stop
  sending `goal`
- `frontend/src/App.tsx` — stop sending `goal`
- `backend/constraints.txt` — `maxminddb` pin (+ any `# via` line)
- `frontend/package.json` / `package-lock.json` — engines narrowing
- `backend/tests/test_main.py` (new if absent) — SPA traversal test
- `backend/tests/test_protocol_comparison.py` / `test_doq.py` — gate-unification regression tests

**Out of scope** (do NOT touch, even though they look related):
- `BenchmarkRequest.target_snapshot` shared validation (the plain-benchmark
  path) — flagged as SEC-01's other half; the watch half lands via 031/this
  plan; a shared model-level fix is a future decision.
- The `goal` BACKEND field (models.py:106-109) — kept for API compatibility;
  only the frontend stops sending it.
- The `cryptography==50.0.0` verification (6-05) — one command in Step 6,
  report-only.
- The `dnspect run` CLI and `cli.py` — plan 033/036 territory.

## Git workflow

- Branch: `plan/035-security-consistency`
- Commits: `fix(security): use exact containment in the SPA fallback`,
  `refactor(protocol): unify per-protocol eligibility gates`,
  `chore: remove dead code and stop sending deprecated goal field`,
  `build: pin geoip extra in constraints and narrow node engines`.
  Merge commit: `merge: plan 035 — security and consistency hardening`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Exact containment in the SPA fallback

`backend/app/main.py:251-252`:
```python
requested = (FRONTEND_DIST / full_path).resolve()
if requested.is_file() and requested.is_relative_to(FRONTEND_DIST):
```
(`FRONTEND_DIST` is already a resolved `Path` — verify it is `Path(...).resolve()`d at module load; if not, resolve once at load.)

**Verify**: a test asserting `GET /../frontend-dist-other/secret.txt`-class
paths never serve files outside `FRONTEND_DIST` (the path may be normalized
by the client/ASGI before reaching the route — test the route function
directly with crafted `full_path` values including `..`, encoded `%2e%2e`,
and sibling-prefix names like `dist-backup/x`): expected 404/redirect, never
a file body.

### Step 2: Unify the eligibility gates

Introduce one module-level function in `runner.py`:

```python
def _resolver_protocol_endpoint(
    resolver_ip: str, protocol: BenchmarkProtocol, provider_index: dict[str, dict[str, Any]],
) -> tuple[str | None, str | None]:
    """(endpoint, exclusion_code) — the single source of per-protocol eligibility."""
    if protocol == BenchmarkProtocol.udp:
        return resolver_ip, None
    provider = provider_index.get(resolver_ip)
    features = (provider or {}).get("features") or {}
    if protocol == BenchmarkProtocol.dot:
        hostname = features.get("dot_hostname")
        if not isinstance(hostname, str) or not hostname.strip():
            return None, "dot_hostname_missing"
        if not is_valid_dns_hostname(hostname):
            return None, "dot_hostname_invalid"
        return hostname, None
    if protocol == BenchmarkProtocol.doh:
        url = features.get("doh_url")
        if not isinstance(url, str) or not url.strip():
            return None, "doh_url_missing"
        if not is_valid_doh_url(url):
            return None, "doh_url_invalid"
        return url, None
    if protocol == BenchmarkProtocol.doq:
        if features.get("doq") != "yes":
            return None, "doq_unsupported"
        if not dns_quic_available():
            return None, "doq_unavailable"
        hostname = features.get("doq_hostname")
        if not isinstance(hostname, str) or not hostname.strip():
            return None, "doq_hostname_missing"
        if not is_valid_dns_hostname(hostname):
            return None, "doq_hostname_invalid"
        return hostname, None
    return None, "invalid_protocol"
```

Semantics decision (the unification's load-bearing choice): **flag
`doq: "yes"` is now required in BOTH paths**, and availability is checked in
both. `dot` keeps its existing `hostname OR flag` tolerance (preserving the
admitted set for DoT — the test matrix pins it). Then:
1. `_protocol_endpoint_eligibility` (315-357) — delete; comparison call
   sites call `_resolver_protocol_endpoint` (the exclusion codes stay
   identical for the preflight matrix: `doq_hostname_missing/invalid`,
   `doq_unavailable`; the new `doq_unsupported`/`invalid_protocol` codes are
   additive — check the i18n `unknown` fallback renders them).
2. `_resolver_supports_protocol` (1866-1882) — implement as
   `_resolver_protocol_endpoint(ip, protocol, self.provider_index)[0] is not None`.
3. `_plan_endpoints` (~1257) — read the endpoint from the shared function
   instead of re-reading features.
4. The `return None, "dot_hostname_missing"` fallthrough disappears with
   the old function.

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_protocol_comparison.py tests/test_doq.py -q` → all pass (the preflight matrix is the safety net); add two regression tests: `test_doq_flag_required_in_plain_benchmark` (a provider with `doq_hostname` but `doq: "no"` is filtered from a plain doq run) and `test_eligibility_unknown_protocol_code` (`invalid_protocol` for a non-enum value if reachable, else assert the fallthrough is gone via the function's shape).

### Step 3: Dead-code removal

1. Delete `getWatchStatus` from `api.ts` (+ its `WatchStatus`-related type
   usage if now orphaned — check `types.ts` imports) and the unused
   `RATE_METRICS` in `watch.py` (also delete the now-empty duplicate set in
   `WatchPanel.tsx` if plan 032 hasn't already; coordinate — if 032 landed,
   its shared `WATCH_RATE_METRICS` in utils.ts is the keeper).
2. `frontend/src/lib/api.ts:77` and `frontend/src/App.tsx:788` — stop
   sending `goal` (keep `scoring_profile`).
3. Verify nothing else references the removed symbols:
   `grep -rn "getWatchStatus\|RATE_METRICS" frontend/src backend/app`.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0 (typecheck proves no orphaned imports).

### Step 4: `maxminddb` in the lock + engines narrowing

1. `backend/constraints.txt` — add `maxminddb==2.7.0` with a
   `    # via dnspect-backend` comment line, matching the file's format
   (do NOT hand-resolve transitive deps — `maxminddb` is dependency-free).
   Note in the commit that the canonical regeneration would be
   `pip-compile --extra=dev --extra=pack --extra=doq --extra=geoip`; the
   manual pin is equivalent until the next regen.
2. `frontend/package.json:7` — `"engines": { "node": "^24.15.0" }`; run
   `npm install` to sync the lockfile's root engines entry (repo rule:
   lockfile updates via `npm install`, committed together).

**Verify**: `cd backend && . .venv/bin/activate && pip-audit -r constraints.txt --no-deps --progress-spinner off` → exit 0; `cd frontend && npm ci --dry-run` → exit 0.

### Step 5: Gates

**Verify**: `make backend-check` → exit 0; `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; `cd frontend && npx playwright test --reporter=line` → all pass.

### Step 6: Report-only — cryptography freshness

Run `pip index versions cryptography` (network) and record in NOTES whether
50.0.0 is the current stable. Do not change the pin without a review note.

## Test plan

- `backend/tests/test_main.py` (or extend an existing main-route test) —
  the SPA traversal matrix.
- `test_protocol_comparison.py`/`test_doq.py` — the two gate-unification
  regression tests.
- Frontend: typecheck + existing suites (the dead-code removal is
  compile-gated).
- `test_watch.py` — must stay green (watch.py touch is only the constant
  deletion).

## Done criteria

ALL must hold:

- [ ] `make backend-check` exits 0
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `cd frontend && npx playwright test --reporter=line` — all pass
- [ ] `grep -n "is_relative_to" backend/app/main.py` matches in `spa_fallback`
- [ ] `grep -n "def _resolver_protocol_endpoint" backend/app/runner.py` matches; `grep -c "_protocol_endpoint_eligibility" backend/app/runner.py` == 0 (old function gone)
- [ ] `grep -rn "getWatchStatus\|RATE_METRICS" frontend/src backend/app` returns no matches
- [ ] `grep -n "maxminddb" backend/constraints.txt` matches
- [ ] `grep -n '"node"' frontend/package.json` shows `^24.15.0`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 035 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any code at the "Current state" locations doesn't match the excerpts.
- The gate unification changes the admitted resolver set for udp/dot/doh in
  the preflight matrix (the tests fail) — the semantics must be
  behavior-preserving for the three existing transports; only doq gains the
  flag requirement. If DoT's `hostname OR flag` tolerance must change to
  unify, STOP and report (it must not).
- `dot_hostname_missing` as an exclusion code is relied upon by frontend
  i18n or tests in a way that breaks when the fallthrough disappears —
  check `grep -rn "dot_hostname_missing" frontend/src` first; the code
  itself is still emitted for real missing-hostname cases.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The eligibility unification makes `docs/PROTOCOL_COMPARISON_METHODOLOGY.md`'s
  exclusion-code list slightly incomplete (`doq_unsupported`,
  `invalid_protocol` are new) — update the doc in the same commit if the
  audit's doc plan (037) hasn't already swept it.
- The `goal` frontend removal is safe for old backends (the field is
  optional); the backend keeps accepting it indefinitely for API compat.
- `maxminddb`'s manual pin must be folded into the next real
  pip-compile regen — flag it in the release checklist.
- The doq flag requirement is now symmetric across standalone and
  comparison DoQ — this is the contract plan 029's extension should have
  had; the preflight matrix covers regressions.
