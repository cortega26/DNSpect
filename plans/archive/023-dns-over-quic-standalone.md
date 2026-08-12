# Plan 023: DNS-over-QUIC (DoQ) standalone benchmark support

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d5002d0..HEAD -- backend/app/models.py backend/app/runner.py backend/app/providers.py backend/app/main.py backend/pyproject.toml backend/constraints.txt data/dns_providers.es.json frontend/src/lib/types.ts frontend/src/App.tsx frontend/src/components/DashboardControls.tsx frontend/src/components/ProtocolComparisonPanel.tsx frontend/src/components/ResolverDetailModal.tsx frontend/src/lib/api.ts backend/tests/test_doq.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (implements the signed-off plan-022 decisions; see `plans/README.md` "Signed-off decisions")
- **Category**: direction (build — DoQ standalone benchmark)
- **Planned at**: commit `d5002d0`, 2026-08-11

## Why this matters

The catalog, UI, and i18n have claimed DoQ support since QW5, but no
measurement path exists (`BenchmarkProtocol` is only `udp/dot/doh`). The
plan-022 spike (design doc: `docs/DOQ_SUPPORT.md`) verified dnspython 2.7.0's
sync `dns.query.quic()` API, verified the catalog entries from primary sources
(quad9 pair verified; cloudflare + google unverifiable; adguard uses a legacy
alias), and its decisions were signed off: **standalone first** (DoQ joins the
single-protocol benchmark, NOT the frozen protocol-comparison contract),
**optional `aioquic` extra** with the DoQ badge/protocol option hidden when
`dns.quic.have_quic` is False, **port 853**, and **catalog cleanup** as step 0.
This plan makes the badge measurable: "DoQ shown but unmeasurable" becomes
impossible.

## Current state

- `backend/app/models.py:27-31` — `class BenchmarkProtocol(str, Enum)`: `udp = "udp"`, `dot = "dot"`, `doh = "doh"`.
- `backend/app/runner.py`:
  - `_resolver_supports_protocol` (line 1731) — per-protocol resolver filter used by `_build_config` (line 731): `udp`→True, `dot`→`bool(features.get("dot_hostname") or features.get("dot") == "yes")`, `doh`→`bool(features.get("doh_url"))`, else False. A doq branch returns False today.
  - `_protocol_endpoint_eligibility` (lines 315-339) — per-transport `(endpoint, exclusion_code)`; used by the protocol-comparison path only.
  - `_measure_with_protocol` (lines 1744-1761) — dispatches `dot`→`run_dot_query`, `doh`→`run_doh_query`, else `measure_query`; a doq branch belongs here.
  - `run_dot_query` (line 1996) and `run_doh_query` (line 2035) — module-level functions returning the sample dict (`ok`, `ms`, `answer_ips`, `failure_kind`, ...). Follow `run_doh_query`'s shape for the new `run_doq_query`.
- `backend/app/providers.py:68-81` — `_validate_providers()` enforces `doh_url` presence/validity only when `features.doh == "yes"` (lines 73-81); `doq_hostname` is not validated. `is_valid_dns_hostname` at line 131.
- `backend/app/main.py:66-72` — `/api/health` returns `{"status", "version", "backend_time_utc"}`.
- `backend/pyproject.toml:25-39` — `[project.optional-dependencies]` has `dev`, `geoip = ["maxminddb==2.7.0"]` (the optional-extra precedent with graceful degradation), `pack`. Line 17 pins `dnspython==2.7.0`. `backend/constraints.txt` (pip-compile style, `# via` comments) has no aioquic/cryptography/pylsqpack/pyserde pins today.
- `data/dns_providers.es.json` — 5 providers declare `doq: "yes"`: cloudflare (`one.one.one.one`), google (`dns.google`), quad9 (`dns.quad9.net`), quad9-unsecured (`dns10.quad9.net`), adguard (`dns.adguard.com`). Per `docs/DOQ_SUPPORT.md` §2: quad9 pair verified (port 853); cloudflare+google **unverifiable**; adguard's `dns.adguard.com` is a **legacy alias** for the documented `dns.adguard-dns.com` (which also serves DoT and DoH per adguard-dns.io).
- `frontend/src/lib/types.ts:15,19` — `export type BenchmarkProtocol = 'udp' | 'dot' | 'doh'`; `export const PROTOCOLS: BenchmarkProtocol[] = ['udp', 'dot', 'doh']`.
- `frontend/src/components/DashboardControls.tsx:75-78` — `PROTOCOL_LABEL_KEY: Record<BenchmarkProtocol, 'protocol.udp' | 'protocol.dot' | 'protocol.doh'>`; single-protocol chips iterate `PROTOCOLS` (line 189); comparison chips iterate `PROTOCOLS` too (line 278) — **the comparison selector must NOT gain doq** (frozen methodology).
- `frontend/src/components/ProtocolComparisonPanel.tsx:25` — same `PROTOCOL_LABEL_KEY: Record<BenchmarkProtocol, ...>` type.
- `frontend/src/components/ResolverDetailModal.tsx:76` — renders the DoQ badge when `provider.features.doq === 'yes'`; this must be gated on capability.
- `frontend/src/lib/api.ts` — has `getProviders`, `getSystemDns`, `getBenchmarkHistory`, `compareRuns`, `runProtocolComparisonPreflight`, `probeResolvers`, etc.; no health/capabilities fetch.
- `frontend/src/App.tsx:237` — `const [comparisonProtocols, setComparisonProtocols] = useState<BenchmarkProtocol[]>(['udp', 'dot'])`.
- i18n: `protocol.doq` exists in all three languages (`frontend/src/lib/i18n-translations.ts` ~lines 432/889/1317) — no translation work needed.
- `backend/tests/test_encrypted_dns.py` — the existing DoT/DoH test pattern (mock `dns.query.tls`/`dns.query.https`); model the DoQ tests on it.
- Capability signal: `dns.quic.have_quic` (verified: `dns.query.have_quic` does NOT exist in dnspython 2.7.0; `dns.query.quic` raises `dns.query.NoDOQ` when aioquic is absent). This is the gate everywhere.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat d5002d0..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Backend tests | `cd backend && . .venv/bin/activate && pytest tests/test_doq.py -q` | all pass |
| Full backend gate | `make backend-check`     | exit 0 |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| Dep audit | `cd backend && . .venv/bin/activate && pip-audit -r constraints.txt --no-deps --progress-spinner off` | exit 0 |
| Catalog check | `cd backend && . .venv/bin/activate && python -c "from app.providers import load_providers; load_providers(); print('ok')"` | prints `ok` |

## Scope

**In scope** (the only files you should modify):
- `data/dns_providers.es.json` — catalog cleanup (Step 1)
- `backend/app/models.py` — `BenchmarkProtocol.doq`
- `backend/app/providers.py` — doq validation
- `backend/app/runner.py` — capability gate, doq support in the three dispatch points, new `run_doq_query`
- `backend/app/main.py` — `/api/health` capabilities
- `backend/pyproject.toml`, `backend/constraints.txt` — `doq` extra + pins
- `frontend/src/lib/types.ts` — protocol type + `PROTOCOLS` + new `COMPARISON_PROTOCOLS`
- `frontend/src/components/DashboardControls.tsx` — label key, capability gating, comparison chips pinned
- `frontend/src/components/ProtocolComparisonPanel.tsx` — label-key Record type (compile-only change)
- `frontend/src/components/ResolverDetailModal.tsx` — badge gating
- `frontend/src/lib/api.ts` — `getCapabilities`
- `frontend/src/App.tsx` — fetch capabilities, thread `doqAvailable` prop
- `backend/tests/test_doq.py` (new)

**Out of scope** (do NOT touch, even though they look related):
- The protocol-comparison machinery (`ProtocolComparisonRequest`, `CANONICAL_PROTOCOL_ORDER`, `docs/PROTOCOL_COMPARISON_METHODOLOGY.md`, `PROTOCOL_COMPARISON_MANIFEST_VERSION`) — DoQ does NOT join the comparison in this plan (signed-off decision). The comparison UI must not offer doq.
- The CLI (`cli_run.py`) — its `--protocol` choices derive from the enum automatically; no change needed.
- `EXPORT_CSV_COLUMNS` (`app/export.py`) — `protocol` is already a column; no change.
- The persistence/read-path fixes from the audit (separate plans; do not fold them in).
- `scripts/package_backend.py` and `packaging/flatpak/requirements.txt` — documented in Step 6 as release-prep notes only; do NOT modify them in this plan (packaged-build inclusion of aioquic is a release decision per the signed-off gate).

## Git workflow

- Branch: `plan/023-dns-over-quic-standalone`
- Commit per step, conventional commits matching the repo log (e.g. `feat(protocol): add doq to the benchmark protocol set`, `data(providers): clean unverifiable DoQ claims`, `test(protocol): cover doq query path`). The merge commit on main is `merge: plan 023 — DNS-over-QUIC standalone benchmark`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Catalog cleanup (plan-006 gate)

In `data/dns_providers.es.json`:
- **cloudflare** and **google**: change `"doq": "yes"` → `"doq": "no"` and remove the `"doq_hostname"` key (unverifiable from any primary source; `docs/DOQ_SUPPORT.md` §2).
- **adguard**: set `"doq_hostname": "dns.adguard-dns.com"`, `"dot_hostname": "dns.adguard-dns.com"`, `"doh_url": "https://dns.adguard-dns.com/dns-query"` (the documented endpoints per adguard-dns.io; the legacy `dns.adguard.com` alias is replaced).
- **quad9**, **quad9-unsecured**: unchanged (verified).
- Preserve the file's exact formatting style (2-space indent, `notes_es` etc.); do not reorder entries.

**Verify**: `cd backend && . .venv/bin/activate && python -c "from app.providers import load_providers; load_providers(); print('ok')"` → `ok`; `cd backend && . .venv/bin/activate && pytest tests/test_providers.py -q` → all pass.

### Step 2: Backend protocol plumbing

1. `backend/app/models.py:27-31` — add `doq = "doq"` to `BenchmarkProtocol`.
2. `backend/app/runner.py` — add a module-level gate helper near the top (after `RELIABILITY_FAILURE_KINDS`, line 129):
   ```python
   def dns_quic_available() -> bool:
       return dns.quic.have_quic
   ```
   (`dns.quic` is already importable; add `import dns.quic` to the imports block if not present.)
3. `_resolver_supports_protocol` (line 1731) — add before the `return False`:
   ```python
   if protocol == "doq":
       return features.get("doq") == "yes" and bool(features.get("doq_hostname"))
   ```
4. `_protocol_endpoint_eligibility` (lines 315-339) — add a doq branch mirroring the dot branch:
   ```python
   if protocol == BenchmarkProtocol.doq:
       if not dns_quic_available():
           return None, "doq_unavailable"
       hostname = features.get("doq_hostname")
       if not isinstance(hostname, str) or not hostname.strip():
           return None, "doq_hostname_missing"
       if not is_valid_dns_hostname(hostname):
           return None, "doq_hostname_invalid"
       return hostname, None
   ```
5. `_measure_with_protocol` (lines 1744-1761) — add a doq branch before the `return measure_query(...)` fallback:
   ```python
   if config.protocol == "doq":
       provider_data = self.provider_index.get(resolver, {})
       features = provider_data.get("features") or {}
       doq_hostname = features.get("doq_hostname")
       return run_doq_query(resolver, domain, config.timeout_sec, doq_hostname)
   ```
6. `_build_config` (lines 716-751) — after `protocol = req.protocol.value` (line 723), add the availability gate:
   ```python
   if protocol == "doq" and not dns_quic_available():
       raise ValueError("DoQ no disponible en esta instalación (falta aioquic).")
   ```
7. New module-level `run_doq_query` after `run_doh_query` (line 2035+), following `run_doh_query`'s shape exactly (same sample-dict fields and failure-kind mapping; see `run_dnspython_query` for the rcode mapping). It must:
   - return the `doq_unavailable` sample when `not dns_quic_available()` (do not raise);
   - build the query with `dns.message.make_query(domain, "A")`;
   - call `dns.query.quic(q, resolver, timeout=timeout_sec, port=853, server_hostname=doq_hostname)` (fall back to `resolver` when `doq_hostname` is falsy);
   - map `dns.exception.Timeout` → `failure_kind="timeout"`, `dns.query.NoDOQ` → `failure_kind="doq_unavailable"`, other exceptions → `failure_kind="other"` (per `docs/DOQ_SUPPORT.md` §1: there is no `QUICFailed` in dnspython 2.7.0);
   - measure `ms` with `perf_counter` around the call; extract A/AAAA IPs into `answer_ips`.

**Verify**: `cd backend && . .venv/bin/activate && python -c "from app.runner import run_doq_query, dns_quic_available; print('ok')"` → `ok`.

### Step 3: Provider validation

`backend/app/providers.py:68-81` — mirror the `doh` block: when `features.get("doq") == "yes"`, require `doq_hostname` to be a non-empty string passing `is_valid_dns_hostname()`; raise `ValueError` otherwise (same message style as the existing checks).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_providers.py tests/test_doq.py -q` — test_providers passes; test_doq.py does not exist yet, so only test_providers runs. Then add the doq validation cases to `backend/tests/test_doq.py` in Step 7.

### Step 4: Health capabilities

`backend/app/main.py:66-72` — extend the `/api/health` response with a capabilities object (additive; the three existing keys stay):
```python
return {
    "status": "ok",
    "version": __version__,
    "backend_time_utc": datetime.now(UTC).isoformat(),
    "capabilities": {"doq": dns_quic_available()},
}
```
(import `dns_quic_available` from `.runner`.)

**Verify**: `cd backend && . .venv/bin/activate && python -c "from fastapi.testclient import TestClient; from app.main import app; r = TestClient(app).get('/api/health'); assert 'capabilities' in r.json(); print('ok')"` → `ok`.

### Step 5: Dependency extra and constraints

1. `backend/pyproject.toml` `[project.optional-dependencies]` (after line 36) — add:
   ```toml
   doq = ["aioquic==1.3.0"]
   ```
2. Install it in the worktree venv: `cd backend && . .venv/bin/activate && pip install -e .[doq]` (this pulls aioquic + its transitive deps: `cryptography`, `pylsqpack`, `pyserde` — confirm with `pip show aioquic`).
3. `backend/constraints.txt` — pin the newly installed packages (`aioquic`, `pylsqpack`, `pyserde`, and any new `cryptography` version if not already pinned) using the file's existing format: `name==version` plus a `    # via <parent>` comment line, matching how other constraints are annotated. Use the actual resolved versions from `pip freeze`.

**Verify**: `cd backend && . .venv/bin/activate && python -c "import dns.quic; assert dns.quic.have_quic is True; print('quic-on')"` → `quic-on`; `pip-audit -r constraints.txt --no-deps --progress-spinner off` → exit 0.

### Step 6: Release-prep notes (documented, not applied)

The signed-off gate says packaged builds include aioquic so desktop users always measure. This is release-prep, out of scope to change here — record in the commit message or a brief note in `docs/DOQ_SUPPORT.md` (edit allowed: docs) that the release plan must add aioquic to `scripts/package_backend.py`'s PyInstaller hidden imports (dynamic submodule imports) and to `packaging/flatpak/requirements.txt` before the next release.

### Step 7: Tests — `backend/tests/test_doq.py`

Model on `backend/tests/test_encrypted_dns.py` (monkeypatched transport, no real network). No aioquic required at test time — monkeypatch `dns.quic.have_quic` where needed.

1. `test_catalog_cleanup` — load `load_providers()`; assert cloudflare/google have `features.doq != "yes"` and no `doq_hostname`; adguard's `doq_hostname == "dns.adguard-dns.com"`.
2. `test_providers_validate_doq_hostname` — a provider dict with `doq=yes` and no hostname raises; with an invalid hostname raises; with a valid hostname passes. (Use a temp copy of the catalog or call `providers._validate_providers` directly with a crafted list.)
3. `test_doq_eligibility_codes` — call `_protocol_endpoint_eligibility` for a doq protocol: with `dns_quic_available` monkeypatched True and a valid hostname → `(hostname, None)`; missing hostname → `doq_hostname_missing`; invalid → `doq_hostname_invalid`; with availability False → `doq_unavailable`.
4. `test_run_doq_query_success` — monkeypatch `dns.query.quic` to return a message with an A record; assert `ok=True`, `answer_ips`, `ms` numeric.
5. `test_run_doq_query_timeout` — monkeypatched `dns.query.quic` raises `dns.exception.Timeout` → `failure_kind="timeout"`.
6. `test_run_doq_query_no_quic` — `dns_quic_available` False → `failure_kind="doq_unavailable"`, no exception.
7. `test_build_config_rejects_doq_without_quic` — `BenchmarkRequest(protocol="doq", resolvers=["1.1.1.1"])` + `dns_quic_available` False → `start()` raises `ValueError` (message contains "DoQ").
8. `test_benchmark_run_doq_protocol` — monkeypatch `dns_quic_available` True and `BenchmarkManager._measure_with_protocol` to return a fixed ok sample (or monkeypatch `dns.query.quic`); start a small run with `protocol="doq"`; assert the done state's results carry `protocol == "doq"` and `engine` is set. Clean the injected state with the `manager._lock`/`_states.pop` pattern from `test_export_csv.py`.
9. `test_health_reports_capabilities` — `/api/health` contains `capabilities.doq` equal to `dns_quic_available()`.

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_doq.py -q` → 9 tests pass.

### Step 8: Frontend

1. `frontend/src/lib/types.ts` — `BenchmarkProtocol = 'udp' | 'dot' | 'doh' | 'doq'`; `PROTOCOLS` gains `'doq'`; add `export const COMPARISON_PROTOCOLS: BenchmarkProtocol[] = ['udp', 'dot', 'doh']` with a comment that the comparison contract is frozen at three transports.
2. `frontend/src/components/DashboardControls.tsx:75-78` — extend `PROTOCOL_LABEL_KEY` with `doq: 'protocol.doq'`; the single-protocol chip loop (line 189) must skip doq when the new `doqAvailable: boolean` prop is false (add the prop to the component's props interface, defaulting to `true` only for tests); the comparison chip loop (line 278) must iterate `COMPARISON_PROTOCOLS` instead of `PROTOCOLS` (so doq never appears in the comparison selector).
3. `frontend/src/components/ProtocolComparisonPanel.tsx:25` — extend the `PROTOCOL_LABEL_KEY` Record with `doq: 'protocol.doq'` (compile-only; doq never reaches this component at runtime).
4. `frontend/src/components/ResolverDetailModal.tsx:76` — gate the DoQ badge on a new `doqAvailable: boolean` prop: render the badge only when `provider.features.doq === 'yes' && doqAvailable`.
5. `frontend/src/lib/api.ts` — add `getCapabilities(signal?: AbortSignal): Promise<{ doq: boolean }>` hitting `/api/health` and returning `json.capabilities` (follow the existing fetch/abort style of the file; `API_BASE` from `lib/utils`).
6. `frontend/src/App.tsx` — on mount, call `getCapabilities()` once (with the abort/seq guard pattern used by the other hooks); store `const [doqAvailable, setDoqAvailable] = useState(true)` (default `true` keeps behavior until the fetch resolves; flip to `false` when the backend says so or the fetch fails — a local app without the extra must hide the chip); pass `doqAvailable` to `DashboardControls` and to the `ResolverDetailModal` render site.

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0 (typecheck proves the `Record` extensions are complete — the widened union forces every `Record<BenchmarkProtocol, ...>` to cover `doq`).

### Step 9: Full gates

**Verify**: `make backend-check` → exit 0; the frontend gates from Step 8 still exit 0; `git status` shows only in-scope files.

## Test plan

- New `backend/tests/test_doq.py` — the 9 cases in Step 7 (catalog cleanup, validation, eligibility codes, query path success/timeout/degradation, request rejection, end-to-end run, health capability).
- Structural patterns: `backend/tests/test_encrypted_dns.py` (mocked transport), `backend/tests/test_providers.py` (catalog validation), `backend/tests/test_export_csv.py` (state injection/cleanup).
- Frontend: no new test files; the existing `npm run typecheck` is the compile-level gate for the widened protocol union, and the existing suites must stay green.

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_doq.py -q` — 9 tests pass
- [ ] `make backend-check` exits 0
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `cd backend && . .venv/bin/activate && python -c "from app.providers import load_providers; d={p['id']:p['features'] for p in load_providers()}; assert d['cloudflare'].get('doq')!='yes' and d['google'].get('doq')!='yes' and d['adguard']['doq_hostname']=='dns.adguard-dns.com'; print('catalog-ok')"` → `catalog-ok`
- [ ] `grep -rn "COMPARISON_PROTOCOLS" frontend/src/components/DashboardControls.tsx` matches (comparison chips pinned)
- [ ] `grep -rn "protocol.doq" frontend/src/components/DashboardControls.tsx frontend/src/components/ProtocolComparisonPanel.tsx` matches both
- [ ] `grep -rn "doq" backend/pyproject.toml backend/constraints.txt` matches both
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 023 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any code at the "Current state" locations doesn't match the excerpts.
- `pip install -e .[doq]` resolves aioquic version other than 1.3.0 or pulls an unexpectedly large dependency set — report the resolved set instead of pinning blind.
- The catalog cleanup contradicts `docs/DOQ_SUPPORT.md` §2 (e.g. a primary source now documents cloudflare/google DoQ) — report the source instead of deciding.
- `dns.query.quic` behaves differently from the excerpts in the installed dnspython (signature or exception types) in a way that breaks `run_doq_query` — adjust the wrapper only; if the API is absent, STOP.
- A step's verification fails twice after a reasonable fix attempt.
- The task appears to require touching the protocol-comparison machinery, `cli_run.py`, `app/export.py`, or `scripts/package_backend.py` to proceed.

## Maintenance notes

- The DoQ badge/option gating means the UI is honest about capability: with the optional extra missing, users see no DoQ anywhere; after `pip install -e .[doq]`, it appears. The `capabilities.doq` health field is the single source of truth — keep the gating prop wired to it.
- The comparison contract remains frozen at `udp/dot/doh`. When a maintainer later decides to extend it (option (a) in `docs/DOQ_SUPPORT.md` §4), that is a separate plan that must touch `CANONICAL_PROTOCOL_ORDER`, `ProtocolComparisonRequest.protocols` bounds, `docs/PROTOCOL_COMPARISON_METHODOLOGY.md`, and bump `PROTOCOL_COMPARISON_MANIFEST_VERSION` in the same commit.
- `COMPARISON_PROTOCOLS` and the label-key Records are the seams to update if/when that extension lands.
- Release prep (packaged aioquic) is recorded in the plan, not implemented: `scripts/package_backend.py` hidden imports + `packaging/flatpak/requirements.txt` + constraints regen are release-checklist items (see `docs/RELEASE_CHECKLIST.md`).
- If the audit's persistence plans land (non-atomic writes, read robustness), they touch `runner.py` near this plan's changes — merge order matters; rebase whichever lands second.
