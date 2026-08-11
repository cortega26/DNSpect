# DNS-over-QUIC (DoQ) support — design spike

> Plan 022. Design + decision record + catalog verification. No production
> code was landed; the exact diffs are *described* below, not applied.
> Prototype evidence: `backend/tests/doq_query_spike.py` +
> `backend/tests/test_doq_spike.py` (spike-only, CI-safe, no network, no
> aioquic).

## 1. Current state

The provider catalog, the UI, and the translations all claim DoQ support,
but the product cannot measure it:

- `data/dns_providers.es.json` carries `doq: "yes"` + `doq_hostname` on 5
  providers: cloudflare (`one.one.one.one`), google (`dns.google`), quad9
  (`dns.quad9.net`), quad9-unsecured (`dns10.quad9.net`), adguard
  (`dns.adguard.com`).
- `frontend/src/components/ResolverDetailModal.tsx:76` renders a DoQ badge;
  the i18n files define `protocol.doq`.
- `backend/app/models.py:27-31` — `class BenchmarkProtocol(str, Enum)`:
  `udp = "udp"`, `dot = "dot"`, `doh = "doh"`. Line 239:
  `CANONICAL_PROTOCOL_ORDER = (BenchmarkProtocol.udp, BenchmarkProtocol.dot, BenchmarkProtocol.doh)`.
  `ProtocolComparisonRequest.protocols` (`models.py:247`) is
  `min_length=2, max_length=3` with a validator (lines 255-263) that reorders
  to canonical order.
- `backend/app/runner.py:315-339` — `_protocol_endpoint_eligibility()`
  resolves `(endpoint, exclusion_code)` per transport from the provider's
  `features` (`dot_hostname` via `is_valid_dns_hostname`, `doh_url` via
  `is_valid_doh_url`). DoQ would add a branch using `doq_hostname`.
  `runner.py:1744-1761` — `_measure_with_protocol()` dispatches to
  `run_dot_query` / `run_doh_query` / `measure_query`; a DoQ branch would
  call a new `run_doq_query`.
- `backend/app/runner.py:72-73` — `PROTOCOL_COMPARISON_MANIFEST_VERSION = 1`
  and `PROTOCOL_COMPARISON_DIAGNOSTIC_POLICY_VERSION = "protocol-v1"` — the
  comparison manifest version pins.
- `docs/PROTOCOL_COMPARISON_METHODOLOGY.md` — freezes the comparison
  methodology for exactly `udp`, `dot`, `doh` (non-negotiable rules 1-2:
  `protocols` length two or three; canonical order `udp, dot, doh`).
  Extending the comparison to DoQ is a **methodology change requiring
  maintainer approval**, not a code-only change.
- `backend/app/providers.py:47-81` — `_validate_providers()` enforces
  `doh_url` presence/validity only when `features.doh == "yes"` (lines
  73-81); `doq_hostname` is not validated anywhere. `providers.py:131-142`
  — `is_valid_dns_hostname()` / `is_valid_doh_url()` are the syntactic
  validators a `doq_hostname` check would reuse.

### dnspython capability (verified in the worktree venv, 2026-08-11)

dnspython 2.7.0 (pinned at `backend/pyproject.toml:17` /
`backend/constraints.txt:45`) already ships the sync DoQ API:

```python
import dns.query, inspect
inspect.signature(dns.query.quic)
# (q: Message, where: str, timeout: Optional[float] = None, port: int = 853,
#  source=None, source_port=0, one_rr_per_rrset=False, ignore_trailing=False,
#  connection=None, verify: Union[bool, str] = True,
#  hostname: Optional[str] = None, server_hostname: Optional[str] = None)
```

Observed behavior (this machine, `dns.quic.have_quic is False`):

- The capability gate is **`dns.quic.have_quic`**, not `dns.query.have_quic`
  (no such attribute exists on `dns.query` in 2.7.0).
- With aioquic missing, `dns.query.quic()` raises `dns.query.NoDOQ`
  ("DNS-over-QUIC is not available."). The sync manager gate also checks
  `dns.quic.have_quic` at `dns/query.py:1374` / `:609`.
- There is **no `QUICFailed` exception class** in 2.7.0 (earlier dnspython
  versions had one). Connection failures surface as `dns.exception.Timeout`
  (retry-exhausted), `dns.quic.UnexpectedEOF`, `dns.query.NoDOQ`, or generic
  `OSError`/`Exception`. The spike wrapper therefore maps:
  `dns.exception.Timeout` → `failure_kind="timeout"`, `dns.query.NoDOQ` →
  `failure_kind="doq_unavailable"`, everything else → `"other"`.

### Optional-extra precedent

The repo already treats `maxminddb` as an optional extra —
`geoip = ["maxminddb==2.7.0"]` under `[project.optional-dependencies]`
(`backend/pyproject.toml:36`) — with graceful degradation
(`backend/app/geoip.py` imports it inside a `_load_maxminddb()` helper and
returns `None` when absent). This is the pattern an `aioquic` extra would
follow.

## 2. Catalog verification table

Verification against primary sources, 2026-08-11 (today). Secondary source:
[dnsprivacy.org/public_resolvers](https://dnsprivacy.org/public_resolvers/)
(DoQ section lists only AdGuard, 2020, and Quad9, March 2026 — no Cloudflare,
no Google).

| provider id | doq_hostname in catalog | primary source | verification date | verdict |
|---|---|---|---|---|
| cloudflare | `one.one.one.one` | none found — Cloudflare's current 1.1.1.1 docs (`developers.cloudflare.com/1.1.1.1/`, encryption index updated 2026-05-05, full index via `llms.txt`) document only DoT / DoH / ODoH; no DoQ page; blog sitemap has no DoQ announcement | 2026-08-11 | **unverifiable** — FLAG (plan-006: remove `doq` metadata or mark unknown) |
| google | `dns.google` | none found — Google's "Secure transports" page (`developers.google.com/speed/public-dns/docs/secure-transports`, updated 2024-09-03) documents only DoT + DoH; DoH there is DoH3 (HTTP/3), not RFC 9250 DoQ; [issue 309581930](https://issuetracker.google.com/issues/309581930) is an open feature request asking whether Google plans DoQ | 2026-08-11 | **unverifiable** — FLAG (plan-006) |
| quad9 | `dns.quad9.net` | [Quad9 blog, 2026-03-31](https://quad9.net/news/blog/quad9-enables-dns-over-http-3-and-dns-over-quic/): "For DoQ, use the hostname for the Quad9 service variant you want on port 853"; all variants support DoQ; filtering variant hostname `dns.quad9.net` per [service addresses](https://quad9.net/service/service-addresses-and-features) | 2026-08-11 | **verified** (port 853) |
| quad9-unsecured | `dns10.quad9.net` | same Quad9 sources; unsecured variant hostname `dns10.quad9.net` | 2026-08-11 | **verified** (port 853) |
| adguard | `dns.adguard.com` | [adguard-dns.io public DNS](https://adguard-dns.io/en/public-dns.html): DoQ is `quic://dns.adguard-dns.com` (default), `quic://unfiltered.adguard-dns.com`, `quic://family.adguard-dns.com` | 2026-08-11 | **mismatch** — FLAG: primary source documents `dns.adguard-dns.com`, not `dns.adguard.com`. `dns.adguard.com` still resolves to AdGuard's IPs (94.140.14.14/15) and is a legacy alias, but it is not the documented DoQ endpoint |

Ports: RFC 9250 default 853. Only Quad9's source states a port explicitly
(853). The AdGuard page does not state a DoQ port. No provider requires a
non-default port today.

## 3. Proposed API changes (described, not applied)

- **`backend/app/models.py`** — `BenchmarkProtocol` gains `doq = "doq"`.
  `CANONICAL_PROTOCOL_ORDER` extension is a comparison-contract decision
  (section 4); for standalone DoQ benchmarking no canonical-order change is
  needed.
- **`backend/app/runner.py`** — in `_protocol_endpoint_eligibility()`
  (`:315-339`) add a `BenchmarkProtocol.doq` branch mirroring the dot
  branch: `features.get("doq_hostname")` present+non-empty →
  `is_valid_dns_hostname()` → `(hostname, None)`, else
  `(None, "doq_hostname_missing")` / `(None, "doq_hostname_invalid")`.
  In `_measure_with_protocol()` (`:1744-1761`) add a `doq` branch calling
  `run_doq_query(resolver, domain, config.timeout_sec, doq_hostname)` where
  the new function follows `run_dot_query`'s shape but calls
  `dns.query.quic(q, resolver, timeout=timeout_sec, port=853,
  server_hostname=hostname)`.
- **`backend/app/providers.py`** — in `_validate_providers()` (`:47-81`)
  mirror the `doh` block (lines 73-81): when `features.doq == "yes"`,
  require `doq_hostname` to be a non-empty string matching
  `is_valid_dns_hostname()`; raise otherwise.
- **`backend/pyproject.toml` / `backend/constraints.txt`** — optional extra
  `doq = ["aioquic==1.3.0"]` (latest on PyPI at spike time; requires
  Python >= 3.10, abi3 wheels for manylinux x86_64/aarch64, musllinux,
  Windows, and macOS x86_64/arm64 — macOS wheels exist). Degradation matches
  the `maxminddb`/`geoip` precedent: `have_quic`-gated, explicit
  `doq_unavailable` sample. **Not installed by this spike.**
- **Packaging impact** — note: this repo has no checked-in PyInstaller spec
  file; `scripts/package_backend.py` builds the PyInstaller command inline
  (with `--hidden-import backports backports.tarfile`) and
  `packaging/flatpak/requirements.txt` feeds `make flatpak-python-deps`
  (flatpak-pip-generator → `packaging/flatpak/python3-requirements.json`).
  If DoQ ships in packaged builds, both mechanisms must include `aioquic`
  (aioquic imports `aioquic.quic` submodules dynamically, so the Flatpak
  module list and possibly `--hidden-import aioquic` need it). macOS wheel
  availability confirmed above — no build-from-source blocker.

## 4. Comparison-contract decision

The protocol-comparison contract (`ProtocolComparisonRequest`,
`CANONICAL_PROTOCOL_ORDER`, `docs/PROTOCOL_COMPARISON_METHODOLOGY.md`, and
`PROTOCOL_COMPARISON_MANIFEST_VERSION = 1`) is a deliberate, frozen
methodology. Two options:

- **(a) DoQ joins the comparison.** `CANONICAL_PROTOCOL_ORDER` becomes
  `udp, dot, doh, doq`; `protocols` length 2-4; methodology doc extended in
  the same commit; `PROTOCOL_COMPARISON_MANIFEST_VERSION` bumped; UI badge +
  comparison UI parity. Trade-off: touches a reviewed, test-gated contract
  in the same step as a brand-new transport.
- **(b) DoQ ships standalone first** (single-protocol benchmark only, like
  today's DoT/DoH single-protocol runs via `_measure_with_protocol`), with
  the comparison extension as a separate, maintainer-approved follow-up.

**Recommendation: (b).** The frozen methodology is a review gate, not a
formality; the DoQ capability can be validated and shipped without it, and
the contract extension gets its own dedicated decision with its own diff.

## 5. Decision list for the maintainer

1. **Comparison timing** — (b) standalone DoQ benchmark first, comparison
   extension (a) as a follow-up plan. (Recommended above.)
2. **aioquic mandatory vs optional-with-badge-gating** — recommend optional
   extra (`doq = ["aioquic==1.3.0"]`) with graceful `doq_unavailable`
   degradation, **and** hide/disable the DoQ badge in the resolver detail
   modal (and any DoQ protocol option) when `dns.quic.have_quic` is False.
   The current problem is precisely "DoQ shown but unmeasurable"; the badge
   must not be shown unless the benchmark can exercise it. Whether the
   desktop package forces the extra (so packaged builds always measure DoQ)
   is a release decision; the optional-extra + badge-gating pair works for
   both.
3. **DoQ port policy** — 853 default (RFC 9250). No catalog field for a
   per-provider port exists today; none of the 5 providers needs one.
   Recommendation: no new catalog field until a provider diverges.
4. **Catalog findings (plan-006 gate)** — the spike found no primary source
   for cloudflare (`one.one.one.one`) or google (`dns.google`) DoQ; adguard's
   catalog value (`dns.adguard.com`) is a legacy alias for the documented
   `dns.adguard-dns.com`. Recommendation: before or with the DoQ build plan,
   (i) remove or mark `doq: "yes"` on cloudflare + google until a primary
   source appears, and (ii) update adguard's `doq_hostname` (and review its
   `dot_hostname`/`doh_url`, which share the same legacy alias) to
   `dns.adguard-dns.com`. quad9 + quad9-unsecured stay as-is (verified).

## 6. Validation

Live DoQ validation requires the optional `aioquic` package in a **throwaway
venv** — the worktree venv must not receive it (nothing pinned/installed by
this spike). Exact commands for a maintainer:

```bash
# throwaway venv only
python3 -m venv /tmp/doq-check && /tmp/doq-check/bin/pip install aioquic
/tmp/doq-check/bin/python -c "import dns.query, dns.quic; print(dns.quic.have_quic)"   # expect True
# one-liner against Cloudflare / Quad9 (both serve DoQ on 853)
/tmp/doq-check/bin/python -c "
import dns.message, dns.query
q = dns.message.make_query('example.com', 'A')
r = dns.query.quic(q, '9.9.9.9', timeout=5, port=853, server_hostname='dns.quad9.net')
print(dns.rcode.to_text(r.rcode()), [rr.address for ans in r.answer for rr in ans if rr.rdtype == 1])
"
```

**Machine outcome: not validated on this machine — 2026-08-11.** The
worktree venv has no aioquic (`dns.quic.have_quic` is `False`); network is
available but the spike is CI-safe by design and the mock-based tests in
`backend/tests/test_doq_spike.py` are the validation gate. The
`doq_unavailable` path was exercised locally (test 3).

## 7. Spike results

What the prototype validated (2026-08-11):

- **Sample-dict shape parity.** `query_quic()` in
  `backend/tests/doq_query_spike.py` produces the same fields as
  `run_dnspython_query` (`ok`, `ms`, `query`, `error`, `failure_kind`,
  `answer_ips`), including rcode-derived kinds (nxdomain/servfail/refused/
  other) via a copy of `_rcode_to_failure_kind` (`runner.py:585`), so
  downstream stats/failure-classification code needs no changes.
- **Failure-kind mapping (revised from the plan excerpt).** dnspython 2.7.0
  has no `QUICFailed`; the wrapper maps `dns.exception.Timeout` →
  `"timeout"`, `dns.query.NoDOQ` → `"doq_unavailable"`, others →
  `"other"`. The degradation path (gate flag `dns.quic.have_quic`, not
  `dns.query.have_quic`) returns an explicit `doq_unavailable` sample
  instead of crashing.
- **Eligibility branch port.** `doq_endpoint_eligibility()` mirrors
  `_protocol_endpoint_eligibility`'s doq branch: hostname present + valid →
  endpoint; missing → `doq_hostname_missing`; invalid →
  `doq_hostname_invalid` (tested with the real `is_valid_dns_hostname`).
- **Transport injection.** The `transport` callable parameter lets tests run
  without network or aioquic; test 4 pins that `server_hostname` (the
  provider's `doq_hostname`) is passed through as TLS SNI.
- **Tests: 5/5 pass** (`pytest tests/test_doq_spike.py -q`), full gate
  `make backend-check` passes.

Revisions to the decision list: none from the prototype itself; the
**catalog verification (section 2)** is the spike's main factual addition —
two of five DoQ claims (cloudflare, google) are unverifiable from primary
sources and one (adguard) uses a legacy alias, which strengthens decision 4
(clean the catalog) before any DoQ build plan lands.
