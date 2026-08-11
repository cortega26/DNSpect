# Plan 016: Make the published documentation match the verified product and release contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A coordinating reviewer maintains
> `plans/README.md` for this planning batch, so do **not** edit that file.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- README.md CONTRIBUTING.md SECURITY.md CLAUDE.md frontend/README.md docs/ARCHITECTURE.md docs/PROVIDERS.md docs/RELEASE_CHECKLIST.md docs/RELEASE_VERIFY.md docs/TROUBLESHOOTING.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-dns-response-semantics.md`, `plans/003-profile-target-model.md`, `plans/004-region-targeting-and-egress.md`, `plans/006-provider-data-invariants.md`, `plans/011-dependency-security-remediation.md`, `plans/013-windows-release-verification.md`
- **Category**: docs, dx, direction
- **Planned at**: commit `e09fd2d`, 2026-08-10

## Why this matters

DNSpect's docs currently describe obsolete build versions, a non-existent macOS
x64 asset, a three-factor scoring table where the code uses four factors, an
incomplete endpoint list, and an egress claim contradicted by the startup
public-IP request. They also mix user scoring preferences, provider filtering,
and region behavior even though the repository explicitly requires scoring
profiles and target profiles to be independent. This plan makes each published
claim traceable to completed code or an approved decision record, so users,
contributors, and release reviewers no longer receive contradictory guidance.

## Current state

- `README.md` — user-facing feature, platform, privacy, and roadmap claims.
- `docs/ARCHITECTURE.md` — Spanish system design, scoring, API, persistence,
  and packaging reference.
- `CONTRIBUTING.md`, `CLAUDE.md`, and `frontend/README.md` — developer setup
  and architecture guidance.
- `SECURITY.md` and `docs/PROVIDERS.md` — public security/egress and catalog
  language that must not imply unvalidated provider claims.
- `docs/RELEASE_CHECKLIST.md`, `docs/RELEASE_VERIFY.md`, and
  `docs/TROUBLESHOOTING.md` — release and Windows operational instructions.
- `docs/PROFILE_MODEL.md` and `docs/REGION_TARGETING.md` — prerequisite
  decision records created by plans 003 and 004; read them, but do not edit
  them here.

The README contradicts the shipped release matrix and current egress code:

```markdown
# README.md:69-85
- Release binaries generated for:
  - Linux x64
  - Windows x64
  - macOS x64
  - macOS arm64
...
- Local-first execution: no telemetry or analytics pipeline in this repo.
- Network egress is DNS query traffic to selected resolvers only.
```

The current release workflow publishes Linux x64, Windows x64, and macOS arm64
only (`.github/workflows/release.yml:19-34,254-263`). The frontend currently
attempts `https://api.ipify.org?format=json` during initialization and sends
the returned IP to local `/api/geoip` (`frontend/src/lib/api.ts:41-55` and
`frontend/src/App.tsx:276-319`). Plan 004 may change or remove that mechanism,
so the final docs must describe the **implemented, approved** policy from
`docs/REGION_TARGETING.md`, not freeze this current implementation as a
permanent promise.

The architecture document has concrete code/documentation drift:

```markdown
# docs/ARCHITECTURE.md:32-40
| Goal | Latency | Reliability | Stability |
| speed | 0.60 | 0.30 | 0.10 |
...
# docs/ARCHITECTURE.md:69-77
| `/api/benchmarks/{id}` | GET | Poll de estado/resultados |
| `/api/benchmarks/{id}/export.json` | GET | Exportación JSON |
```

```python
# backend/app/stats.py:16-23
# Goal-aware scoring weights: latency, reliability, stability, blocking
"speed": (0.55, 0.25, 0.10, 0.10)
...

# backend/app/main.py:105-118
@app.get("/api/benchmarks/history")
def benchmark_history() -> dict: ...
@app.get("/api/benchmarks/{benchmark_id}")
def benchmark_status(...): ...
```

The source-level profile contract currently conflicts with user-facing wording:

```markdown
# AGENTS.md:16-18,31-37
**Profiles**: User Profiles (ranking policy) and Target Profiles (resolver
selection) are independent. Never conflate.
...
No continent-based grouping, brand-based recommendations, or privacy-claims
validation.
...
Target Profiles → Region filter → DoH/DoT comparison → Exportable reports
```

Today `README.md:28-31` and `CLAUDE.md:107-110` describe goals as provider
filters and geography as continent filtering, while the start payload has one
`goal` and an independently selected resolver array
(`frontend/src/lib/api.ts:4-12,58-78`). Plan 003 defines the required canonical
`scoring_profile` / immutable `target_snapshot` vocabulary. Plan 004 must
record an owner-approved region/egress policy before documentation can state
whether a region changes targets or is merely a view. This plan must consume
those records; it must not resolve their product-policy questions itself.

Other factual drift to correct:

- `docs/RELEASE_CHECKLIST.md:1,5-7,39-42` is hard-coded to v0.2.0 even though
  `backend/app/__init__.py:1` and `frontend/package.json:4` say 1.2.0.
- `frontend/README.md:35-43` instructs `npm install`, while the repository
  lock contract uses `npm ci` (`Makefile:28-29` and
  `.github/workflows/ci.yml:90-103`).
- `CONTRIBUTING.md:7-14` asks contributors to run a different backend command
  sequence than `make backend-check`, and points Flatpak changes at the ignored
  `.agents/flathub-compliance.md` (`CONTRIBUTING.md:16-48`,
  `.gitignore:31-32`).
- `docs/PROVIDERS.md:5-33` makes provider performance, privacy, GDPR, and
  filtering assertions despite the repository's explicit non-goal of
  privacy-claim validation. Provider records are test targets, not endorsed
  products (`AGENTS.md:5,33`).
- `scripts/dev.ps1`/`scripts/smoke_test.ps1` become Python-3.13-enforced and a
  packaged Windows smoke exists after plan 013; troubleshooting/release docs
  must describe that final verified workflow rather than an untested claim.

Conventions to retain:

- English README/user-release material and Spanish architecture/troubleshooting
  material remain in their existing languages; do not translate unrelated docs
  in this plan.
- `backend/pyproject.toml`, the workflow matrix, and completed test/decision
  records are evidence sources. Documentation never becomes a competing source
  of profile, region, Python, or release policy.
- Use neutral measurement language: resolver catalog metadata enables test
  selection; benchmark results describe the user's observed path, not a
  universal recommendation or validation of provider marketing claims.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prerequisite decision-record check | `test -s docs/PROFILE_MODEL.md && test -s docs/REGION_TARGETING.md && rg -n 'scoring_profile|target_snapshot' docs/PROFILE_MODEL.md && rg -n 'egress|target|region|approved' docs/REGION_TARGETING.md` | exit 0; both approved records contain their contract vocabulary |
| Confirm current version agreement | `python3 -c 'import json, tomllib; from pathlib import Path; versions={tomllib.loads(Path("backend/pyproject.toml").read_text())["project"]["version"], Path("backend/app/__init__.py").read_text().split("\"")[1], json.loads(Path("frontend/package.json").read_text())["version"]}; assert len(versions) == 1, versions; print("version-contract-ok:" + versions.pop())'` | prints `version-contract-ok:<current version>` |
| Verify scoring/API docs against code | `rg -n 'GOAL_WEIGHTS|/api/benchmarks/history' backend/app/stats.py backend/app/main.py docs/ARCHITECTURE.md` | every code contract has a matching documented entry |
| Check obsolete release/toolchain claims in this plan's docs | `rg -n 'v0\.2\.0|macOS x64|Node 22|Python 3\.11|Python 3\.12|node22' README.md CONTRIBUTING.md SECURITY.md CLAUDE.md frontend/README.md docs/ARCHITECTURE.md docs/PROVIDERS.md docs/RELEASE_CHECKLIST.md docs/RELEASE_VERIFY.md docs/TROUBLESHOOTING.md` | exit 1 (no matches) |
| Check the final egress disclosure | `rg -n 'telemetry|egress|public IP|GeoIP|DNS query' README.md SECURITY.md docs/ARCHITECTURE.md docs/REGION_TARGETING.md` | exit 0; each user/security architecture surface links or describes the approved final behavior |
| Verify local Markdown links | `python3 -c 'from pathlib import Path; import re; files=[Path(p) for p in ("README.md","CONTRIBUTING.md","SECURITY.md","CLAUDE.md","frontend/README.md","docs/ARCHITECTURE.md","docs/PROVIDERS.md","docs/RELEASE_CHECKLIST.md","docs/RELEASE_VERIFY.md","docs/TROUBLESHOOTING.md")]; refs=((path,target) for path in files for target in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", path.read_text(encoding="utf-8"))); bad=[f"{path}: {target}" for path,target in refs if "://" not in target and not target.startswith("mailto:") and not (path.parent / target).resolve().exists()]; assert not bad, "\n".join(bad); print("local-markdown-links-ok")'` | prints `local-markdown-links-ok` |
| Final application evidence | `make backend-check && cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build` | all commands exit 0 |
| Scope review | `git diff --check && git status --short` | no whitespace errors; only in-scope docs changed |

## Scope

**In scope** (the only files you should modify):

- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CLAUDE.md`
- `frontend/README.md`
- `docs/ARCHITECTURE.md`
- `docs/PROVIDERS.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/RELEASE_VERIFY.md`
- `docs/TROUBLESHOOTING.md`

**Out of scope**:

- `AGENTS.md`, `docs/PROFILE_MODEL.md`, and `docs/REGION_TARGETING.md` — the
  governing policy and approved decision records owned by plans 003/004. Read
  them; do not rewrite their decisions.
- `docs/BUILD.md` and dependency/build instructions there — plan 011 owns the
  lock/toolchain remediation and documentation.
- `docs/distribution/flathub-readiness.md`, Flatpak metadata, generated
  modules, and non-versioned `.agents` guidance — plan 012 owns packaging
  parity.
- `CHANGELOG.md` — preserve historical release entries rather than rewriting
  past claims using a later audit database.
- Provider JSON, provider feature fields, external source verification, score
  weights, API behavior, translations, and application code. Plans 001/003/
  004/006/013 own the facts documented here.
- Adding/removing roadmap features, deciding region/egress consent, adding
  continent grouping, provider endorsements, or privacy-claim validation.
- `plans/README.md` and all other plan files.

## Git workflow

- Branch: `advisor/016-documentation-contract`.
- Start only after all listed dependencies are complete and the two profile /
  region decision records have an approved final state.
- Use focused conventional documentation commits, for example:
  `docs: align product and release contract with verified behavior`.
- Do not push, tag, publish a release, or edit `plans/README.md` unless the
  operator explicitly asks.

## Steps

### Step 1: Establish the evidence ledger before changing prose

Read the completed `docs/PROFILE_MODEL.md` from plan 003 and
`docs/REGION_TARGETING.md` from plan 004, then inspect the final live
`frontend/src/lib/api.ts`, `frontend/src/lib/egress.ts` (if created),
`frontend/src/App.tsx`, `backend/app/stats.py`, `backend/app/main.py`, both
workflows, and the final release smoke scripts. Record a short working ledger
for the documentation commit that maps every claim below to one of those files
or decision records:

- canonical scoring-profile and target-snapshot vocabulary;
- whether/how a region affects target selection, allowed scope values, manual
  override behavior, and unsupported/unknown fallback;
- every network egress endpoint, data element, initiation/consent behavior,
  timeout/fallback, and persistence behavior;
- score dimensions/weights, endpoint inventory, release assets, and verified
  Windows smoke coverage.

Do not write a product decision into a user document. In particular, if plan
004's record says egress is not approved, remove external-IP claims from docs;
if it permits an endpoint, name exactly the approved mechanism and limits; if
the region policy is view-only, do not imply it changes the benchmark target.
If either record is missing, ambiguous, or disagrees with live code, stop.

**Verify**: run the prerequisite decision-record check from the commands table
→ both records are non-empty and their canonical terms are found before any
in-scope documentation changes.

### Step 2: Correct the product, measurement, profile, and privacy narrative

Update `README.md`, `docs/ARCHITECTURE.md`, `SECURITY.md`, `CLAUDE.md`, and
`docs/PROVIDERS.md` from the evidence ledger:

1. In README platform compatibility, list only the asset names/architectures
   actually produced by the final release matrix: Linux x64, Windows x64, and
   macOS arm64. Link to `docs/RELEASE_VERIFY.md`; do not promise macOS x64.
2. In `docs/ARCHITECTURE.md`, replace the old three-column score table with the
   exact live four dimensions (latency, reliability, stability, blocking) and
   all `GOAL_WEIGHTS` values from final `backend/app/stats.py`. Add the history
   endpoint and describe recommendation behavior only as implemented after
   plan 001's guardrail changes; do not preserve the old unconditional
   all-unreliable fallback wording if it no longer matches code.
3. Replace `goal`/provider-filter wording with plan 003's canonical distinction:
   a scoring profile controls ranking policy; the immutable target snapshot
   records what was measured. Do not claim a scoring-profile change selects or
   recommends a provider.
4. State region semantics only as approved in `docs/REGION_TARGETING.md`. It
   must be described as target-selection metadata or a view filter exactly as
   that record says, never as a continent-based recommendation. Update the
   README roadmap using the approved terms from the decision records and the
   existing AGENTS roadmap; do not revive unrelated feature promises unless an
   owner explicitly retained them.
5. Replace "DNS query traffic ... only" with an accurate, concise disclosure
   of final outbound behavior. Retain a no-telemetry statement only if still
   true, and distinguish it from any approved public-IP/GeoIP call. State the
   allowed data, purpose, timing/consent, failure fallback, and storage
   behavior without declaring provider privacy/security practices.
6. Rewrite `docs/PROVIDERS.md` into neutral catalog/measurement language.
   Keep useful provider IDs and resolver-test context, but remove or qualify
   unverified claims such as privacy, no logging, GDPR, malware protection, or
   quality superiority. Add one concise disclaimer that catalog labels are
   selection metadata, not DNSpect endorsements or validation of provider
   claims; do not change the JSON catalog in this documentation plan.

Keep the Spanish architecture document Spanish and preserve its existing
technical terminology where it accurately maps to the approved English
profile/target vocabulary.

**Verify**: `rg -n '/api/benchmarks/history|Blocking|blocking|scoring_profile|target_snapshot' README.md docs/ARCHITECTURE.md CLAUDE.md && ! rg -n 'Network egress is DNS query traffic to selected resolvers only|macOS x64' README.md SECURITY.md docs/ARCHITECTURE.md` → required current concepts are documented; stale egress/macOS claims are absent.

### Step 3: Make contributor and frontend setup instructions lock- and policy-aware

Update `CONTRIBUTING.md`, `frontend/README.md`, and `CLAUDE.md` to use the
completed development contract:

- require Python 3.13+ and Node 24 where prerequisites are stated;
- use `npm ci`, not `npm install`, for a reproducible frontend setup;
- name the real backend gate (`make backend-check`) and plan 011's
  `make dependency-audit` instead of a divergent hand-assembled command list;
- retain focused frontend lint/typecheck/test/build commands; and
- replace the contributor reference to ignored `.agents/flathub-compliance.md`
  with the tracked `docs/distribution/flathub-readiness.md`. Link to that
  runbook for Flatpak generator/bootstrap details rather than duplicating
  plan 012's version-sensitive commands here.

In `CLAUDE.md`, update the architecture overview to reference the completed
profile/target and region decision records rather than re-explaining their
policy. Keep its Recharts lazy-load, accessibility, translation, and
determinism constraints intact.

**Verify**: `rg -n 'npm ci|Python >=3\.13|Node 24|make backend-check|make dependency-audit|docs/distribution/flathub-readiness\.md' CONTRIBUTING.md CLAUDE.md frontend/README.md && ! rg -n 'npm install|\.agents/flathub-compliance\.md' CONTRIBUTING.md frontend/README.md` → current setup/gate/runbook references are present and stale setup/source-of-truth instructions are absent.

### Step 4: Turn release and Windows documentation into a reusable verification checklist

Replace fixed v0.2.0 values in `docs/RELEASE_CHECKLIST.md` with a
`<version>` placeholder plus an exact command that verifies
`backend/app/__init__.py`, `backend/pyproject.toml`, and
`frontend/package.json` agree before tag creation. Make the checklist require:

- the final CI dependency-audit, backend, frontend, packaged-Linux, and
  packaged-Windows checks;
- production frontend build and package artifact generation;
- the release-matrix assets `dnspect-linux-x64`,
  `dnspect-windows-x64.exe`, and `dnspect-macos-arm64` plus checksums; and
- the pre-upload Windows headless smoke from plan 013.

Update `docs/RELEASE_VERIFY.md` to retain correct checksum/GPG guidance while
stating the actual matrix asset set, the Windows executable name, the macOS
arm64-only channel, and the local health/root-page sanity check. Do not claim a
signature exists when signing is optional.

Update `docs/TROUBLESHOOTING.md` with a Windows Python-3.13 section: explain
how to inspect `backend\.venv\Scripts\python.exe`, remove/recreate a stale
local venv only when the contributor chooses to do so, rerun the PowerShell
script, and use the new packaged-artifact smoke/log diagnostics. Preserve the
existing localhost/firewall and port-override advice.

**Verify**: `rg -n 'v<version>|dependency-audit|packaged-windows-smoke|dnspect-windows-x64\.exe|dnspect-macos-arm64|Python 3\.13|smoke_packaged_windows\.ps1' docs/RELEASE_CHECKLIST.md docs/RELEASE_VERIFY.md docs/TROUBLESHOOTING.md` → each reusable release/Windows verification element is present; `rg -n 'v0\.2\.0|macOS x64' docs/RELEASE_CHECKLIST.md docs/RELEASE_VERIFY.md docs/TROUBLESHOOTING.md` exits 1.

### Step 5: Validate documentation claims against final code and quality gates

Run the version, scoring/API, egress, stale-claim, and local-link commands
from the commands table. Re-read each changed paragraph against the final
source/decision record: if a claim cannot be supported by code, a generated
release artifact, or an approved record, remove it rather than qualifying it
with speculation. Then run the final backend/frontend gates to confirm the
documentation describes a buildable final state.

**Verify**: run every command in the commands table in order → all positive
checks exit 0, the stale-claim search exits 1, and no changed document contains
an unsupported product/privacy/release assertion.

## Test plan

- Contract evidence: versions agree across backend/module/frontend; final score
  table and endpoint inventory are checked against `stats.py` and `main.py`.
- Profile/region/egress regression: both approved decision records exist and
  user/security/architecture docs describe their final implemented policy
  without choosing a new one.
- Release regression: checklist has no fixed retired version or macOS x64 asset
  and names the CI/release Windows smoke before upload.
- DX regression: frontend quickstart uses `npm ci`; contributor docs point to
  existing gates and the tracked Flatpak runbook, not ignored agent notes.
- Documentation integrity: relative links resolve, stale literal claims are
  absent, `git diff --check` passes, and complete backend/frontend gates pass.

## Done criteria

- [ ] The README lists only the release assets/architectures actually produced
  by the final workflow and links to current verification guidance.
- [ ] Architecture scoring has all four live dimensions/weights and documents
  `/api/benchmarks/history`; recommendation wording matches completed plan 001
  behavior.
- [ ] Profile, target snapshot, region, and egress language is copied only from
  completed plans 003/004 decision records and final code; no new policy is
  introduced.
- [ ] README, SECURITY, and architecture disclosures accurately describe final
  outbound behavior and do not say resolver DNS is the only egress if an
  approved public-IP/GeoIP mechanism remains.
- [ ] Provider documentation uses neutral measurement/catalog language and
  explicitly avoids endorsement or validation of provider privacy/security
  claims.
- [ ] Contributor/frontend docs use Python 3.13+, Node 24, `npm ci`, existing
  local quality/audit gates, and the tracked Flatpak runbook.
- [ ] Release checklist/verification/troubleshooting use a version placeholder,
  correct asset names, and the plan-013 Windows packaged smoke workflow.
- [ ] Local Markdown links resolve, stale version/toolchain/asset searches have
  no matches, and `make backend-check && cd frontend && npm ci && npm run lint
  && npm run typecheck && npm test && npm run build` exits 0.
- [ ] `git diff --check` exits 0 and `git status --short` lists only in-scope
  files.
- [ ] `plans/README.md` is unchanged.

## STOP conditions

Stop and report back if:

- Plan 003's profile model or plan 004's region/egress decision record is
  absent, unapproved, ambiguous, or disagrees with the final application code.
  Do not resolve that disagreement in prose.
- The owner rejects the region roadmap/target-selection policy or the approved
  record says the existing README roadmap must be replaced by a direction not
  supplied to this plan. Request the exact approved wording.
- A desired provider privacy, security, filtering, GDPR, logging, endpoint, or
  performance claim cannot be proven by the repository's measurement contract.
  Remove/neutralize it; do not browse for marketing evidence or validate it.
- The final release workflow differs from the documented asset/smoke contract,
  or the new Windows packaged smoke has not passed in CI/release evidence.
- Correcting a claim requires changing code, the build lock, generated Flatpak
  artifacts, the data catalog, translations, or `AGENTS.md`.
- A final quality/link/consistency check fails twice after a reasonable
  in-scope documentation correction.

## Maintenance notes

- Treat `docs/PROFILE_MODEL.md` and `docs/REGION_TARGETING.md` as the source
  for future product-language updates; update the user docs in the same change
  whenever either approved contract changes.
- Update release docs from the actual workflow matrix and smoke-script names,
  not a remembered platform list. A release asset change must update the
  checklist, verification instructions, README, and checksums together.
- Keep provider language about what DNSpect measures. Catalog maintenance and
  independent validation of provider policies remain intentionally separate
  work.
