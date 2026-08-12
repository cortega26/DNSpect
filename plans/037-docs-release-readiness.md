# Plan 037: Docs and release readiness (changelog, README, env reference, tooling, flatpak pin)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 930dfb6..HEAD -- CHANGELOG.md README.md Makefile AGENTS.md CONTRIBUTING.md docs/ARCHITECTURE.md docs/DOQ_SUPPORT.md docs/MONITORING_MODE.md docs/REGION_TARGETING.md QUICK_WINS_SPEC.md io.github.cortega26.DNSpect.yaml packaging/flatpak/generated-sources.json scripts/dev.sh backend/app/geoip.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (docs-only; the flatpak pin is the one repo-artifact change)
- **Category**: docs + release readiness (deep-reaudit findings DX-02..DX-09, 6-03)
- **Planned at**: commit `930dfb6`, 2026-08-13

## Why this matters

The docs lag the code by the entire 019-030 wave, and the README's roadmap
now advertises DELIVERED features as pending work. Concretely: the
CHANGELOG has nothing after [1.3.0]; the README roadmap still lists
monitoring/alerting/CLI as unchecked; the feature list omits DoQ, watch
mode, and the CLI; the provider count self-contradicts (49 vs 50); the ~16
`DNS_SPEED_LAB_*` env vars are scattered across 5 files with no single
reference; the e2e suite is unreachable from any make target or documented
command; `scripts/dev.sh` installs without the `doq` extra so the documented
dev flow cannot measure DoQ; ARCHITECTURE.md misses 4 modules and 6 API
routes; QUICK_WINS_SPEC.md presents shipped work as actionable spec; the
two spike docs read as live state; and the flatpak manifest pins a commit
one behind the v1.3.0 tag it claims (verified: pin `a1a97c3` vs tag
`3b2dbb0`).

## Current state

- `CHANGELOG.md:7` — last entry `[1.3.0] - 2026-08-11`; ~75 commits of
  feature work since (plans 019-030).
- `README.md:236-239` — roadmap items 1-4 all still `[ ]` (all delivered:
  monitoring=028, alerting=028 thresholds+banner, scheduled
  benchmarks=028 interval cycles, CLI=020 `dnspect run`).
- `README.md:28` — "**49** DNS providers"; `README.md:231` — "**50**
  providers"; catalog has 49 (`data/dns_providers.es.json`).
- Env vars (16 total, no central reference): `README.md:87,117-120`,
  `CLAUDE.md:137-145`, `docs/ARCHITECTURE.md:178-182`,
  `docs/MONITORING_MODE.md:70,122,332-336`, `scripts/package_backend.py:86-88`,
  `docs/TROUBLESHOOTING.md:33`. New since the wave: `DNS_SPEED_LAB_WATCH_ENABLED`,
  `DNS_SPEED_LAB_WATCH_DIR` (nowhere outside MONITORING_MODE.md).
- `Makefile:27-28` — `frontend-check` = lint + typecheck + build; no vitest,
  no e2e target (`npm test`/`test:e2e` documented nowhere in
  AGENTS.md/README/CONTRIBUTING).
- `scripts/dev.sh:47` — `pip install -c constraints.txt -e .[dev]` (no `doq`
  extra → `dns.quic.have_quic == False` in dev); `Makefile:4` and CI use
  `-r constraints.txt`.
- `docs/ARCHITECTURE.md:16-23,161-173` — module list + endpoint table miss
  `watch.py`, `export.py`, `cli_run.py`, `packaged_main.py` and
  `/api/protocol-comparisons/*`, `/api/watch*` (6 routes).
- `QUICK_WINS_SPEC.md` — all items ✅ Done but framed as implementable;
  QW1's CSV box (:94) unchecked though implemented (`export.py`).
- `docs/DOQ_SUPPORT.md:3-4,11` — "No production code was landed"; §4 option
  (a) is what plan 029 implemented. `docs/MONITORING_MODE.md:9-11` — "No
  production code was written" (mitigated by its implementation-notes
  section).
- `io.github.cortega26.DNSpect.yaml:40` — `commit: a1a97c3...`; `git rev-parse
  v1.3.0` = `3b2dbb0` (the missing commits are CI/script-only — app code
  identical).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 930dfb6..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Doc checks | `grep -n ...` (per step)  | per step |
| Backend gate | `make backend-check`     | exit 0 (unchanged — docs-only plan; run to confirm no code touched) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |

## Scope

**In scope** (docs + the two repo-artifact fixes):
- `CHANGELOG.md` — new `[1.4.0]` entry (Unreleased-style)
- `README.md` — roadmap → features, provider count, env reference link
- `Makefile`, `AGENTS.md`, `CONTRIBUTING.md` — e2e/vitest targets + commands
- `docs/ARCHITECTURE.md` — modules, routes, watch/protocol-comparison sections
- `docs/DOQ_SUPPORT.md`, `docs/MONITORING_MODE.md` — one-line superseded headers
- `docs/REGION_TARGETING.md` — only if the region-vocabulary decision (plan 034) needs its record updated (cross-reference only)
- `QUICK_WINS_SPEC.md` — retitle as completed-work record + fix the QW1 box
- `io.github.cortega26.DNSpect.yaml` — flatpak pin → `3b2dbb0`
- `packaging/flatpak/generated-sources.json` — regenerate only if
  `make flatpak-python-deps` succeeds in this environment (else document as
  a release-checklist item and do NOT hand-edit)
- `scripts/dev.sh` — install `-e .[dev,doq]` (keep `-c constraints.txt`)

**Out of scope** (do NOT touch):
- Rewriting the frozen spike docs' content (headers only).
- The `.env.example` file — the README "Configuration" section replaces it
  for v1 (a local desktop app has no dotenv loading; document, don't add
  machinery).
- Code behavior of any kind (this plan is docs + the flatpak pin).
- `docs/RELEASE_CHECKLIST.md` — reference it, don't rewrite it.

## Git workflow

- Branch: `plan/037-docs-release-readiness`
- Commits per area: `docs(changelog): add 1.4.0 entries for plans 019-030`,
  `docs(readme): mark roadmap delivered and reconcile feature list`,
  `docs: centralize env-var reference and e2e commands`,
  `docs(architecture): add missing modules and routes`,
  `docs: mark spike records superseded and QUICK_WINS as completed work`,
  `build(flatpak): re-pin manifest to the v1.3.0 tag`,
  `build(dev): include the doq extra in the dev install`.
  Merge commit: `merge: plan 037 — docs and release readiness`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: CHANGELOG

Add `## [1.4.0] - Unreleased` above the [1.3.0] entry with `### Added` /
`### Fixed` / `### Build/CI` sections covering plans 019-030, grouped by
area and written in the existing style (per-area, user-facing, no plan
numbers): monitoring mode (watch scheduler, /api/watch, alert banner,
thresholds, origin tagging), DoQ (standalone + comparison extension,
protocol selector, capability gating), headless CLI (`dnspect run`), run
comparison/history improvements (manifest snapshot synthesis, atomic
persistence, resilient reads, samples read-back, summary sidecars), export
parity, session fixes (history refresh, real cancel, preflight debounce,
poll retry), hook unit tests, e2e fixture updates, flatpak pin.

**Verify**: `grep -n "\[1.4.0\]" CHANGELOG.md` matches; the entry lists
monitoring, DoQ, and the CLI.

### Step 2: README

1. Move the four roadmap items into the feature list (they are delivered):
   - Continuous monitoring mode → "Monitoring (watch) mode — scheduled
     background re-checks of a pinned target snapshot with threshold alerts"
   - Alerting → fold into the same bullet
   - Scheduled/recurring benchmarks → same
   - CLI → "Headless CLI (`dnspect run`) with table/JSON/CSV output and
     scriptable exit codes"
   - Add DoQ to the encrypted-DNS bullet (standalone + comparison, optional
     `aioquic` extra)
   - Replace the roadmap section with what actually remains (nothing — or
     the deferred post-release items if any)
2. Fix the provider count: 49 everywhere (verify against the data file).
3. Update the protocol-comparison bullet: "across UDP/DoT/DoH/DoQ".
4. Add a "Configuration" section: one table listing all 16
   `DNS_SPEED_LAB_*` env vars (name, default, meaning) — the single
   reference — sourced from the code (`runner.py:695-720`, `cli.py:44,110-114`,
   `watch.py:55`, `providers.py:14`, `geoip.py:12`, `package_backend.py:86-88`)
   and the docs listed above; include `DNS_SPEED_LAB_WATCH_ENABLED` (default
   `1`) and `DNS_SPEED_LAB_WATCH_DIR`.

**Verify**: `grep -n "Monitoring" README.md` matches; `grep -c "49" README.md` ≥ 1 and "50 providers" absent; the roadmap section has no unchecked `[ ]` items for delivered features.

### Step 3: Tooling commands (Makefile + AGENTS.md + CONTRIBUTING.md)

1. `Makefile` — add `frontend-check-e2e` (`cd frontend && npx playwright test --reporter=line`) and add `npm test` to the `frontend-check` target's description (or a new `frontend-check-unit`); document `npx playwright install chromium` as a prerequisite.
2. `AGENTS.md` / `CONTRIBUTING.md` — update the Commands/quality-gate lists to include the e2e command and the vitest command (both exist today, undocumented).

**Verify**: `grep -n "frontend-check-e2e" Makefile AGENTS.md` match; `grep -n "playwright" AGENTS.md` matches.

### Step 4: ARCHITECTURE.md

1. Module list (16-23): add `watch.py`, `export.py`, `cli_run.py`, `packaged_main.py`.
2. Endpoint table (161-173): add `/api/protocol-comparisons/preflight`,
   `/api/protocol-comparisons`, `/api/protocol-comparisons/{id}`,
   `/api/watch`, `/api/watch/{id}`, `/api/watch/{id}/status`.
3. New short sections (mirroring the existing per-area style): the watch
   subsystem (scheduler daemon thread, `watch/` data dir, env gate, ring
   buffer, origin tagging) and the protocol-comparison contract (manifest
   v2, DoQ, exclusion codes) with pointers to the dedicated docs.

**Verify**: `grep -n "watch.py\|cli_run.py" docs/ARCHITECTURE.md` match; `grep -n "/api/watch" docs/ARCHITECTURE.md` matches ≥ 2.

### Step 5: Spike records + QUICK_WINS

1. `docs/DOQ_SUPPORT.md` — add a one-line header note: "Status: superseded
   — DoQ shipped in plans 023/029 (standalone + comparison, manifest v2);
   this record documents the spike-time state." (Header only; do not touch
   the frozen body.)
2. `docs/MONITORING_MODE.md` — same pattern ("Status: superseded —
   implemented by plan 028; this record documents the design and signed-off
   decisions.").
3. `QUICK_WINS_SPEC.md` — retitle the doc ("DNSpect Quick Wins — Completed
   Work Record") with a header stating all items shipped as of 1.3.0 and
   check the QW1 CSV box (the column exists in `export.py`).

**Verify**: `grep -n "superseded" docs/DOQ_SUPPORT.md docs/MONITORING_MODE.md` match; `grep -n "Completed Work Record" QUICK_WINS_SPEC.md` matches; the QW1 CSV criterion is `[x]`.

### Step 6: Flatpak pin + dev install

1. `io.github.cortega26.DNSpect.yaml:40` — `commit: a1a97c3...` →
   `3b2dbb0ea6e73dfa99513d68d682cb2d7b1cd649`. Regenerate
   `packaging/flatpak/generated-sources.json` ONLY via
   `make flatpak-python-deps` if it succeeds; if the tooling is unavailable
   in this environment, do NOT hand-edit the generated file — record it as
   a release-checklist item in the commit message and NOTES.
2. `scripts/dev.sh:47` — `pip install -c constraints.txt -e .[dev,doq]`
   (the README Option A flow then measures DoQ).

**Verify**: `grep -n "3b2dbb0" io.github.cortega26.DNSpect.yaml` matches; `grep -n "dev,doq" scripts/dev.sh` matches.

### Step 7: Gates

**Verify**: `make backend-check` → exit 0 (nothing behavioral changed);
`cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; `git status` shows only in-scope files.

## Test plan

- No new tests — this is a docs/tooling plan. The gates confirm nothing
  behavioral changed.
- Verify `scripts/dev.sh` still executes its install line shape correctly
  (dry-run the edited line's syntax; do not actually reinstall the venv).

## Done criteria

ALL must hold:

- [ ] `grep -n "\[1.4.0\]" CHANGELOG.md` matches
- [ ] `grep -n "Monitoring" README.md` matches; `grep -c "50 providers" README.md` == 0
- [ ] `grep -n "DNS_SPEED_LAB_WATCH_ENABLED" README.md` matches (env reference)
- [ ] `grep -n "frontend-check-e2e" Makefile AGENTS.md` match
- [ ] `grep -n "/api/watch" docs/ARCHITECTURE.md` matches
- [ ] `grep -n "superseded" docs/DOQ_SUPPORT.md docs/MONITORING_MODE.md` match
- [ ] `grep -n "3b2dbb0" io.github.cortega26.DNSpect.yaml` matches
- [ ] `grep -n "dev,doq" scripts/dev.sh` matches
- [ ] `make backend-check` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 037 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" claim is wrong against the live files (line numbers
  drift; the substance must hold).
- `make flatpak-python-deps` fails or mutates `generated-sources.json`
  unexpectedly — record as release-checklist and continue (do not
  hand-edit the generated file).
- A README claim about behavior contradicts the code (e.g. provider count
  differs when re-counted) — reconcile from the code, don't invent.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The env-var table in README is now the single reference; any new
  `DNS_SPEED_LAB_*` var must be added there (and the code comment should
  point at it).
- The flatpak pin fix belongs to the release checklist ritual: the
  manifest's `commit` must always equal the release tag — add a check line
  to `docs/RELEASE_CHECKLIST.md` if it isn't there.
- The spike docs stay as immutable historical records with the superseded
  header — the plans/archive convention's analogue for design docs.
- The CHANGELOG 1.4.0 entry will be dated at release time (Keep a Changelog
  convention).
