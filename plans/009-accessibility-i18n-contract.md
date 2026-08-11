# Plan 009: Make keyboard landmarks and localized UI copy match the active language

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A reviewer dispatched this plan and maintains the
> index, so do not edit plans/README.md.
>
> **Drift check (run first)**: <code>git diff --stat e09fd2d..HEAD -- frontend/index.html frontend/src/App.tsx frontend/src/components/ChartsPanel.tsx frontend/src/components/DashboardControls.tsx frontend/src/components/ResolverDetailModal.tsx frontend/src/components/ResolverRankingPanel.tsx frontend/src/lib/i18n.tsx frontend/src/lib/i18n-translations.ts frontend/src/lib/i18n.copy.test.ts frontend/src/lib/i18n.test.ts frontend/src/lib/utils.ts frontend/tests/e2e/accessibility-i18n.spec.ts</code>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/004-region-targeting-and-egress.md, plans/010-browser-regression-coverage.md
- **Category**: bug, tests, accessibility
- **Planned at**: commit <code>e09fd2d</code>, 2026-08-10

## Why this matters

The application advertises Spanish, English, and Portuguese, but several
visible and assistive labels bypass the translation system. In particular,
English region labels, a Spanish loading label, an English chart tooltip, and
mixed score/ranking copy remain after changing the language. The document
language also stays Spanish for a saved/browser-selected language until the
user actively changes it.

The skip link targets a non-focusable main landmark that contains the header,
so keyboard users do not reliably land after the header controls. This plan
fixes those directly evidenced accessibility and internationalization defects,
preserves the already-present modal focus traps, and adds browser-level
regression coverage using the harness established by plan 010.

## Current state

- AGENTS.md — requires ES as source with EN/PT key parity, focus traps,
  skip-link, keyboard operation, and ARIA labels.
- frontend/index.html — static document root begins as Spanish.
- frontend/src/lib/i18n.tsx — chooses a saved/browser language but updates
  document language only inside the user-initiated setter.
- frontend/src/lib/i18n-translations.ts — source translation object and
  compile-time key contract.
- frontend/src/lib/i18n.copy.test.ts — existing ES-to-EN/PT parity gate.
- frontend/src/App.tsx — skip link, landmark structure, loading ARIA labels,
  and region-label call sites.
- frontend/src/lib/utils.ts — English region labels outside the translation
  system.
- frontend/src/components/ChartsPanel.tsx,
  ResolverRankingPanel.tsx, and ResolverDetailModal.tsx — directly evidenced
  untranslated/mixed user-facing copy.
- frontend/src/lib/useFocusTrap.ts — existing modal trap implementation;
  read-only and must remain intact.

The initial HTML document is always Spanish:

    # frontend/index.html:1-5
    <!doctype html>
    <html lang="es" data-theme="light">

The provider selects a saved or browser language, but only a later setter
writes the DOM language:

    # frontend/src/lib/i18n.tsx:16-37
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'es' || stored === 'en' || stored === 'pt') return stored
    ...
    const [language, setLanguage] = useState(() => detectInitialLanguage())
    ...
    setLanguage: (nextLanguage) => {
      setLanguage(nextLanguage)
      window.localStorage.setItem(STORAGE_KEY, nextLanguage)
      document.documentElement.lang = nextLanguage
    }

The skip link lands on the landmark that also contains header controls and is
not programmatically focusable:

    # frontend/src/App.tsx:1045-1066
    <a href="#main-content" className="skip-link">
      {t('accessibility.skipToContent')}
    </a>
    <main className="app-shell" id="main-content">
      <header className="app-header">
        ...
        <button className="btn-ghost icon-btn theme-toggle" ...>

The direct copy bypasses t:

    # frontend/src/lib/utils.ts:30-42
    global: 'Global'
    europe: 'Europe'
    south-america: 'South America'
    north-america: 'North America'
    asia: 'Asia'

    # frontend/src/App.tsx:1134-1138,1192-1195
    aria-busy="true" aria-label="Cargando"

    # frontend/src/components/ChartsPanel.tsx:70-74
    Failure rate: {(entry.failureRate * 100).toFixed(1)}%

    # frontend/src/components/ResolverRankingPanel.tsx:52-55
    Score {scoreTotal} - ...
    ... Bloqueo ...

Provider data currently supplies only Spanish notes:

    # frontend/src/lib/types.ts:23-33
    interface Provider {
      ...
      notes_es: string
    }

    # frontend/src/components/ResolverDetailModal.tsx:58-62
    <p className="muted">{provider?.notes_es ?? t('modal.noDescription')}</p>

Existing translation tests compare all ES keys with EN/PT:

    # frontend/src/lib/i18n.copy.test.ts:9-34
    const esKeys = Object.keys(translations.es).sort()
    expect(missing, ...).toEqual([])

Existing focus traps are an intentional strength, not a defect to rewrite:

    # frontend/src/lib/useFocusTrap.ts:17-47
    firstFocusable?.focus()
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }

Conventions to preserve:

- ES is the source of truth; every new ES key needs exact EN and PT
  equivalents, and parity remains enforced by i18n.copy.test.ts.
- Plan 004 owns the normalized target-region vocabulary. This plan must use
  that approved union rather than reintroducing a separate string map.
- Modal focus traps and existing keyboard behavior must not regress.
- This is a Flatpak desktop application; do not add SEO/social metadata work.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| I18n focused tests | <code>cd frontend && npm test -- i18n.copy.test.ts i18n.test.ts</code> | Exit 0; locale resolution, document-language helper, and key parity pass. |
| Browser accessibility/I18n tests | <code>cd frontend && npm run test:e2e -- --project=chromium tests/e2e/accessibility-i18n.spec.ts</code> | Exit 0; skip-link and language-switch tests pass. |
| Typecheck | <code>cd frontend && npm run typecheck</code> | Exit 0 with no TypeScript errors. |
| Full frontend tests | <code>cd frontend && npm test</code> | Exit 0; all Vitest tests pass. |
| Lint/build | <code>cd frontend && npm run lint && npm run build</code> | Exit 0; lint and production build pass. |

## Suggested executor toolkit

- Use the Playwright setup and deterministic API fixtures from plan 010; do
  not run browser tests against a real DNS benchmark.
- Use CodeGraph, if available, to find consumers of regionLabel and all
  Provider notes_es reads before changing their rendering behavior.

## Scope

**In scope** (the only files you should modify):

- frontend/index.html
- frontend/src/App.tsx
- frontend/src/components/ChartsPanel.tsx
- frontend/src/components/DashboardControls.tsx
- frontend/src/components/ResolverDetailModal.tsx
- frontend/src/components/ResolverRankingPanel.tsx
- frontend/src/lib/i18n.tsx
- frontend/src/lib/i18n-translations.ts
- frontend/src/lib/i18n.copy.test.ts
- frontend/src/lib/i18n.test.ts (new)
- frontend/src/lib/utils.ts
- frontend/tests/e2e/accessibility-i18n.spec.ts (new)

**Read-only dependency inputs** (inspect, never modify):

- AGENTS.md — translation and accessibility constraints.
- plans/004-region-targeting-and-egress.md and its approved
  docs/REGION_TARGETING.md — target-region vocabulary/wording.
- plans/010-browser-regression-coverage.md and its Playwright configuration
  and fixture module.
- frontend/src/lib/useFocusTrap.ts — retain its current trap/restore behavior.
- frontend/src/lib/types.ts and data/dns_providers.es.json — Spanish-only
  catalog note contract; do not translate catalog claims in this plan.

**Out of scope** (do NOT touch, even though they look related):

- plans/README.md — the reviewer maintains the plan index.
- Adding, translating, or validating provider catalog claims in
  data/dns_providers.es.json. For EN/PT, this plan uses an explicit localized
  unavailable-description fallback rather than inventing translations.
- Region-target selection behavior, egress policy, manual chip coverage, or
  catalog expansion — plan 004 owns them.
- Modal focus-trap algorithm changes, visual restyling, SEO metadata, and
  arbitrary ARIA changes not directly tied to a defect above.
- Browser harness configuration/package dependencies — plan 010 owns them.

## Git workflow

- Branch: <code>advisor/009-accessibility-i18n-contract</code>
- Use conventional commits, for example
  <code>fix(i18n): synchronize document language and localized labels</code>.
- Keep landmark/I18n behavior and test coverage in reviewable commits. Do NOT
  push or open a PR unless the operator asks.

## Steps

### Step 1: Add one complete vocabulary for the directly evidenced strings

After plan 004 has established its approved target-region union, add ES source
keys and EN/PT equivalents for:

- loading ARIA label;
- auto, all, global, and each approved target-region label;
- chart failure-rate label;
- ranking score and blocking labels;
- a localized message that a provider description is available only in Spanish.

Choose component-specific keys rather than reusing semantically unrelated
copy. Retain interpolation for numeric values, and keep the translations type
derived from the ES object so an omitted locale is a compile-time failure.
Extend i18n.copy.test.ts with an explicit copy contract for the new
accessibility/region/result strings in addition to the existing parity gate.

**Verify**: <code>cd frontend && npm test -- i18n.copy.test.ts</code> → exit 0; ES, EN, and PT have the same keys and the new copy contract passes.

### Step 2: Synchronize the document language from initial state onward

Refactor i18n.tsx so locale resolution is testable without a browser and
document language synchronization happens whenever the provider language state
changes, including its initial saved/browser-derived value. Keep localStorage
writes in the setter, but move the DOM update into a lifecycle path or an
equally explicit helper that receives a document root.

Create i18n.test.ts with fake storage/browser inputs and a fake document root.
Test stored EN, browser PT with no stored value, unsupported browser language
falling back to ES, a later language change, and that no missing window
property causes a crash in the tested helper. Preserve index.html Spanish as
the no-JavaScript fallback; the mounted application must promptly replace it
with the active language.

**Verify**: <code>cd frontend && npm test -- i18n.test.ts i18n.copy.test.ts</code> → exit 0; locale resolution and document-root updates pass without a browser DOM dependency.

### Step 3: Make Skip target the content after the header

In App, retain the skip link but place the header outside the target main
landmark. Keep the app-shell styling wrapper, then make the first post-header
content landmark a main element with id main-content and tabIndex negative one.
The skip link must focus that landmark, so the next Tab continues into content
instead of returning to the theme/language controls in the header.

Do not remove the header, theme control, locale menu keyboard logic, or modal
focus traps. Check styles after the semantic wrapper change; only change CSS if
the existing app-shell layout actually needs a selector adjustment.

Add the plan-010 browser test: tab to the visible-on-focus skip link, activate
it, assert main-content is focused, then assert subsequent keyboard navigation
does not return to the header theme control.

**Verify**: <code>cd frontend && npm run test:e2e -- --project=chromium tests/e2e/accessibility-i18n.spec.ts</code> → exit 0; the skip-link focus flow passes.

### Step 4: Route all identified copy through I18n without translating data claims

Replace App loading labels, ChartsPanel failure-rate text, and
ResolverRankingPanel score/blocking text with the keys from step 1. Replace
the English regionLabel record in utils.ts with a translation-key mapping or a
caller-provided translator based on plan-004 normalized scope; DashboardControls
and the hero must display the active-language label.

In ResolverDetailModal, display notes_es only when the active language is ES.
For EN/PT show the new localized unavailable-description message rather than
presenting Spanish content as translated information. Provider names, IPs, and
protocol acronyms remain data/technical identifiers and are not translated.

Search the in-scope component sources for the old literals after the change.
Do not change the catalog file or add unreviewed translated provider claims.

**Verify**: <code>cd frontend && rg -n 'aria-label="Cargando"|Failure rate:|Score |Bloqueo ' src/App.tsx src/components/ChartsPanel.tsx src/components/ResolverRankingPanel.tsx</code> → no matches; then <code>npm run typecheck</code> exits 0.

### Step 5: Prove language switching and keyboard behavior in Chromium

Using plan-010 fixtures, add accessibility-i18n.spec.ts. It must seed a saved
EN and a browser PT locale before app load, then assert the html language
attribute after initialization and after switching locale through the existing
keyboard-operable language menu. It must test the skip-link flow from step 3,
and at least one representative component for each replaced copy group:
loading ARIA text, region label, chart failure rate, ranking metadata, and
Spanish-only provider-description fallback.

Keep selectors semantic and locale-aware. Mock every API and public-IP request
through the shared fixture; no test may contact a resolver, GeoIP database, or
third-party endpoint.

**Verify**: <code>cd frontend && npm run test:e2e -- --project=chromium tests/e2e/accessibility-i18n.spec.ts</code> → exit 0; every test runs with mocked network only.

### Step 6: Run complete gates and inspect accessibility boundaries

Run unit, browser, lint, typecheck, and production build gates. Review the
diff to confirm no focus-trap implementation, provider data, plan index, or
unrelated ARIA attribute changed. Confirm that the Spanish/EN/PT parity gate
still covers every key.

**Verify**: <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run test:e2e -- --project=chromium tests/e2e/accessibility-i18n.spec.ts && npm run build</code> → all commands exit 0.

## Test plan

- Add i18n.test.ts for initial locale resolution and injected document-language
  synchronization; do not require a full React renderer for this pure contract.
- Extend i18n.copy.test.ts with key parity and exact copy contract checks for
  all added UI strings.
- Add accessibility-i18n.spec.ts after plan 010: saved/browser locale,
  keyboard language switch, html lang, skip target focus, post-skip Tab order,
  representative localized copy, and Spanish-only note fallback.
- Preserve existing modal focus-trap behavior by exercising one existing modal
  keyboard path in the browser test rather than rewriting its hook.
- Verification: <code>cd frontend && npm test -- i18n.copy.test.ts i18n.test.ts && npm run test:e2e -- --project=chromium tests/e2e/accessibility-i18n.spec.ts</code> → all tests pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] The mounted html language equals the initial saved/browser-selected
  locale and changes with the existing language control.
- [ ] All added ES keys exist in EN/PT and copy contract tests pass.
- [ ] The skip link focuses a post-header main-content target and the next Tab
  does not return to header controls.
- [ ] Identified loading, region, chart, and ranking literals are translated
  through I18n.
- [ ] EN/PT never display notes_es as if it were localized copy; the fallback
  is explicit and localized.
- [ ] <code>cd frontend && npm test -- i18n.copy.test.ts i18n.test.ts</code> exits 0.
- [ ] <code>cd frontend && npm run test:e2e -- --project=chromium tests/e2e/accessibility-i18n.spec.ts</code> exits 0.
- [ ] <code>cd frontend && npm run lint && npm run typecheck && npm test && npm run build</code> exits 0.
- [ ] No files outside the in-scope list are modified; plans/README.md is
  unchanged.

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 004 does not provide an approved normalized region vocabulary, or its
  policy decision requires copy outside the union described there.
- Plan 010 has not established the promised Chromium test command/fixtures;
  do not create a competing browser harness here.
- A product owner requires full EN/PT translations of provider catalog notes
  rather than the localized unavailable-description fallback. That requires
  data scope and content-owner review beyond this plan.
- The landmark restructure would require a visual/layout redesign or creates
  another main landmark; preserve one main content target and ask for direction.
- A required keyboard/focus fix would change useFocusTrap behavior beyond the
  directly evidenced skip-link defect.
- Current code has drifted so another provider or component owns the identified
  strings, requiring an out-of-scope change.

## Maintenance notes

- Any user-visible string, including ARIA labels and helper labels, must enter
  translations.es first and pass EN/PT parity before merge.
- Keep document language synchronization in one provider-owned path; new
  locale controls must call that state setter rather than writing html lang
  themselves.
- Data labels and claims are not ordinary UI copy. Until catalog translations
  are owned and reviewed, keep Spanish-only notes explicitly bounded rather
  than silently mixing languages.
- Reviewers should keyboard-test the skip link and one modal in Chromium as
  part of every landmark/focus PR.
