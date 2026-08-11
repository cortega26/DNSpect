# Plan 006: Reject unbenchmarkable encrypted-DNS claims and ambiguous resolver ownership

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report it; do not improvise. A coordinating reviewer maintains `plans/README.md` for this planning batch, so do **not** edit that file.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- backend/app/providers.py backend/app/runner.py data/dns_providers.es.json backend/tests/test_encrypted_dns.py backend/tests/test_providers.py`
> If any in-scope file changed since this plan was written, compare the Current state excerpts with live code. A material mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-dns-response-semantics.md`
- **Category**: bug
- **Planned at**: commit `e09fd2d`, 2026-08-10
- **Merged**: `64143ad`, 2026-08-11

## Why this matters

Provider metadata controls which literal-IP resolvers may enter an encrypted benchmark and which provider/policy is attached to every result. Six records claim DoH but give no endpoint URL; the current protocol filter accepts those entries and every scheduled DoH attempt immediately fails. A duplicate resolver IP is silently overwritten in the provider index, so the same measurement can be reported under a different provider and policy depending on file order. This plan makes benchmarkability and ownership explicit load-time invariants, corrects the known packaged-data violations without inventing endpoint claims, and preserves local/private-resolver UDP diagnostics.

## Current state

- `backend/app/providers.py` — loads the packaged provider JSON, expands default resolvers, and maps a resolver IP to one provider record.
- `backend/app/runner.py` — constructs a protocol-filtered benchmark and executes DoH using the provider's `doh_url`.
- `data/dns_providers.es.json` — packaged provider catalog and feature metadata.
- `backend/tests/test_encrypted_dns.py` — existing isolated `BenchmarkManager`/provider-index protocol filtering tests.
- `backend/tests/test_providers.py` — create this loader/index invariant test module; no current provider-data tests exist.

The loader validates only the top-level JSON type and the index overwrites duplicates (`backend/app/providers.py:35-42,77-82`):

```python
def load_providers() -> list[dict[str, Any]]:
    with PROVIDERS_PATH.open("r", encoding="utf-8") as f:
        providers = json.load(f)
    if not isinstance(providers, list):
        raise ValueError("dns_providers.es.json debe ser una lista")
    return providers

def resolver_provider_index(providers: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for provider in providers:
        for ip in provider.get("dns", []):
            index[ip] = provider
    return index
```

The manager accepts either a URL or a `"yes"` flag, but the query adapter can run only with a URL (`backend/app/runner.py:583-613,854-866`):

```python
def _resolver_supports_protocol(self, resolver_ip: str, protocol: str) -> bool:
    ...
    if protocol == "doh":
        return bool(features.get("doh_url") or features.get("doh") == "yes")

if config.protocol == "doh":
    ...
    doh_url = features.get("doh_url")
    return run_doh_query(resolver, domain, config.timeout_sec, doh_url)

def run_doh_query(..., doh_url: str | None) -> dict[str, Any]:
    if not doh_url:
        return {"ok": False, "ms": None, ..., "error": "No DoH URL configured for this resolver"}
```

Six records currently satisfy `features.doh == "yes"` while `doh_url == ""`:

```json
// data/dns_providers.es.json:551-576 and 580-604
{ "id": "alidns", "dns": ["223.5.5.5", "223.6.6.6"],
  "features": { "doh": "yes", "doh_url": "" } }
{ "id": "dnspod", "dns": ["119.29.29.29"],
  "features": { "doh": "yes", "doh_url": "" } }

// data/dns_providers.es.json:871-895, 900-924, 929-954, 990-1015
{ "id": "yandex-basic", "features": { "doh": "yes", "doh_url": "" } }
{ "id": "yandex-safe", "features": { "doh": "yes", "doh_url": "" } }
{ "id": "yandex-family", "features": { "doh": "yes", "doh_url": "" } }
{ "id": "alternate-dns", "features": { "doh": "yes", "doh_url": "" } }
```

`8.20.247.20` belongs to both a normal and purported family Comodo record (`data/dns_providers.es.json:638-665,1461-1488`), but the index's last assignment makes only the latter visible:

```json
{ "id": "comodo", "dns": ["8.26.56.26", "8.20.247.20"],
  "features": { "family": "no" } }
{ "id": "comodo-family", "dns": ["8.26.56.27", "8.20.247.20"],
  "features": { "family": "yes" } }
```

Existing protocol test conventions use a temporary manager, monkeypatch its index, and assert manager admission errors without network work (`backend/tests/test_encrypted_dns.py:200-279`):

```python
manager = BenchmarkManager(..., data_runs_dir=tmp_path / "runs")
monkeypatch.setattr(manager, "provider_index", {})
with pytest.raises(ValueError, match="No hay resolvers disponibles para el protocolo seleccionado"):
    manager.start(BenchmarkRequest(..., protocol="dot"))
```

The catalog uses three current feature values (`"yes"`, `"no"`, and `"unknown"`). The narrow invariant in this plan is one-way: a record advertised as `doh == "yes"` must contain a syntactically usable HTTPS URL. It intentionally does **not** claim that every `doh_url` paired with `"no"` should be relabelled; resolving that broader catalog-policy inconsistency is out of scope. No live DNS probe may be used as evidence for a provider capability claim.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install backend tooling (only if `.venv` is absent) | `make backend-install` | exit 0 and `backend/.venv` exists |
| Focused provider/protocol tests | `cd backend && . .venv/bin/activate && pytest -q tests/test_providers.py tests/test_encrypted_dns.py` | exit 0; all selected tests pass without network DNS |
| Packaged-data smoke import | `cd backend && . .venv/bin/activate && python -c 'from app.providers import load_providers, resolver_provider_index; providers = load_providers(); assert resolver_provider_index(providers); print(len(providers))'` | exit 0 and prints a positive provider count |
| Full backend quality gate | `make backend-check` | exit 0; Ruff, format check, mypy, Bandit, and pytest all pass |
| Scope review | `git diff --check && git status --short` | no whitespace errors; implementation/test/data changes only in the in-scope paths, plus coordinator-owned plan files already present |

## Scope

**In scope** (the only files to modify):

- `backend/app/providers.py`
- `backend/app/runner.py`
- `data/dns_providers.es.json`
- `backend/tests/test_encrypted_dns.py`
- `backend/tests/test_providers.py` (create)

**Out of scope**:

- DNS response/RCODE classification and ranking/recommendation policy; plan 001 owns those semantics.
- Pydantic validation of user-supplied literal resolver IPs, private/internal resolver support, endpoint SSRF policy, and system-DNS detection. This app intentionally permits local diagnostic resolvers and fixed transports do not use `shell=True`.
- DoT/DoQ hostname completeness, IPv6 catalog expansion, provider privacy/security claim validation, or catalogue-wide feature taxonomy cleanup.
- Frontend component labels/translations and any provider-card redesign. This plan changes the backend's benchmarkable catalog data only.
- Adding an unverified URL, scraping a third-party list, or making a live query to prove a provider feature.

## Git workflow

- Branch: `advisor/006-provider-data-invariants`.
- Commit data validation, the minimal catalog correction, and regression tests together using the repository's Conventional Commit style, for example: `fix: validate benchmarkable provider metadata`.
- Do not push, open a PR, or edit `plans/README.md` unless the operator explicitly asks.

## Steps

### Step 1: Make provider loader failures explicit and deterministic

In `backend/app/providers.py`, add private validation invoked by `load_providers()` after the existing top-level-list check. It must fail with concise actionable `ValueError`s before `BenchmarkManager` starts when any of these invariants fails:

1. Every provider has a non-empty string `id`, and IDs are unique.
2. Every provider has a non-empty `dns` list of non-empty string resolver values.
3. `features` is a dictionary. When `features["doh"] == "yes"`, `features["doh_url"]` is a non-empty absolute HTTPS URL with a hostname. Use standard-library URL parsing; do not fetch the URL.
4. A resolver value may be owned by only one provider ID across the catalog. Error text must identify the duplicated resolver and both provider IDs, not depend on file order.

Also make `resolver_provider_index()` defensive: if it receives an invalid/duplicate provider list directly rather than through `load_providers()`, it must raise rather than silently overwrite an earlier owner. Keep its successful return type and existing callers unchanged. Do not use `assert` for data validation or mutate/reorder the input records.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_providers.py` → exit 0 after Step 3 adds invalid-fixture cases.

### Step 2: Define DoH admission by the executable endpoint, not the display flag

In `BenchmarkManager._resolver_supports_protocol()` in `backend/app/runner.py`, make DoH eligibility require a non-empty configured `doh_url` that passed loader validation. The `"yes"` flag alone must never admit a resolver to an encrypted benchmark, because `_measure_with_protocol()` can only call `run_doh_query()` with the URL.

Retain current UDP behavior, DoT behavior, unknown-provider exclusion for encrypted modes, and literal-IP request validation. Preserve compatibility for records that already have a configured URL even if their display flag is not `"yes"`; this plan's loader invariant is intentionally one-way and must not silently remove existing endpoint-backed DoH coverage.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_encrypted_dns.py` → exit 0 after Step 3 adds capability cases.

### Step 3: Correct only the known packaged-data violations without inventing claims

Make these exact data changes in `data/dns_providers.es.json`:

- Change `features.doh` from `"yes"` to `"no"` for `alidns`, `dnspod`, `yandex-basic`, `yandex-safe`, `yandex-family`, and `alternate-dns`, leaving their blank `doh_url` fields blank. In this catalog, `"yes"` means DNSpect has a concrete endpoint it can benchmark, not merely that an operator may offer a protocol elsewhere. Do not fabricate endpoint URLs.
- Remove the complete `comodo-family` record. The included standard Comodo record owns `8.20.247.20`; the catalog has no current primary-source-backed, non-overlapping family endpoint configuration for the second record. Removing the unsupported record avoids presenting `8.20.247.20` as both normal and family-filtered.

Before committing this deletion, consult a current primary Comodo/Xcitium operator document **only** to see whether it publishes a distinct family-filtered public resolver pair. If it does, keep a family record only when both literal IPs and associated capability claims can be represented without duplication and are documented in that source. Record the source URL in the record's non-secret maintenance metadata only if the project already has a field/convention for citations; otherwise do not add a new schema field. Do not infer an endpoint from a sibling service, a DNS response, or a third-party list.

**Verify**: `cd backend && . .venv/bin/activate && python -c 'from app.providers import load_providers, resolver_provider_index; providers = load_providers(); index = resolver_provider_index(providers); assert "8.20.247.20" in index; assert index["8.20.247.20"]["id"] == "comodo"; assert all(not (p["features"].get("doh") == "yes" and not p["features"].get("doh_url")) for p in providers)'` → exit 0 with all assertions true.

### Step 4: Add isolated loader, index, and protocol regressions

Create `backend/tests/test_providers.py`. Use `tmp_path` JSON fixtures and `monkeypatch` of `app.providers.PROVIDERS_PATH`; restore behavior automatically through pytest. Cover all of the following without starting a live benchmark:

- a minimal valid record with a `doh == "yes"` absolute HTTPS URL loads successfully;
- `doh == "yes"` with an empty URL, non-string URL, relative URL, `http` URL, or hostless URL raises `ValueError` that identifies the provider ID;
- duplicate provider IDs, missing/empty DNS lists, and a duplicate resolver across two different provider IDs raise deterministic errors;
- a direct `resolver_provider_index()` call with duplicate ownership also raises instead of retaining the last record;
- packaged `load_providers()` plus `resolver_provider_index()` succeeds and has one index entry per catalog resolver after the Step 3 correction.

Extend `backend/tests/test_encrypted_dns.py` using its existing temporary-manager convention:

- a fake provider with `doh == "yes"` and an empty URL is excluded/rejected before work is submitted;
- a fake provider with a configured HTTPS `doh_url` remains eligible even when the display flag is not `"yes"`, preserving endpoint-backed current behavior;
- the existing no-resolvers and DoT tests remain unchanged except for imports/helpers strictly needed by the new case.

Do not test endpoint reachability. Do not add a test that relies on the production global manager or external data path outside the explicitly packaged-data smoke test.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_providers.py tests/test_encrypted_dns.py` → all existing and new tests pass.

### Step 5: Run the full quality gate and inspect catalog semantics

Run the full backend check. Review the data diff specifically: it must remove only the unverified duplicate family record and downgrade only the six `yes`+empty-endpoint entries. Existing `doh_url` values associated with a non-`yes` display value stay unchanged, because their broader metadata reconciliation is deliberately deferred.

**Verify**: `make backend-check` → exit 0.

## Test plan

- Loader invariants: malformed top-level/provider structure, duplicate IDs, empty resolver lists, duplicate resolver ownership, and malformed/empty DoH URL advertised as supported.
- Index invariant: direct callers cannot silently overwrite a resolver owner.
- Capability admission: a flag-only DoH record is rejected before execution; a real configured endpoint remains eligible; UDP/DoT paths preserve existing behavior.
- Packaged catalog regression: every advertised DoH record has an HTTPS URL, every resolver maps to exactly one provider, and the Comodo normal record owns `8.20.247.20` after removal of the unsupported duplicate.
- Final verification: `make backend-check` → all backend checks pass.

## Done criteria

- [ ] `load_providers()` rejects malformed provider records, `doh == "yes"` without an absolute HTTPS endpoint, duplicate IDs, and duplicate resolver ownership with deterministic actionable errors.
- [ ] `resolver_provider_index()` never silently overwrites a duplicate owner, including when called directly.
- [ ] DoH protocol filtering cannot schedule a resolver whose only support signal is `doh == "yes"` with no endpoint URL.
- [ ] The six known blank-endpoint records are no longer advertised as benchmarkable DoH, with no invented URLs.
- [ ] `comodo-family` is removed unless a current primary source proves a distinct non-overlapping family configuration; `8.20.247.20` maps to the standard `comodo` record in the shipped catalog.
- [ ] Existing configured DoH endpoints paired with a non-`yes` display flag remain eligible, avoiding an unrelated capability regression.
- [ ] `make backend-check` exits 0.
- [ ] `git diff --check` exits 0 and implementation/test/data changes are confined to the in-scope paths.
- [ ] `plans/README.md` is unchanged.

## STOP conditions

Stop and report back if:

- The packaged catalog has changed so the listed records/duplicate or their feature schema no longer match the Current state excerpts.
- A current primary operator source proves `comodo-family` has a distinct pair but the required corrected fields cannot be represented by the existing schema without adding alias/multi-owner semantics.
- Product ownership defines `features.doh == "yes"` as a purely informational claim that must remain visible despite DNSpect having no benchmark endpoint; this requires a UI/schema policy decision outside this plan.
- Loader validation would cause a shipped catalog with known legitimate aliases to fail and no explicit canonical-owner/alias model exists.
- Implementing the invariant requires a live provider query, network fetch during startup, third-party endpoint data, model/API/frontend changes, or a change to private-resolver behavior.
- `make backend-check` fails twice after a reasonable in-scope correction.

## Maintenance notes

- Treat provider JSON as executable benchmark configuration, not an unvalidated display list. Any future `doh == "yes"` edit needs a concrete HTTPS endpoint and a focused data test.
- Reviewers should check that duplicate detection fails closed rather than relying on catalog order, and that validation does not claim to verify remote endpoint availability.
- A future catalog-governance task can reconcile entries with `doh_url` but a non-`yes` display flag, validate DoT/DoQ configuration, and establish citation provenance. Those changes are intentionally excluded here.
