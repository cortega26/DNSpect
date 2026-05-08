# DNSpect — AGENTS.md

## Identity

DNSpect is a DNS performance lab. Resolvers are test targets, not products. Value comes from measurement integrity, not catalog size.

## Architecture

| Layer | Responsibility | Location |
|-------|---------------|----------|
| Data | Resolver dataset, query lists | `data/` |
| Domain | Scoring, ranking, profiles | `backend/` |
| Presentation | UI rendering | `frontend/` |
| Measurement | DNS query execution | `backend/` |

- **Determinism**: Same test results + same profile → identical ranking. No randomness in scoring.
- **Profiles**: User Profiles (ranking policy) and Target Profiles (resolver selection) are independent. Never conflate.
- **Guardrails**: Never recommend high failure-rate, unstable, or misleading-outlier resolvers.

## Key Constraints

- **Flatpak**: Desktop app → SEO/social meta tags irrelevant. See `.agents/flathub-compliance.md` for packaging rules.
- **Translations**: ES is source of truth. All 263 ES keys must have EN and PT equivalents.
- **Performance**: Recharts (382 kB) lazy-loaded via `React.lazy`. Keep heavy deps off main chunk.
- **Accessibility**: Focus traps on modals, skip-link, keyboard-operable, ARIA labels.

## Testing

All scoring/ranking changes require unit tests. Maintain determinism and backward compat.

## Non-Goals

No continent-based grouping, brand-based recommendations, or privacy-claims validation.

## Roadmap

Target Profiles → Region filter → DoH/DoT comparison → Exportable reports
