# Profile Model

## Vocabulary

### User Profile (scoring_profile)

The canonical User Profile is `scoring_profile`. It determines how measurement
results are scored and ranked. Currently supported values are the same as the
legacy `BenchmarkGoal` enum: `speed`, `security`, `privacy`, `ad-blocking`, and
`family`. A scoring profile affects only scoring weights after measurement; it
never alters the resolver set that was measured.

### Target Profile (target_snapshot)

A Target Profile is represented for each benchmark run by an immutable
`target_snapshot` object. It records exactly what was measured:

- `resolver_ips` — the non-empty, deduplicated canonical IP strings in
  submitted order. These are the actual measurement targets.
- `selection_source` — one of `manual`, `catalog`, or `system`, indicating
  how the resolver set was assembled.
- `provider_ids` (optional) — a mapping from a subset of `resolver_ips` to
  unambiguous provider IDs known at selection time. A key not present in
  `resolver_ips` is invalid.

The target snapshot is measurement metadata. Rankings can only be compared when
both the scoring policy and the exact target set that produced them are known
(see `plans/005-run-history-integrity.md` for history persistence).

## Migration

### Legacy `goal` field

The existing `goal` request payload is accepted as a deprecated alias for
`scoring_profile` during one documented compatibility release.

- Supplying only `goal` → accepted; `scoring_profile` derived from `goal`.
- Supplying only `scoring_profile` → accepted (canonical path).
- Supplying both with the same value → accepted.
- Supplying both with different values → validation error.

Clients should migrate to `scoring_profile`. Saved runs created before this
model lack a `target_snapshot`; they remain readable but cannot claim full
profile comparability.

### Deprecation timeline

| Release | Action |
|---|---|
| Current | `scoring_profile` introduced; `goal` deprecated but accepted |
| Next + 1 | Clients warned about `goal` deprecation |
| Next + 2 | `goal` removed; migration window closed |

## UI contract

The initial UI offers the existing scoring selector and the manual resolver
selection independently. Changing the scoring profile must not mutate resolver
selections. The target snapshot is built immediately before the benchmark
request and is immutable once sent.

## Design rationale

An immutable per-run snapshot is required because:

1. Rankings depend on both the scoring policy and the measured resolver set.
2. A changed provider catalog must not be used to re-derive past targets.
3. Historical comparison (future) requires knowing what was measured, not what
   the catalog currently says.

This plan deliberately does not create named, syncable, or cloud-stored target
profiles. Those are separate roadmap concerns.
