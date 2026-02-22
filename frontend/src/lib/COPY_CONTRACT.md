# Copy Contract

This contract locks regression-prone ES/PT copy in `translations` and is enforced by:

- `src/lib/i18n.copy.test.ts`

## Protected groups

1. `applyGuide.*`
- Why: user trust and system-application clarity depend on stable wording and diacritics.

2. `controls.modeHelp`, `controls.timeoutHelp`
- Why: guided-flow comprehension depends on concise, consistent phrasing.

3. `controls.workloadSummary`, `controls.workloadSummaryNoEta`
- Why: workload/ETA terminology must stay consistent across releases.

4. `exports.csvPurpose`, `exports.jsonSummaryPurpose`, `exports.jsonSamplesPurpose`
- Why: export intent must remain explicit for non-expert and advanced users.

## Change policy

- If protected copy must change intentionally, update both:
  - `src/lib/i18n.tsx`
  - `src/lib/i18n.copy.test.ts`
- Keep ES/PT parity for protected keys.
- Test failures with `Copy regression: diacritics removed or altered` indicate contract drift.
