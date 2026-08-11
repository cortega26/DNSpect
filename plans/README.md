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

**9 of 18 plans complete.** Remaining: 004, 009, 010, 012, 014, 015, 016, 017,
018.

## Recommended execution order

The waves show dependency-safe parallelism, not a requirement to batch every
item together. Resolve an explicit STOP condition before beginning any plan
that depends on it.

| Wave | Plans | Purpose |
|---|---|---|
| 1 — unblocked hardening | 010, 012, 014 | Browser regression coverage (007 landed), Flatpak release parity (011 landed), backend boundary hardening (005 landed). 012 still requires its release decision gate. |
| 2 — region decision | 004 | Continent-grouping contradiction is resolved (see decision gates); the egress/public-IP policy must be approved and recorded in `docs/REGION_TARGETING.md` before any code changes. |
| 3 — dependent contracts | 009, 015, 016 | Apply the accessibility/i18n contract after 004+010; split UI orchestration into hooks after 010; publish only verified product/release facts after 004's decision record. |
| 4 — roadmap capabilities | 017, 018 | Add only manifest-compatible historical comparisons, then controlled matched UDP/DoT/DoH comparisons. |

## Plan status and dependencies

Complete = merged to main with the commit shown. Planned = not started;
priority describes expected impact, effort is an implementation estimate.

| Plan | Priority / effort | Depends on | Status |
|---|---|---|---|
| [001 — DNS response semantics](001-dns-response-semantics.md) | P1 / M | — | **Complete** — `f97fe72` |
| [002 — benchmark work budget](002-benchmark-work-budget.md) | P1 / M | 001 | **Complete** — `6a2dba5` |
| [003 — profile and target model](003-profile-target-model.md) | P1 / L | — | **Complete** — `3e3c390` |
| [004 — region targeting and egress](004-region-targeting-and-egress.md) | P1 / L | 003 | Planned — decision gate (partially resolved) |
| [005 — run-history integrity](005-run-history-integrity.md) | P2 / M | 003 | **Complete** — `ed35ef1` |
| [006 — provider-data invariants](006-provider-data-invariants.md) | P1 / M | 001 | **Complete** — `64143ad` |
| [007 — frontend workflow ownership](007-frontend-workflow-ownership.md) | P1 / M | 003 | **Complete** — `37bfbfa` |
| [008 — results presentation correctness](008-results-presentation-correctness.md) | P1 / M | — | **Complete** — `f58b8b8` |
| [009 — accessibility and i18n contract](009-accessibility-i18n-contract.md) | P1 / M | 004, 010 | Planned |
| [010 — browser regression coverage](010-browser-regression-coverage.md) | P1 / M | 007 | Planned — unblocked |
| [011 — dependency security remediation](011-dependency-security-remediation.md) | P1 / L | — | **Complete** — `3980105` |
| [012 — Flatpak release parity](012-flatpak-release-parity.md) | P1 / L | 011 | Planned — release decision gate |
| [013 — Windows release verification](013-windows-release-verification.md) | P1 / M | 011 | **Complete** — `45ba4fb` |
| [014 — backend boundary hardening](014-backend-boundary-hardening.md) | P1 / M | 005 | Planned — unblocked |
| [015 — frontend orchestration refactor](015-frontend-orchestration-refactor.md) | P2 / L | 005, 007, 010 | Planned — waits on 010 |
| [016 — documentation contract](016-documentation-contract.md) | P2 / M | 001, 003, 004, 006, 011, 013 | Planned — waits on 004 decision record |
| [017 — profile-aware history comparison](017-profile-aware-history-comparison.md) | P3 / L | 009, 010, 014, 015, 016 | Planned |
| [018 — controlled protocol comparison](018-controlled-protocol-comparison.md) | P3 / L | 009, 010, 012, 014, 015, 016, 017 | Planned |

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
- **Plans 017–018:** These are deliberately deferred roadmap work. They start
  only after the immutable-run, bounded-work, endpoint-invariant, and browser
  ownership prerequisites are complete.

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

## Completion protocol

For a completed plan, the coordinator should verify that its declared tests,
scope review, and done criteria passed; update its row to **Complete** with the
merge commit; and re-check dependent plans' drift commands before they begin.
If a STOP condition remains unresolved, mark only that plan **Blocked** and
continue with independent waves where safe.
