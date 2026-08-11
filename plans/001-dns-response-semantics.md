# Plan 001: Classify DNS responses consistently and never recommend an unmeasured resolver

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report it; do not improvise. A coordinating reviewer maintains `plans/README.md` for this planning batch, so do **not** edit that file.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- backend/app/runner.py backend/app/stats.py backend/tests/test_encrypted_dns.py backend/tests/test_drill_parse.py backend/tests/test_failure_classification.py backend/tests/test_dnssec_check.py backend/tests/test_nxdomain_hijack.py backend/tests/test_stats.py`
> If any in-scope file changed since this plan was written, compare the Current state excerpts with live code. A material mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e09fd2d`, 2026-08-10
- **Merged**: `f97fe72`, 2026-08-10

## Why this matters

DNSpect's value is measurement integrity. A DNS message can be successfully transported while its DNS RCODE says NXDOMAIN, SERVFAIL, or REFUSED; those are not successful A-query measurements. The `drill`, DoT, and DoH paths currently treat such messages as successes, which corrupts reliability ranking and the blocking, DNSSEC, and NXDOMAIN-hijack signals. Separately, a run with no usable latency samples can currently look reliable and receive a recommendation; this plan makes the recommendation guardrail reject that state while retaining deterministic ordering for usable results.

## Current state

- `backend/app/runner.py` — transport adapters, result aggregation, and DNSSEC/NXDOMAIN/blocking diagnostics.
- `backend/app/stats.py` — normalized scores and recommendation selection.
- `backend/tests/test_encrypted_dns.py` — unit-test pattern for mocked DoT/DoH calls.
- `backend/tests/test_drill_parse.py` and `backend/tests/test_failure_classification.py` — focused parsing/classification test pattern.
- `backend/tests/test_dnssec_check.py`, `backend/tests/test_nxdomain_hijack.py`, and `backend/tests/test_stats.py` — end-to-end signal and scoring test patterns.

Current transport behavior (verbatim intent, `backend/app/runner.py:774-794`):

```python
combined = f"{proc.stdout}\n{proc.stderr}"
query_time_ms = parse_drill_query_time(combined)
if query_time_ms is None:
    failure_kind = classify_failure_from_text(combined)
    return {"ok": False, "ms": None, ..., "failure_kind": failure_kind}

answer_ips = DRILL_ANSWER_RE.findall(proc.stdout)
return {"ok": True, "ms": round(float(query_time_ms), 3), ..., "failure_kind": None}
```

`run_dot_query` and `run_doh_query` have the same issue: after `dns.query.tls(...)` / `dns.query.https(...)` returns, they iterate `response.answer` and return `ok=True` without checking `response.rcode()` (`backend/app/runner.py:825-887`). The downstream diagnostics depend on a normalized `failure_kind` (`backend/app/runner.py:695-732`): NXDOMAIN means clean for the hijack probe, SERVFAIL means DNSSEC validation, and NXDOMAIN/REFUSED contribute to blocking efficacy.

The reliability/recommendation issue spans these existing rules:

```python
# backend/app/runner.py:70,647-655
RELIABILITY_FAILURE_KINDS = {"timeout", "servfail", "refused", "noanswer", "other"}
failure_count = sum(
    1 for sample in samples if sample.get("failure_kind") in RELIABILITY_FAILURE_KINDS
)

# backend/app/stats.py:222-229
success_count = len(success_samples_ms)
failure_count = max(min(failure_count, total_runs), 0)
success_rate = round((1 - (failure_count / total_runs)), 4) if total_runs else 0.0

# backend/app/stats.py:139-141,207-213
item["is_unreliable"] = bool(
    bounded_failure_rate_opt is None or bounded_failure_rate_opt > RELIABILITY_GUARDRAIL_THRESHOLD
)
for item in results:
    if not bool(item.get("is_unreliable")):
        return str(item.get("resolver")), None
```

`run_dnspython_query` already emits NXDOMAIN as `ok=False`, `ms=None`, `failure_kind="nxdomain"` through its exception classifier (`backend/app/runner.py:191-202,815-822`). Therefore an all-NXDOMAIN normal query schedule yields zero usable latency samples, failure rate 0, and a currently eligible recommendation.

Conventions to retain:

- Samples are dictionaries with `ok`, `ms`, `query`, `error`, and `failure_kind`; imitate the existing exception-return shape in `run_dnspython_query`.
- `compute_blocking_efficacy` already treats `nxdomain` and `refused` as blocked (`backend/app/stats.py:62-81`); do not change its policy in this plan.
- Rankings use deterministic scores plus resolver identity (`backend/app/runner.py:73-83`). Keep that tie-breaker and the existing all-unreliable fallback behavior for resolvers that do have usable samples.
- Use pytest monkeypatches and small fake DNS objects as in `backend/tests/test_encrypted_dns.py:46-125`; do not use live DNS/network tests.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install backend tooling (only if `.venv` is absent) | `make backend-install` | exit 0 and `backend/.venv` exists |
| Focused transport/scoring tests | `cd backend && . .venv/bin/activate && pytest -q tests/test_encrypted_dns.py tests/test_drill_parse.py tests/test_failure_classification.py tests/test_dnssec_check.py tests/test_nxdomain_hijack.py tests/test_stats.py` | exit 0; all selected tests pass |
| Full backend quality gate | `make backend-check` | exit 0; Ruff, format check, mypy, Bandit, and pytest all pass |
| Scope review | `git diff --check && git status --short` | no whitespace errors; only in-scope files changed |

## Scope

**In scope** (the only files to modify):

- `backend/app/runner.py`
- `backend/app/stats.py`
- `backend/tests/test_encrypted_dns.py`
- `backend/tests/test_drill_parse.py`
- `backend/tests/test_failure_classification.py`
- `backend/tests/test_dnssec_check.py`
- `backend/tests/test_nxdomain_hijack.py`
- `backend/tests/test_stats.py`

**Out of scope**:

- `backend/app/models.py` and workload limits — handled by plan 002.
- Provider capability metadata and DoH endpoint completeness — handled by plan 006.
- API response/persistence shape, history, GeoIP, and path validation — handled by plans 005 and 014.
- Frontend labels, translations, and charts. Preserve the existing sample/result keys unless a new recommendation-warning constant is needed by the backend itself.
- Any live resolver query, provider claim validation, or change to private-resolver support.

## Git workflow

- Branch: `advisor/001-dns-response-semantics`.
- Commit the implementation and tests together using the observed conventional style, for example: `fix: classify DNS error responses consistently`.
- Do not push, open a PR, or edit `plans/README.md` unless the operator explicitly asks.

## Steps

### Step 1: Add one internal RCODE-to-sample normalization path

In `backend/app/runner.py`, add a small private helper or equivalent local logic that converts non-NOERROR DNS RCODEs into the established failure sample shape. It must map at least NXDOMAIN, SERVFAIL, and REFUSED to the same lower-case `failure_kind` values already consumed by `classify_failure_from_text`; unexpected non-NOERROR codes must become `other`. A non-NOERROR response must have `ok=False` and `ms=None`, not an observed latency sample.

Apply that normalization in all three affected paths:

1. In `run_drill_query`, inspect the RCODE before returning a timed success. A `Query time` plus a non-NOERROR header is still a failure.
2. In `run_dot_query`, inspect `response.rcode()` before iterating answers and returning success.
3. In `run_doh_query`, do the same.

Keep the existing timeout/exception handling and the literal-IP/no-shell command behavior unchanged. Do not classify a `NOERROR` message with an empty answer differently in this plan unless the existing dnspython parity test demonstrates a required policy; raise that as a STOP condition instead.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_encrypted_dns.py tests/test_drill_parse.py tests/test_failure_classification.py` → exit 0 after adding the focused tests in Step 2.

### Step 2: Characterize every timed transport RCODE outcome

Extend the focused tests without network access:

- In `backend/tests/test_drill_parse.py` (or `test_failure_classification.py` if it remains clearer), monkeypatch `subprocess.run` for `run_drill_query` and assert that timed NXDOMAIN, SERVFAIL, and REFUSED outputs are failures with the expected `failure_kind`.
- In `backend/tests/test_encrypted_dns.py`, make fake DoT/DoH response objects expose both `answer` and `rcode()`. Add at least one non-NOERROR response test per encrypted transport; cover NXDOMAIN and SERVFAIL across the pair, and ensure at least one test covers REFUSED in either transport.
- Retain the existing successful-answer and exception tests; they are the structural exemplars.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_encrypted_dns.py tests/test_drill_parse.py tests/test_failure_classification.py` → all tests pass and no test makes a real DNS request.

### Step 3: Make recommendation eligibility require usable measured stats

In `backend/app/stats.py`, add an explicit predicate for a result that is eligible for recommendation. It must require a usable measured latency/scoring state, not merely `is_unreliable is False`. A resolver with `success_count == 0`, `avg_ms is None`, or `score_total is None` must not be returned as a recommendation.

Preserve existing behavior for:

- a reliable resolver with valid stats: recommend the first ranked eligible resolver;
- all candidates that have usable stats but exceed the reliability threshold: retain the current deterministic fallback and `RECOMMENDATION_WARNING_ALL_UNRELIABLE`;
- no candidates at all: retain `(None, None)`.

For a non-empty list with no usable candidates, return `None` and a distinct, deterministic warning constant explaining that no resolver produced usable latency samples. Keep strings stable and avoid adding randomness or input-order dependence.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_stats.py` → exit 0 with existing deterministic-ranking tests still passing.

### Step 4: Test the guardrail through both scoring and benchmark diagnostics

Add tests that make the intended edge case unambiguous:

- In `backend/tests/test_stats.py`, build results from `compute_stats([], total_runs=..., timeout_count=0, failure_count=0)`, apply scoring, and assert that `select_recommended_resolver` returns no resolver plus the new no-usable-results warning. Also assert the existing all-unreliable fallback remains unchanged.
- In `backend/tests/test_nxdomain_hijack.py` or `backend/tests/test_dnssec_check.py`, add a manager-level test whose **normal benchmark queries** all return `failure_kind="nxdomain"`, `ok=False`, and `ms=None`; use a temporary run directory and monkeypatched measurement as the file already does. Assert final status is `done`, results contain zero successful latency samples, and `recommended_resolver is None` with the new warning.
- Ensure the existing blocking/NXDOMAIN/DNSSEC tests still prove their intended semantics after transport normalization.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_stats.py tests/test_dnssec_check.py tests/test_nxdomain_hijack.py` → exit 0; the new no-usable-results regression is covered at both unit and manager level.

### Step 5: Run the complete backend gate and inspect semantic diffs

Run the complete repository backend gate. Review the changed output field semantics: only error-RCODE samples, recommendation values/warnings for unusable data, and downstream metrics that correctly depend on those samples may change. Do not broaden the change into provider metadata or score-weight tuning.

**Verify**: `make backend-check` → exit 0.

## Test plan

- Transport unit tests: timed `drill` NXDOMAIN/SERVFAIL/REFUSED; DoT/DoH non-NOERROR response objects; existing success and exception behavior retained.
- Diagnostic regression: RCODE-produced `failure_kind` continues to drive blocking efficacy, NXDOMAIN-hijack, and DNSSEC checks through the existing manager logic.
- Recommendation guardrail: zero usable samples produces no recommendation and a deterministic warning; existing reliable and all-unreliable cases remain intact.
- Structural patterns: use fake response construction from `backend/tests/test_encrypted_dns.py` and temporary-manager polling from `backend/tests/test_nxdomain_hijack.py`.
- Final verification: `make backend-check` → all backend checks pass.

## Done criteria

- [ ] `run_drill_query`, `run_dot_query`, and `run_doh_query` never return `ok=True` for NXDOMAIN, SERVFAIL, or REFUSED.
- [ ] A timed non-NOERROR `drill` output has a non-null matching `failure_kind` and no latency sample.
- [ ] DoT and DoH tests cover non-NOERROR messages without network access.
- [ ] A result with no usable latency/scoring data is never recommended.
- [ ] Existing all-unreliable fallback remains deterministic and still emits its current warning.
- [ ] `make backend-check` exits 0.
- [ ] `git diff --check` exits 0 and `git status --short` lists only the in-scope files.
- [ ] `plans/README.md` is unchanged.

## STOP conditions

Stop and report back if:

- The source excerpts above have materially drifted, especially if another plan already introduced an RCODE helper or recommendation-eligibility policy.
- dnspython's intended semantics for a NOERROR response with no A answers conflict with the proposed non-NOERROR-only scope; do not silently invent a new policy.
- A required RCODE cannot be represented by dnspython's mocked response API without a live DNS query.
- The implementation requires changing public sample keys, provider data, model validation, or frontend code.
- `make backend-check` fails twice after a reasonable in-scope correction.

## Maintenance notes

- Any future transport (DoQ, TCP, or a new DNS library) must use the same RCODE-to-sample normalization before it feeds scoring or diagnostic signals.
- Reviewers should inspect the distinction between transport success and DNS query success; a low latency on a DNS error must not become a ranking sample.
- This plan deliberately does not change scoring weights, provider claims, or the definition of blocking domains. Those policies should be evaluated separately from response semantics.
