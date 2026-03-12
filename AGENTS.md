# DNSpect — AGENTS.md

## Project Identity

DNSpect is a DNS performance laboratory.

It is NOT:
- A DNS catalog
- A resolver directory
- A marketing comparison tool

Resolvers are treated as test targets.
Value comes from measurement integrity and interpretation.

---

## Architectural Principles

### 1. Separation of Concerns

- Resolver dataset = data layer
- Scoring logic = domain layer
- UI = presentation layer
- Test execution = measurement layer

No mixing.

---

### 2. Profiles Semantics

There are two independent concepts:

- User Profiles → affect ranking policy.
- Target Profiles → affect resolver selection (future feature).

They must NEVER be conflated.

---

### 3. Determinism

Given the same test results and same profile:
- Ranking must be identical.
- No randomness in scoring.

---

### 4. Guardrails First

Never recommend:
- High failure-rate resolvers.
- Statistically unstable resolvers.
- Outliers with misleading medians.

---

### 5. Resolver Expansion Rules

Adding a resolver must:

- Include metadata.
- Serve a research purpose.
- Improve comparison coverage.

Never inflate list size without justification.

---

### 6. Metrics Philosophy

Prefer:
- p95 over p50.
- Consistency over peak speed.
- Reliability over theoretical latency.

---

## Testing Policy

All scoring changes must:
- Include unit tests.
- Maintain determinism.
- Preserve backward compatibility.

---

## Non-Goals

DNSpect will not:
- Categorize resolvers by continent as primary grouping.
- Recommend based on brand.
- Act as a privacy claims validator.

---

## Future Roadmap

- Target Profiles
- Region filter
- DoH/DoT comparison
- Exportable reports