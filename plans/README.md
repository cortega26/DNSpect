# DNSpect improvement-plan index

This directory contains the complete, net-positive implementation backlog from
the deep improvement review. Plans were written against commit `e09fd2d` on
2026-08-10. They are implementation instructions, not applied changes: source
code and release artifacts remain untouched by this review.

Every executor must run the plan's drift check before starting. Do not update
this index from an implementation branch; a coordinating reviewer updates the
status once a plan has passed its own done criteria.

> **Drift-check note**: plan files are anchored to commit `e09fd2d`. Merged
> plans have since touched many files that pending plans also list
> (`frontend/src/App.tsx`, `i18n-translations.ts`, `api.ts`, `utils.ts`,
> `AGENTS.md`). When executing a pending plan, re-anchor its drift check to
> current HEAD (`37bfbfa`) and treat diffs caused by *merged* plans as expected
> context, not new drift.

## Status snapshot (2026-08-11)

**All 18 plans complete.** The improvement backlog from the deep review is
fully implemented and merged to main.

**Roadmap wave (plans 019-022)** — written against commit `087e5ff` by the
improve-skill direction audit on 2026-08-11. 019 and 020 are build plans; 021
and 022 are design spikes (design doc + disposable prototype module under
`backend/tests/`, no production code). The wave targets the README roadmap
items and the stated-but-undelivered DoQ claim. Status rows for 019-022 are
maintained by the coordinating reviewer; completed plans are archived with
`make plans-archive`.

## Recommended execution order

The waves show dependency-safe parallelism, not a requirement to batch every
item together. Resolve an explicit STOP condition before beginning any plan
that depends on it.

| Wave | Plans | Purpose |
|---|---|---|
| 1 — unblocked hardening | 010, 012, 014 | Browser regression coverage (007 landed), Flatpak release parity (011 landed), backend boundary hardening (005 landed). 012 still requires its release decision gate. |
| 2 — region decision | 004 | Continent-grouping contradiction is resolved (see decision gates); the egress/public-IP policy must be approved and recorded in `docs/REGION_TARGETING.md` before any code changes. |
| 3 — dependent contracts | 009, 015, 016 | Apply the accessibility/i18n contract after 004+010; split UI orchestration into hooks after 010; publish only verified product/release facts after 004's decision record. |
| 4 — roadmap capabilities | 017, 018 | Delivered: manifest-gated historical comparisons, then controlled matched UDP/DoT/DoH comparisons. |

## Plan status and dependencies

Complete = merged to main with the commit shown. Planned = not started;
priority describes expected impact, effort is an implementation estimate.

| Plan | Priority / effort | Depends on | Status |
|---|---|---|---|
| [001 — DNS response semantics](archive/001-dns-response-semantics.md) | P1 / M | — | **Complete** — `f97fe72` |
| [002 — benchmark work budget](archive/002-benchmark-work-budget.md) | P1 / M | 001 | **Complete** — `6a2dba5` |
| [003 — profile and target model](archive/003-profile-target-model.md) | P1 / L | — | **Complete** — `3e3c390` |
| [004 — region targeting and egress](archive/004-region-targeting-and-egress.md) | P1 / L | 003 | **Complete** — `871bc46` |
| [005 — run-history integrity](archive/005-run-history-integrity.md) | P2 / M | 003 | **Complete** — `ed35ef1` |
| [006 — provider-data invariants](archive/006-provider-data-invariants.md) | P1 / M | 001 | **Complete** — `64143ad` |
| [007 — frontend workflow ownership](archive/007-frontend-workflow-ownership.md) | P1 / M | 003 | **Complete** — `37bfbfa` |
| [008 — results presentation correctness](archive/008-results-presentation-correctness.md) | P1 / M | — | **Complete** — `f58b8b8` |
| [009 — accessibility and i18n contract](archive/009-accessibility-i18n-contract.md) | P1 / M | 004, 010 | **Complete** — `380a4b2` |
| [010 — browser regression coverage](archive/010-browser-regression-coverage.md) | P1 / M | 007 | **Complete** — `d992666` |
| [011 — dependency security remediation](archive/011-dependency-security-remediation.md) | P1 / L | — | **Complete** — `3980105` |
| [012 — Flatpak release parity](archive/012-flatpak-release-parity.md) | P1 / L | 011 | **Complete** — `ff026c2` |
| [013 — Windows release verification](archive/013-windows-release-verification.md) | P1 / M | 011 | **Complete** — `45ba4fb` |
| [014 — backend boundary hardening](archive/014-backend-boundary-hardening.md) | P1 / M | 005 | **Complete** — `3782ab0` |
| [015 — frontend orchestration refactor](archive/015-frontend-orchestration-refactor.md) | P2 / L | 005, 007, 010 | **Complete** — `6b2896d` |
| [016 — documentation contract](archive/016-documentation-contract.md) | P2 / M | 001, 003, 004, 006, 011, 013 | **Complete** — `8a54401` |
| [017 — profile-aware history comparison](archive/017-profile-aware-history-comparison.md) | P3 / L | 009, 010, 014, 015, 016 | **Complete** — `80248ce` |
| [018 — controlled protocol comparison](archive/018-controlled-protocol-comparison.md) | P3 / L | 009, 010, 012, 014, 015, 016, 017 | **Complete** — `ba24025` |
| [019 — backend CSV diagnostics parity](019-backend-csv-diagnostics-parity.md) | P2 / S | — | **DONE** — implemented in worktree `/tmp/opencode/dnspect-019` (branch `plan/019-backend-csv-diagnostics-parity`, commits `66f65e2`, `814a912`); criteria re-verified by reviewer; **merge pending user decision** |
| [020 — headless CLI benchmark](020-headless-cli-benchmark.md) | P2 / M | 019 | **DONE** — implemented in worktree `/tmp/opencode/dnspect-020` (branch `plan/020-headless-cli-benchmark`, commits `4a3f732`, `f3caa56`, `4315f21`, `93faf7d`); criteria re-verified by reviewer; **merge pending user decision** |
| [021 — monitoring mode design spike](021-monitoring-mode-design-spike.md) | P1 / L | — | **DONE** — worktree `/tmp/opencode/dnspect-021` (branch `plan/021-monitoring-mode-design-spike`, commits `7a8e58a`, `aa23449`); criteria + doc re-verified by reviewer; **merge pending user decision**; spike evidence files deleted per decision 2 |
| [022 — DNS-over-QUIC design spike](022-dns-over-quic-design-spike.md) | P2 / L | — | **DONE** — worktree `/tmp/opencode/dnspect-022` (branch `plan/022-dns-over-quic-design-spike`, commits `e02b6a1`, `cc3cb19`); criteria + doc re-verified by reviewer; **merge pending user decision**; spike evidence files deleted per decision 2 |
| [023 — DNS-over-QUIC standalone benchmark](023-dns-over-quic-standalone.md) | P1 / L | — | **DONE** — worktree `/tmp/opencode/dnspect-023` (branch `plan/023-dns-over-quic-standalone`, 10 commits `c095a6b..9f48204`); criteria + gates re-verified by reviewer; one documented scope deviation (e2e `fixtures.ts` type widening); **merge pending user decision** |
| [024 — persistence write-path robustness](024-persistence-write-path-robustness.md) | P1 / M | — | **DONE** — worktree `/tmp/opencode/dnspect-024` (branch `plan/024-persistence-write-path-robustness`, commits `fdf998c`, `38b23c6`); criteria + gate re-verified by reviewer; **merge pending user decision** |
| [025 — manifest target-snapshot synthesis](025-manifest-target-snapshot-synthesis.md) | P1 / M | — | **DONE** — worktree `/tmp/opencode/dnspect-025` (branch `plan/025-manifest-target-snapshot-synthesis`, commits `5fbe3ac`, `7892c97`, `ad85928`); STOPPED once on `test_manager_lifecycle.py:155` (pre-fix contract assertion), resolved by reviewer (contract update, documented deviation), gate re-verified green; **merge pending user decision** |
| [026 — frontend session fixes](026-frontend-session-fixes.md) | P2 / S-M | — | **DONE** — worktree `/tmp/opencode/dnspect-026` (branch `plan/026-frontend-session-fixes`, 5 commits `b069943..edf5e6f`); criteria + gates re-verified by reviewer; **merge pending user decision** |
| [027 — orchestration hook unit tests](027-hook-unit-tests.md) | P2 / M | 026 (recommended) | **DONE** — worktree `/tmp/opencode/dnspect-027` (branch `plan/027-hook-unit-tests`, branched from 026's tip, commits `8f65c62`, `700d3e2`); 23 tests, gates re-verified by reviewer; **merge pending user decision** |
| [028 — monitoring mode implementation](028-monitoring-mode-implementation.md) | P1 / L | — | **DONE** — merged `29cfaa9` + `abca400` (2 revision rounds: e2e fixtures repaired a pre-existing plan-023 regression; precise heading-role locators fixed a strict-mode collision the WatchPanel copy introduced in `accessibility-i18n.spec.ts`); e2e 25/25 verified on merged main; pushed to `abca400` |

## Roadmap wave dependency notes (019-022)

- **020 requires 019**: the CLI's `--format csv` output consumes
  `app/export.py` (`EXPORT_CSV_COLUMNS` / `build_csv`) created by 019; 020's
  done criteria assume the file exists.
- **021 is independent** but its "watch protocols" decision should be
  revisited after 022 lands; **022 is independent** and carries a maintainer
  decision gate (DoQ in the frozen comparison methodology vs. standalone).
- **Decision gates in the wave**: 022 requires maintainer approval of the
  comparison-contract option and the `aioquic` dependency strategy before any
  build plan proceeds; 021's alert-channel choice must not add off-device
  egress without the plan-004 policy process.
- Execution order: 019 → 020 first (cheap, self-contained), then 021/022
  spikes in either order.
- **Audit wave (024-027)**: from the post-churn reaudit (12 tabled findings,
  all planned). 024 covers findings 1/2/4/5/7 (persistence cluster), 025
  finding 3 (manifest snapshot), 026 findings 8/9/10/12 + a11y glyph, 027
  finding 11 (hook tests). 027 is recommended after 026 (its tests pin 026's
  behaviors); 023/024/025 are independent of each other and of 026/027 —
  merge-order conflicts are limited to `runner.py` line regions (023/024/025)
  and `App.tsx`/hooks (026/027).

## Signed-off decisions (2026-08-11)

The plan-021 and plan-022 decision gates were signed off by the operator
(delegated to the advisor) per the recommendations recorded in
`docs/MONITORING_MODE.md` and `docs/DOQ_SUPPORT.md`. These are binding for
the build plans that follow; a build plan may only revisit one with new
evidence.

**Monitoring (plan 021):**
- v1 scope: in-app watch only (runs while the app is open; persisted
  `watch/` dir makes resume-on-launch free). No background daemon.
- Thresholds: single default set (`median_ms: 25`, `failure_rate: 5`,
  `success_rate: 5`, others off), per-watch overridable; per-goal defaults
  only if user testing shows false alerts.
- Alert channel: in-app banner v1; OS notifications deferred (needs a
  permission-UX product decision).
- Watch runs: persisted normally (comparison requires it), tagged and
  excluded from recommendation/history by default; no manifest change now.
- Watch protocols: single-protocol v1; a DoQ watch reuses the
  protocol-comparison eligibility machinery after plan 022 lands.

**DNS-over-QUIC (plan 022):**
- Comparison timing: **(b)** standalone DoQ benchmark first; the frozen
  comparison methodology is extended only in a dedicated, approved follow-up.
- `aioquic`: optional extra `doq = ["aioquic==1.3.0"]`; the DoQ badge and
  protocol option are hidden when `dns.quic.have_quic` is False; packaged
  builds include the extra (desktop users always measure).
- Port policy: 853 default; no per-provider port catalog field until a
  provider diverges.
- Catalog cleanup (plan-006 gate, becomes step 0 of the DoQ build plan):
  remove `doq: "yes"` on cloudflare + google until a primary source appears;
  update adguard's `doq_hostname` to `dns.adguard-dns.com` and review its
  `dot_hostname`/`doh_url` (same legacy alias); quad9 + quad9-unsecured stay.

## Reaudit checkpoint (2026-08-11)

The deep audit ran against `e09fd2d`; all 18 plans since merged. A full
reaudit is intentionally **not** run before this wave — the spikes are the
investigation, and the build plans are small or test-gated. Instead:

1. **Executed 2026-08-11** — targeted `standard` audit of the post-`e09fd2d`
   churn (protocol-comparison state machine, history/manifest layer, frontend
   hooks). Findings vetted and presented; selected ones become plans 024+.
   Remaining for later: the dependency pass (`pip-audit`) once `aioquic` is
   installed (plan 023 covers the pin; the audit runs at release-prep).
2. **A full `deep` reaudit** is recommended right before the next release
   (v1.4.0): monitoring + DoQ would be the largest change since 1.3.0, and
   the audit then has design docs plus working code to judge.

## Required decision gates

- **Plan 004 (partially resolved):** The AGENTS.md contradiction between the
  no-continent-grouping non-goal and the Region roadmap item is resolved:
  current AGENTS.md states region/continent grouping exists via GeoIP + locale
  and prohibits only mechanisms that override operator intent. Still open: the
  owner must approve whether any public-IP/GeoIP egress request is allowed,
  consented, and failure-tolerant, and that approval must be recorded in
  `docs/REGION_TARGETING.md` before implementation starts.
- **Plan 006:** Do not publish or retain encrypted-DNS endpoint metadata that
  cannot be verified from an appropriate primary source. Its STOP conditions
  protect against replacing one unsupported catalog claim with another.
- **Plan 012:** A maintainer must approve the target Flatpak runtime policy and
  the next release tag before source pins and generated dependency modules are
  changed. Native validation does not certify the other architecture.
- **Plan 016:** Documentation follows completed code and the approved profile /
  region decision records; it must never be used to decide those policies.

## Deliberately excluded work

The review found no net-positive plan for the following because they conflict
with the project contract or would create unsupported claims:

- SEO, social metadata, and web-discovery work for the Flatpak desktop app.
- Continent-based *recommendations* and brand-based recommendations; validation
  of resolver-provider privacy/marketing claims. (Region/continent grouping as
  a user-visible filter is an approved feature per the 004 decision.)
- Telemetry, external analytics, or a change to network-egress behavior without
  the explicit policy decision required by plan 004.
- Replacing lazy-loaded Recharts with a heavier eager visualization dependency.

## Roadmap wave — considered and rejected (2026-08-11)

- Shareable/HTML result reports: conflicts with the local-first ethos; JSON/CSV
  export already covers the data-out need.
- Electron shell rebuild: the shipped GTK/WebKit2 shell + Flatpak packaging
  already resolves the desktop-app goal from `.local-plans/`.
- Catalog growth for Oceania/Africa scopes: data entry with a closed target
  scope union (explicit product decision in `docs/REGION_TARGETING.md`);
  revisit only if monitoring/catalog churn justifies it.

## Completion protocol

For a completed plan, the coordinator should verify that its declared tests,
scope review, and done criteria passed; update its row to **Complete** with the
merge commit; run `make plans-archive` to move the file to `plans/archive/` (the
index links are rewritten automatically; archived plans are immutable); and
re-check dependent plans' drift commands before they begin.
If a STOP condition remains unresolved, mark only that plan **Blocked** and
continue with independent waves where safe.
