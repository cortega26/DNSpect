# Plan 022: DNS-over-QUIC (DoQ) support — design spike

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 087e5ff..HEAD -- backend/app/runner.py backend/app/models.py backend/app/providers.py backend/pyproject.toml backend/constraints.txt data/dns_providers.es.json docs/PROTOCOL_COMPARISON_METHODOLOGY.md`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L (spike — design doc + validated prototype, no production code)
- **Risk**: LOW (no production code touched; the only new-dependency risk is
  documented, not installed)
- **Depends on**: none (reads plan 021's "watch protocols" outcome where relevant)
- **Category**: direction (stated-but-undelivered DoQ claim in catalog/UI)
- **Planned at**: commit `087e5ff`, 2026-08-11

## Why this matters

The provider catalog, the UI, and the translations all claim DoQ support —
but the product cannot measure it. `data/dns_providers.es.json` carries
`doq: "yes"` + `doq_hostname` on 5 providers (cloudflare, google, quad9,
quad9-unsecured, adguard), the resolver detail modal renders a DoQ badge
(`frontend/src/components/ResolverDetailModal.tsx:76`), and the i18n files
define `protocol.doq` — yet `BenchmarkProtocol` (`models.py:27-31`) is only
`udp/dot/doh`, no query path exists, and the protocol-comparison contract
freezes the canonical set at three transports. The badge promises a capability
the benchmark cannot exercise. dnspython 2.7.0 already ships the sync
`dns.query.quic()` API, so the code gap is small — but the decisions
(dependency strategy, comparison-contract extension, catalog verification,
packaging) are exactly what a maintainer must approve before code lands. This
spike produces those decisions, verified.

## Current state

- `backend/app/models.py:27-31` — `class BenchmarkProtocol(str, Enum)`:
  `udp = "udp"`, `dot = "dot"`, `doh = "doh"`. Line 239:
  `CANONICAL_PROTOCOL_ORDER = (BenchmarkProtocol.udp, BenchmarkProtocol.dot, BenchmarkProtocol.doh)`.
  `ProtocolComparisonRequest.protocols` (`models.py:247`) is
  `min_length=2, max_length=3` and its validator (lines 255-263) reorders to
  canonical order.
- `backend/app/runner.py:315-339` — `_protocol_endpoint_eligibility()`
  resolves `(endpoint, exclusion_code)` per transport from the provider's
  `features` (`dot_hostname` via `is_valid_dns_hostname`, `doh_url` via
  `is_valid_doh_url`). DoQ would add a branch using `doq_hostname`.
  `runner.py:1744-1761` — `_measure_with_protocol()` dispatches to
  `run_dot_query` / `run_doh_query` / `measure_query`; a DoQ branch calls a
  new `run_doq_query`.
- `backend/app/runner.py:72-73` — `PROTOCOL_COMPARISON_MANIFEST_VERSION = 1`
  and `PROTOCOL_COMPARISON_DIAGNOSTIC_POLICY_VERSION = "protocol-v1"` — the
  comparison manifest version pins.
- `docs/PROTOCOL_COMPARISON_METHODOLOGY.md` — freezes the comparison
  methodology for exactly `udp`, `dot`, `doh` (non-negotiable rules 1-2:
  `protocols` length two or three; canonical order `udp, dot, doh`). Extending
  the comparison to DoQ is a **methodology change requiring maintainer
  approval**, not a code-only change.
- `backend/app/providers.py:47-81` — `_validate_providers()` currently
  enforces `doh_url` presence/validity only when `features.doh == "yes"`
  (lines 73-81); `doq_hostname` is not validated anywhere. `providers.py:131-142`
  — `is_valid_dns_hostname()` / `is_valid_doh_url()` are the syntactic
  validators a `doq_hostname` check would reuse.
- `backend/pyproject.toml:17` — `"dnspython==2.7.0"` (pinned; constraints at
  `backend/constraints.txt:45`). dnspython 2.7.0's `dns.query.quic` signature
  (verified in the installed venv):
  `quic(q, where, timeout=None, port=853, ..., verify=True, server_hostname=None)`,
  gated by `dns.query.have_quic` which is False unless the optional `aioquic`
  package is installed (not installed in the venv).
- **Optional-extra precedent**: the repo already treats `maxminddb` as an
  optional extra — `geoip = ["maxminddb==2.7.0"]` under
  `[project.optional-dependencies]` (`pyproject.toml:36`) — with graceful
  degradation (`geoip.py`). This is the pattern an `aioquic` extra would
  follow.
- Catalog entries with `doq: "yes"` (verified 2026-08-11): cloudflare
  `one.one.one.one`, google `dns.google`, quad9 `dns.quad9.net`,
  quad9-unsecured `dns10.quad9.net`, adguard `dns.adguard.com`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 087e5ff..HEAD -- backend/app/runner.py backend/app/models.py backend/app/providers.py backend/pyproject.toml backend/constraints.txt data/dns_providers.es.json docs/PROTOCOL_COMPARISON_METHODOLOGY.md` | exit 0 (empty or only expected merged-plan context) |
| Spike tests | `cd backend && . .venv/bin/activate && pytest tests/test_doq_spike.py -q` | all pass |
| Full gate   | `make backend-check`     | exit 0 |
| Doc presence | `test -f docs/DOQ_SUPPORT.md && echo present` | prints `present` |

## Scope

**In scope** (the only files you should create/modify):
- `docs/DOQ_SUPPORT.md` (new) — design + decision record + catalog verification table
- `backend/tests/doq_query_spike.py` (new) — the prototype module (mockable
  DoQ transport + the eligibility-branch port)
- `backend/tests/test_doq_spike.py` (new) — spike tests (mocked transport, no network)

**Spike-code placement note**: the prototype lives in `backend/tests/` as a
plain module (no `tests/__init__.py` exists; pytest runs from `backend/` with
`pythonpath = ["."]`, so the test file imports it with a plain
`import doq_query_spike`). Tooling gates treat `tests/` correctly: mypy is
scoped to `files = ["app"]` (`pyproject.toml:70-72`), bandit excludes
`tests` (`pyproject.toml:82-83`), and ruff (`check .`) covers it — keep the
spike module ruff-clean, never use `sys.path` hacks (E402).

**Out of scope** (do NOT touch, even though they look related):
- Any production code: `backend/app/*`, `frontend/src/*`, `data/*`,
  `backend/pyproject.toml`, `backend/constraints.txt` — the spike documents
  the exact diffs but lands none. **Do not install `aioquic`.**
- The protocol-comparison contract (`models.py`, `runner.py` comparison
  machinery, `docs/PROTOCOL_COMPARISON_METHODOLOGY.md`) — extending it is a
  maintainer decision recorded in the doc; the spike only *specifies* the
  extension.
- Plan 021's monitoring "watch protocols" — cross-reference only.

## Git workflow

- Branch: `plan/022-dns-over-quic-design-spike`
- Commits: conventional (`docs(doq): ...`, `test(doq): ...`). The merge
  commit on main is `merge: plan 022 — DNS-over-QUIC design spike`.
- The spike prototype in `backend/tests/` is evidence; the design doc is the
  deliverable. Unless the reviewer asks to keep it, delete
  `backend/tests/doq_query_spike.py` before merge (the doc captures the
  findings).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Prototype the DoQ query path with a mockable transport

In `backend/tests/doq_query_spike.py`, implement a prototype that produces
the same sample-dict shape as `run_dnspython_query` (fields `ok`, `ms`,
`answer_ips`, `failure_kind`, rcode-derived kinds — see `runner.py:2081-2087`
and the failure classification at `runner.py:599` / `stats.py`):

- `query_quic(domain, server, timeout_sec, port=853)` — calls
  `dns.query.quic` from dnspython when `dns.query.have_quic` is True; maps
  `dns.exception.Timeout` → `failure_kind="timeout"`, `dns.query.QUICFailed`/
  connection errors → `failure_kind="other"`, success → `ok=True` with
  `ms` measured via `perf_counter` and `answer_ips` from A/AAAA answer IPs
  (mirror the A-record extraction pattern at `runner.py:128`'s
  `DRILL_ANSWER_RE`/`run_dnspython_query`).
- The transport must be injectable (a `transport` callable parameter) so
  tests can mock it — the real network path is only ever exercised by the
  manual check in Step 3.

**Verify**: `cd backend && . .venv/bin/activate && python -c "import sys; sys.path.insert(0, 'tests'); import doq_query_spike; print('ok')"` → prints `ok`.

### Step 2: Verify the catalog DoQ endpoints from primary sources

For each of the 5 `doq: "yes"` providers, verify `doq_hostname` against a
primary source (provider's own documentation; `dnsprivacy.org` public
resolvers list as secondary) and record in the design doc a table:
provider id | doq_hostname in catalog | primary source | verification date |
verdict (verified / unverifiable — flag per the plan-006 gate: never retain
endpoint metadata that cannot be verified from an appropriate primary source).
Also record each provider's DoQ port if the source states one (default 853).
The verification itself is manual research — do not fabricate sources.

**Verify**: `docs/DOQ_SUPPORT.md` contains the verification table with all 5
providers and a verdict per row.

### Step 3: Manual live validation (documented, optional, requires network)

If the machine has outbound UDP/443: `python -m pip show aioquic` is NOT
permitted (do not install). Instead, document in the doc the exact commands a
maintainer runs later to validate the real path (e.g. with aioquic installed
in a throwaway venv: `python -c "import dns.query; print(dns.query.have_quic)"`
then a one-liner `dns.query.quic` against `one.one.one.one`). If network is
unavailable, record "not validated on this machine" — the spike's mock-based
tests are the CI-safe validation.

**Verify**: the doc's "Validation" section states the manual commands and the
machine's outcome (validated / not run, with date).

### Step 4: Write the design and decision record — `docs/DOQ_SUPPORT.md`

Sections:
1. **Current state** — the excerpts above (badge claim vs. no measurement
   path; dnspython `dns.query.quic` availability; optional-extra precedent).
2. **Verification table** (Step 2).
3. **Proposed API changes** (exact diffs, *described* not applied):
   - `models.py`: `BenchmarkProtocol` gains `doq = "doq"`;
   - `CANONICAL_PROTOCOL_ORDER` extension decision (see decision list);
   - `runner.py`: `_protocol_endpoint_eligibility` doq branch
     (`features.doq == "yes"` + `doq_hostname` via `is_valid_dns_hostname`,
     exclusions `doq_hostname_missing` / `doq_hostname_invalid`);
     `_measure_with_protocol` doq branch calling `run_doq_query`;
   - `providers.py`: `_validate_providers` enforcing `doq_hostname` when
     `doq == "yes"` (mirror the `doh_url` block, lines 73-81);
   - `pyproject.toml`/`constraints.txt`: optional extra `doq` → `aioquic`
     (version researched from PyPI at spike time), `have_quic`-gated
     degradation matching the `maxminddb`/`geoip` precedent;
   - packaging impact: PyInstaller spec (`dnspect-linux.spec`) + Flatpak
     generated modules (`flatpak-python-deps`, see AGENTS.md) must include
     aioquic if DoQ is enabled in packaged builds; macOS wheel availability
     noted.
4. **Comparison-contract decision** — two options with trade-offs:
   (a) DoQ joins `ProtocolComparisonRequest` (canonical order
   `udp, dot, doh, doq`, `protocols` length 2-4, methodology doc extension +
   `PROTOCOL_COMPARISON_MANIFEST_VERSION` bump, protocol badge/UI parity);
   (b) DoQ ships standalone (single-protocol benchmark only) first, with the
   comparison extension as a follow-up decision. Recommend (b) — the frozen
   methodology is a deliberate contract; extend it only in a dedicated,
   maintainer-approved step.
5. **Decision list for the maintainer**: (b) vs (a); whether `aioquic` is a
   mandatory dependency for the next release or optional-with-badge-gating
   (a provider with DoQ shown but unmeasurable is the current problem — the
   doc must address whether the UI badge hides when `have_quic` is False);
   DoQ port policy (853 default vs per-provider port — no catalog field
   exists today); whether the DoQ spike's catalog findings change the 5
   entries (e.g. unverifiable hostnames removed per plan-006).

**Verify**: all five required headings present
(`grep -c "^## " docs/DOQ_SUPPORT.md` ≥ 5).

### Step 5: Spike tests — `backend/tests/test_doq_spike.py`

With the mocked transport (no network, no aioquic):

1. `test_query_quic_success_returns_sample` — mock transport returns a
   message with an A record; assert `ok=True`, `answer_ips` contains the IP.
2. `test_query_quic_timeout_maps_failure_kind` — transport raises
   `dns.exception.Timeout` → `failure_kind="timeout"`.
3. `test_query_quic_have_quic_false_raises_clear_error` — with
   `have_quic=False`, assert the prototype reports an explicit
   `doq_unavailable` outcome (the design's degradation path).
4. `test_query_quic_server_name_passed_to_transport` — assert the transport
   receives `server_hostname` equal to the `doq_hostname` argument.
5. `test_eligibility_doq_branch` — port of `_protocol_endpoint_eligibility`
   logic for the doq branch: hostname present+valid → endpoint; missing →
   `doq_hostname_missing`; invalid hostname → `doq_hostname_invalid`.
   (Implement the branch as a spike-local function mirroring `runner.py:315-339`.)

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_doq_spike.py -q` → 5 tests pass.

### Step 6: Record outcomes and run the full gate

Add a "Spike results" section to `docs/DOQ_SUPPORT.md` (what the prototype
validated, the exact dnspython API behavior observed, any revision to the
decision list). Then run the full gate.

**Verify**: `make backend-check` → exit 0.

## Test plan

- New tests in `backend/tests/test_doq_spike.py` (Step 5) — mocked transport,
  no network, no aioquic import requirement at test time.
- Structural pattern: `backend/tests/test_encrypted_dns.py` (existing DoT/DoH
  tests) and `test_failure_classification.py` for the failure-kind mapping.
- `make backend-check` must pass end to end.

## Done criteria

ALL must hold:

- [ ] `docs/DOQ_SUPPORT.md` exists with ≥ 5 sections including the verification table and both decision lists
- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_doq_spike.py -q` — 5 tests pass
- [ ] `make backend-check` exits 0
- [ ] No production files modified: `git status` shows only the in-scope list
- [ ] `grep -rn "aioquic" backend/pyproject.toml backend/constraints.txt` returns no matches (nothing installed/pinned)
- [ ] `plans/README.md` status row for 022 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- A primary source for a DoQ hostname cannot be found — record
  "unverifiable" in the table and continue (do not invent sources).
- The `dns.query.quic` signature in the installed dnspython differs from the
  excerpt in a way that breaks the prototype — adjust the spike-local wrapper
  only; if the API is absent entirely, STOP and report.
- A step's verification fails twice after a reasonable fix attempt.
- The task appears to require modifying production code or the comparison
  methodology to proceed.

## Maintenance notes

- The build plan that follows this spike must treat the decision list as
  binding unless new evidence appears.
- The UI badge problem (DoQ shown when unmeasurable) must be addressed in
  whatever build plan follows — hiding the badge when `have_quic` is False is
  the likely resolution; the doc records the recommendation.
- If the comparison contract is later extended to DoQ, `docs/PROTOCOL_COMPARISON_METHODOLOGY.md`
  changes in the same commit, plus a `PROTOCOL_COMPARISON_MANIFEST_VERSION`
  bump — a frozen methodology is a review gate, not a formality.
- The catalog verification table is the plan-006 evidence trail for the 5
  `doq_hostname` values; keep it attached to `docs/DOQ_SUPPORT.md` when the
  data changes.
