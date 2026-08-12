# DNSpect improvement-plan index

This directory contains the complete, net-positive implementation backlog from
the deep improvement review. Plans were written against commit `e09fd2d` on
2026-08-10. They are implementation instructions, not applied changes: source
code and release artifacts remain untouched by this review.

Every executor must run the plan's drift check before starting. Do not update
this index from an implementation branch; a coordinating reviewer updates the
status once a plan has passed its own done criteria.

> **Drift-check note**: all plans are now complete and archived; the anchor
> history (e09fd2d → 96ccaed) is retained for reference only. New plans
> (031+) anchor to the current HEAD at their writing time.

## Status snapshot (2026-08-13)

**All 30 plans complete.** The full improvement backlog — the deep-review
wave (001-018), the roadmap wave (019-022), the audit wave (023-027), and
the final wave (028-030: monitoring implementation, DoQ comparison
extension, history summary sidecars) — is implemented, merged, and pushed.
The remaining open item is the pre-release deep reaudit follow-up (see
"Reaudit checkpoint"), whose findings and follow-up plans will be recorded
here as 031+.

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
| [019 — backend CSV diagnostics parity](archive/019-backend-csv-diagnostics-parity.md) | P2 / S | — | **Complete** — `6a71835` |
| [020 — headless CLI benchmark](archive/020-headless-cli-benchmark.md) | P2 / M | 019 | **Complete** — `44c9eae` |
| [021 — monitoring mode design spike](archive/021-monitoring-mode-design-spike.md) | P1 / L | — | **Complete** — `7a4cad9` |
| [022 — DNS-over-QUIC design spike](archive/022-dns-over-quic-design-spike.md) | P2 / L | — | **Complete** — `d5002d0` |
| [023 — DNS-over-QUIC standalone benchmark](archive/023-dns-over-quic-standalone.md) | P1 / L | — | **Complete** — `cdf4e30` |
| [024 — persistence write-path robustness](archive/024-persistence-write-path-robustness.md) | P1 / M | — | **Complete** — `82a9d0a` |
| [025 — manifest target-snapshot synthesis](archive/025-manifest-target-snapshot-synthesis.md) | P1 / M | — | **Complete** — `4be0274` |
| [026 — frontend session fixes](archive/026-frontend-session-fixes.md) | P2 / S-M | — | **Complete** — `d6c1c8f` |
| [027 — orchestration hook unit tests](archive/027-hook-unit-tests.md) | P2 / M | 026 (recommended) | **Complete** — `d775029` |
| [028 — monitoring mode implementation](archive/028-monitoring-mode-implementation.md) | P1 / L | — | **Complete** — merged `29cfaa9` + `abca400` (2 revision rounds: e2e fixtures repaired a pre-existing plan-023 regression; precise heading-role locators fixed a strict-mode collision the WatchPanel copy introduced in `accessibility-i18n.spec.ts`); e2e 25/25 verified on merged main; pushed to `abca400` |
| [029 — DoQ comparison extension](archive/029-doq-comparison-extension.md) | P2 / M | — | **Complete** — `54ce261` |
| [030 — history summary sidecars](archive/030-history-summary-sidecar.md) | P2 / M | — | **Complete** — `96ccaed` |

## Deep-reaudit wave (031-038, 2026-08-13)Plans 031-038 implement the vetted deep-reaudit findings (written against `930dfb6`). 031 is P1 (the watch measured the wrong population); 032-033
complete the watch surface; 034-036 harden sessions, security, and tests;
037 is release readiness; 038 is the frontend structure pass. Recommended
execution order: 031 → 033 → 032 → 034 → 035 → 036 → 037, with 038 last
(after 032/034 so the polling extraction includes their fixes).

| Plan | Priority / effort | Depends on | Status |
|---|---|---|---|
| [031 — watch measures the configured snapshot](archive/031-watch-measures-snapshot.md) | P1 / S | — | **DONE** — **Complete** — `9b4eec5` |
| [032 — watch UI alive](archive/032-watch-ui-alive.md) | P1 / S-M | — | **DONE** — **Complete** — `caa2862` |
| [033 — watch scheduler reliability](archive/033-watch-reliability.md) | P1 / M | — | **DONE** — **Complete** — `648f40c` |
| [034 — session and egress hardening](archive/034-session-egress-hardening.md) | P2 / S | — | **DONE** — **Complete** — `b36de43` |
| [035 — security and consistency hardening](archive/035-security-consistency.md) | P1 / S-M | 031 (snapshot validation half) | **DONE** — **Complete** — `1b0bcdd` |
| [036 — test depth and history filtering](archive/036-test-depth.md) | P2 / M | 035 (unified gates) | **DONE** — **Complete** — `4c44f1d` |
| [037 — docs and release readiness](archive/037-docs-release-readiness.md) | P2 / M | — | **Complete** — merged `b392b6d`; flatpak `generated-sources.json` regen deferred (release-checklist item) |
| [038 — frontend structure](archive/038-frontend-structure.md) | P2 / M | 032, 034 | **DONE** — **Complete** — `bebfd47` |
| [039 — frontend revamp design spike](039-frontend-revamp-design-spike.md) | P1 / L | — | TODO |

## Frontend revamp wave (039+, 2026-08-12)

The user-requested frontend revamp ("The Instrument" direction + Quick/Lab
two-mode UX + anti-slop enforcement). 039 is the design spike (audit →
`docs/DESIGN_SYSTEM.md` → prototype → decision gates). Build plans follow
after its gates are signed off: 040 design-system rollout (tokens, fonts
self-hosting, component skins, styles.css restructure), 041 two-mode IA
(ModeSwitcher + Quick check + Lab sub-nav), 042 chart/visualization
re-skin. Planned at `b70ca05`.

## Deep reaudit — considered and rejected (2026-08-13)

- **Runner.py split (TD-03)**: 2,298-line god module with ~10 duplicated
  blocks. Real, but L/L with a long-lived branch — schedule after v1.4.0
  with the current test matrix as characterization; the extraction targets
  (measurement engines, both state machines, persistence helpers) are
  already documented in the finding.
- **React 18 → 19 (6-01)**: the 18 line is frozen and both heavy deps
  (recharts, @testing-library/react) already peer-declare 19. A clean
  migration, but M/MED right before a release with a fresh test stack —
  schedule for the post-release window.
- **Run-file retention/TTL (PERF-04's retention half)**: deleting user data
  automatically needs explicit product semantics (how long, what survives,
  CLI/export interplay). Recorded as a product decision; the filtering half
  (watch runs out of the API history) is in plan 036.
- **Baseline manifest sidecar (PERF-02)**: plan 030's summary sidecars plus
  the in-memory TTL already cover the common path; revisit only if watch
  counts grow.
- **Watch status `/api/watch/{id}/status` polling (PERF-05's endpoint half)**:
  plan 032 polls the list endpoint; per-watch status polling is unnecessary
  at v1 scale.

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

## Reaudit checkpoint (2026-08-13)

The full deep reaudit ran 2026-08-13 against `96ccaed` (7 auditors, ~40
findings, all vetted — top claims re-verified by the reviewer). Findings
became plans 031-038 below; rejected items are recorded in "Deep reaudit —
considered and rejected". The pre-release deep reaudit (checkpoint item 2)
is now satisfied; a fresh `deep` pass before the next major release should
focus on the plans 031-038 merge outcomes.

Historical notes from the earlier checkpoint (superseded): the targeted
`standard` audit of the post-`e09fd2d` churn ran 2026-08-11 (findings →
plans 024-027); the "before the next release" deep reaudit was scheduled
then and is now executed.

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
