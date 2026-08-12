# Plan 029: DoQ joins the protocol-comparison contract (option a of plan 022)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1ea666f..HEAD -- backend/app/models.py backend/app/runner.py backend/tests/test_protocol_comparison.py docs/PROTOCOL_COMPARISON_METHODOLOGY.md frontend/src/lib/types.ts frontend/src/App.tsx frontend/src/components/DashboardControls.tsx frontend/src/components/ProtocolComparisonPanel.tsx frontend/src/lib/i18n-translations.ts frontend/tests/e2e/fixtures.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (plan 023 landed DoQ standalone — this extends the frozen comparison contract to include it, per the plan-022 signed-off decision that deferred option (a) to a dedicated step)
- **Category**: direction (build — DoQ comparison extension)
- **Planned at**: commit `1ea666f`, 2026-08-11

## Why this matters

Plan 023 shipped DoQ as a standalone benchmark protocol with the
comparison contract deliberately frozen at `udp/dot/doh`. The signed-off
decision (022 option (a)) deferred DoQ-in-comparison to "a dedicated,
maintainer-approved step" — this is that step. The frozen-methodology rule
(`docs/PROTOCOL_COMPARISON_METHODOLOGY.md`) requires the doc, the manifest
version, the canonical order, and the UI to change **in one commit**, so the
contract is never observable in a half-extended state. The measurement
machinery is already DoQ-ready (023's eligibility branch at `runner.py:349-354`
emits `doq_unavailable`/`doq_hostname_missing`/`doq_hostname_invalid`
exclusion codes); this plan widens the canonical set, bumps the manifest
version, updates the frozen doc, and exposes doq in the comparison UI with
proper exclusion copy.

## Current state

- `backend/app/models.py:245` — `CANONICAL_PROTOCOL_ORDER = (BenchmarkProtocol.udp, BenchmarkProtocol.dot, BenchmarkProtocol.doh)`.
- `models.py:253` — `protocols: list[BenchmarkProtocol] = Field(min_length=2, max_length=3)`; the validator at 269 reorders via `CANONICAL_PROTOCOL_ORDER` (so adding doq to the tuple auto-normalizes it).
- `backend/app/runner.py:75-76` — `PROTOCOL_COMPARISON_MANIFEST_VERSION = 1`, `PROTOCOL_COMPARISON_DIAGNOSTIC_POLICY_VERSION = "protocol-v1"`.
- `runner.py:349-354` — the doq branch of `_protocol_endpoint_eligibility` already exists (from 023): `doq_unavailable` when `dns_quic_available()` is False, `doq_hostname_missing` / `doq_hostname_invalid` otherwise. `_plan_endpoints`/`preflight_protocol_comparison`/`start_protocol_comparison` are protocol-generic (they iterate `canonical_protocols`) — no dispatch changes expected; verify during implementation.
- `docs/PROTOCOL_COMPARISON_METHODOLOGY.md` — rules 1-2 freeze the request model (`protocols` length 2-3) and canonical order `udp, dot, doh`. **This doc changes in the same commit as the code.**
- `frontend/src/lib/types.ts:23` — `COMPARISON_PROTOCOLS: BenchmarkProtocol[] = ['udp', 'dot', 'doh']` (created by 023; the comparison chips in `DashboardControls.tsx:278` iterate it).
- `frontend/src/App.tsx:247` — `comparisonProtocols` init `['udp', 'dot']` (user expands the set via chips).
- `frontend/src/components/ProtocolComparisonPanel.tsx:25` — the `PROTOCOL_LABEL_KEY` Record already covers `doq` (023).
- `frontend/src/lib/i18n-translations.ts:244-248` — `comparisonMode.exclusionReason.dot_hostname_missing`, `dot_hostname_invalid`, `doh_url_missing`, `doh_url_invalid`, `unknown` exist in all three languages. No doq exclusion keys yet (they currently fall back to `unknown`).
- `backend/tests/test_protocol_comparison.py` — the existing suite; runs comparisons over 2- and 3-protocol sets. `frontend/tests/e2e/fixtures.ts` — `protocolComparisonManifest` already accepts `BenchmarkProtocol[]` (023 widened it); fixture values stay udp/dot/doh.
- The catalog: 2 providers (quad9, quad9-unsecured) have verified DoQ endpoints; cloudflare/google were cleaned in 023; adguard is `dns.adguard-dns.com`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 1ea666f..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Comparison tests | `cd backend && . .venv/bin/activate && pytest tests/test_protocol_comparison.py tests/test_doq.py -q` | all pass |
| Full backend gate | `make backend-check`     | exit 0 |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| e2e | `cd frontend && npx playwright test --reporter=line` | 25 passed |

## Scope

**In scope** (the only files you should modify):
- `backend/app/models.py` — canonical order + protocols bound
- `backend/app/runner.py` — manifest version bump (+ verify no dispatch gaps)
- `backend/tests/test_protocol_comparison.py` — 4-protocol coverage
- `docs/PROTOCOL_COMPARISON_METHODOLOGY.md` — freeze the extended contract
- `frontend/src/lib/types.ts` — `COMPARISON_PROTOCOLS` gains `'doq'`
- `frontend/src/lib/i18n-translations.ts` — 3 new exclusion keys × 3 languages
- `frontend/src/components/DashboardControls.tsx` — no change expected beyond
  i18n consumption (verify); if the exclusion rendering needs the new keys,
  it already consumes them via `comparisonMode.exclusionReason.{code}` with
  the `unknown` fallback
- `frontend/tests/e2e/fixtures.ts` — only if the suite fails (see STOP conditions)

**Out of scope** (do NOT touch, even though they look related):
- The DoQ standalone benchmark path (023) — `run_doq_query`,
  `_measure_with_protocol`, `_build_config` gating, `dns_quic_available`.
- `frontend/src/App.tsx:247`'s `comparisonProtocols` default — the chips let
  users add doq; the default stays `['udp', 'dot']` (changing the default is
  a product decision, not a contract one).
- `cli_run.py`, `app/export.py`, the watch subsystem (028).
- `RUN_MANIFEST_VERSION` (single-run manifest — unchanged; this plan only
  bumps `PROTOCOL_COMPARISON_MANIFEST_VERSION`).

## Git workflow

- Branch: `plan/029-doq-comparison-extension`
- Commits: one commit containing code + doc + i18n together (the
  frozen-methodology rule), plus separate test commits. Suggested split:
  `feat(protocol): extend comparison contract to DoQ` (models, runner,
  methodology doc, i18n, types), then `test(protocol): cover four-protocol
  comparison sets`. Merge commit: `merge: plan 029 — DoQ comparison extension`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Widen the canonical set and the request bound

`backend/app/models.py`:
1. Line 245: `CANONICAL_PROTOCOL_ORDER = (BenchmarkProtocol.udp, BenchmarkProtocol.dot, BenchmarkProtocol.doh, BenchmarkProtocol.doq)`.
2. Line 253: `max_length=3` → `max_length=4`.
3. The validator at 269 needs no change (iterates the canonical tuple).

**Verify**: `cd backend && . .venv/bin/activate && python -c "
from app.models import BenchmarkProtocol, CANONICAL_PROTOCOL_ORDER, ProtocolComparisonRequest
assert [p.value for p in CANONICAL_PROTOCOL_ORDER] == ['udp', 'dot', 'doh', 'doq']
r = ProtocolComparisonRequest(protocols=['doq', 'udp', 'doh', 'dot'], target_snapshot={'resolver_ips': ['9.9.9.9'], 'selection_source': 'manual'}, scoring_profile='speed')
assert [p.value for p in r.protocols] == ['udp', 'dot', 'doh', 'doq']
print('canonical-ok')"` → `canonical-ok`.

### Step 2: Bump the comparison manifest version

`backend/app/runner.py:75` — `PROTOCOL_COMPARISON_MANIFEST_VERSION = 1` → `2`.

Then trace the comparison pipeline for gaps: read `preflight_protocol_comparison`
(~955-1050), `start_protocol_comparison` (~1069-1150), `_plan_endpoints`
(~1158), and `_measure_comparison_sample`/`_run_protocol_comparison`
(~1220-1400). The pipeline must (a) accept a 4-element canonical list without
any hardcoded 3-transport assumptions (search for `max_length`/`3`/hardcoded
transport tuples in the comparison path), and (b) route doq through
`_measure_with_protocol` (which already dispatches it). Fix only what the
trace shows; if a hardcoded assumption exists that this plan's intent
requires changing, that is a STOP condition (report it) unless it is a
one-line mechanical fix in an in-scope file.

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_protocol_comparison.py -q` → all pass (existing suite still green with the version bump).

### Step 3: Freeze the extended methodology doc

`docs/PROTOCOL_COMPARISON_METHODOLOGY.md` — update rule 2 (and any other
place that states the length or the canonical order):
- `protocols` has length **two to four**; duplicate values are still a
  validation error; normalization order is now `udp, dot, doh, doq`.
- Add a note: doq comparisons require the optional `aioquic` extra
  (`dns.quic.have_quic`); when unavailable, eligible resolvers are excluded
  with the `doq_unavailable` code (the existing exclusion machinery); the
  `manifest_version` was bumped to 2 for this extension.
- Keep the rest of the doc's non-negotiable rules intact.

**Verify**: `grep -n "doq" docs/PROTOCOL_COMPARISON_METHODOLOGY.md` matches at least the canonical-order line and the aioquic note.

### Step 4: Frontend — chips, i18n exclusion copy

1. `frontend/src/lib/types.ts:23` — `COMPARISON_PROTOCOLS` gains `'doq'`:
   `['udp', 'dot', 'doh', 'doq']`.
2. `frontend/src/lib/i18n-translations.ts` — add to the
   `comparisonMode.exclusionReason.*` group (in ALL THREE language objects,
   same commit — the copy test enforces parity):
   - `doq_hostname_missing`, `doq_hostname_invalid`, `doq_unavailable`
   (Spanish source of truth, e.g. `'sin hostname DoQ'`, `'hostname DoQ inválido'`, `'DoQ no disponible en esta instalación'`; EN/PT mirrors).
3. Verify `DashboardControls.tsx` renders exclusions via the
   `comparisonMode.exclusionReason.{code}` keys with the `unknown` fallback
   (it did for dot/doh; confirm the doq codes flow through the same lookup).
4. `frontend/src/App.tsx:247` default `['udp', 'dot']` — unchanged (chips
   offer the full set).

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0; `cd frontend && npx vitest run src/lib/i18n.copy.test.ts` → pass.

### Step 5: Tests — four-protocol comparison coverage

`backend/tests/test_protocol_comparison.py` — extend (follow the file's
existing fixture style; mock `dns_quic_available` True where needed):
1. `test_comparison_canonical_order_with_doq` — a 4-protocol request
   (`doq, udp, doh, dot`) validates to `udp, dot, doh, doq`.
2. `test_comparison_doq_excludes_resolvers_without_endpoint` — a target with
   one quad9 resolver (has `doq_hostname`) and one resolver without doq
   metadata: preflight's `exclusions` contains `doq_hostname_missing` for
   the latter; `common_eligible_target_snapshot` keeps only the former.
3. `test_comparison_doq_unavailable_excludes_all` — with
   `dns_quic_available()` monkeypatched False, a udp+doq request excludes
   every resolver with the `doq_unavailable` code (and the request is
   admissible iff the remaining set keeps ≥2 protocols viable — assert the
   reason codes are `no_common_targets` when nothing survives).
4. `test_comparison_full_cycle_with_doq` — a complete 4-protocol cycle over
   one resolver with mocked measurement (model on the existing
   `test_comparison_runs_canonical_order_and_completes`): assert done,
   `manifest["manifest_version"] == 2`, `canonical_protocols` order, and
   delta pairs present for udp/doh (the mocked doq subrun included).
5. `test_manifest_version_bumped_to_2` — persisted comparison JSON carries
   `manifest_version: 2` (regression guard for the freeze).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_protocol_comparison.py tests/test_doq.py -q` → all pass.

### Step 6: Full gates

**Verify**: `make backend-check` → exit 0; `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; `cd frontend && npx playwright test --reporter=line` → 25 passed; `git status` shows only in-scope files.

## Test plan

- `backend/tests/test_protocol_comparison.py` — the 5 extensions in Step 5
  (canonical order, doq exclusions, unavailability gating, full 4-protocol
  cycle, manifest version 2 pin).
- `backend/tests/test_doq.py` — must stay green (the standalone path).
- Frontend: typecheck (the widened `COMPARISON_PROTOCOLS` flows through
  `DashboardControls` chips), the i18n copy test, and the existing e2e suite
  (fixture manifest values remain udp/dot/doh — the comparison UI in e2e
  never toggles doq, so no fixture change is expected; if the suite fails on
  the doq chip appearing, see STOP conditions).

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_protocol_comparison.py tests/test_doq.py -q` — all pass (existing + 5 new)
- [ ] `make backend-check` exits 0
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `cd frontend && npx playwright test --reporter=line` — 25 passed
- [ ] `grep -n "CANONICAL_PROTOCOL_ORDER" backend/app/models.py` shows the tuple ending in `BenchmarkProtocol.doq`
- [ ] `grep -n "PROTOCOL_COMPARISON_MANIFEST_VERSION = 2" backend/app/runner.py` matches
- [ ] `grep -n "doq" docs/PROTOCOL_COMPARISON_METHODOLOGY.md` matches ≥ 2 (canonical order + aioquic note)
- [ ] `grep -n "doq_unavailable" frontend/src/lib/i18n-translations.ts` matches ≥ 3 (ES/EN/PT)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 029 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any code at the "Current state" locations doesn't match the excerpts.
- The pipeline trace in Step 2 finds a hardcoded 3-transport assumption that
  is more than a one-line mechanical fix (e.g. a tuple used for delta-pair
  generation or diagnostic domains) — report it with the location instead of
  improvising an extension.
- The e2e suite fails because of the new doq chip in the comparison selector
  (e.g. a fixture asserts the chip set) — report; do NOT change fixture
  comparison semantics to hide it.
- A step's verification fails twice after a reasonable fix attempt.
- The task appears to require touching `cli_run.py`, the watch subsystem,
  `RUN_MANIFEST_VERSION`, or the DoQ standalone path to proceed.

## Maintenance notes

- The frozen-methodology rule means: any future transport extension (DoH3,
  TCP) follows this exact pattern — one commit touching canonical order +
  bound + manifest version + methodology doc + i18n, with the version bump
  as the review gate.
- `PROTOCOL_COMPARISON_MANIFEST_VERSION` now diverges from
  `RUN_MANIFEST_VERSION` (2 vs 1) — intentional; they guard different
  contracts.
- Old persisted comparisons (version 1) remain readable but will mismatch
  against new runs via `manifest_version_mismatch` — the comparison UI
  already renders mismatch reason codes.
- The `comparisonMode.exclusionReason.*` i18n group is the single place new
  transport exclusion copy is added; the `unknown` fallback keeps rendering
  safe when a code is missing.
