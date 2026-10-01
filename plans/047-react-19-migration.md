# Plan 047: Migrate the frontend from React 18 to React 19

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 57a8e34..HEAD -- frontend/package.json frontend/package-lock.json frontend/src`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (the 18 line is frozen; staying behind accrues ecosystem lag)
- **Effort**: M
- **Risk**: MED (major-version bump, but the compat facts below make it a clean one)
- **Depends on**: none (independent of 045/046; if 045 changed the lockfile first, re-run Step 0 against it)
- **Category**: migration
- **Planned at**: commit `57a8e34`, 2026-09-15

## Why this matters

The deep-reaudit (2026-08-13) explicitly deferred this migration to the
post-release window "with a fresh test stack" — v1.4.0 has shipped and
the stack is fresh (183 vitest + 27 e2e, all green). React 18 is frozen
upstream; every other heavy dep already peer-declares 19, so the window
the reaudit waited for is open now. Landing it before the next feature
wave avoids migrating under a larger diff later.

## Current state

- `frontend/package.json:19-20` — `"react": "^18.3.1"`, `"react-dom": "^18.3.1"`.
- Compat facts (verified 2026-09-15 from `package.json` + source):
  - `"recharts": "^2.15.4"` — the 2.15 line peer-declares React 19 support (executor MUST confirm via install peer output, Step 1).
  - `"@testing-library/react": "^16.3.2"` — the v16 line supports React 19.
  - `"@types/react": "^18.3.23"`, `"@types/react-dom": "^18.3.7"` — must move to the 19 line in the same commit.
  - `"@vitejs/plugin-react": "^6.0.5"` — version-agnostic to the React major.
  - `frontend/src/main.tsx:9` — `ReactDOM.createRoot(...).render(...)`, the
    modern root API that React 19 keeps (no legacy `ReactDOM.render`
    anywhere — verify with grep in Step 1).
- Repo conventions: lockfile installs only (`npm ci`); gates
  `npm run lint && npm run typecheck && npm run build && npm test` + 27 e2e.

## Commands you will need

| Purpose | Command | Provenance | Expected on success |
|---|---|---|---|
| Drift check | `git diff --stat 57a8e34..HEAD -- <in-scope paths>` | declared | exit 0 (empty) |
| Peer audit | `grep -rn "ReactDOM.render" frontend/src` | declared | no matches |
| Bump | version edits + `npm ci` (see Step 1) | declared | exit 0, zero ERESOLVE/peer warnings for react |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | declared | all exit 0 |
| e2e | `cd frontend && npx playwright test --reporter=line` (port-shifted if needed) | declared | 27 passed |
| Scope | `git diff --name-only <base>...HEAD` (three dots) | declared | only in-scope files |

## Scope

**In scope** (the only files you should modify):
- `frontend/package.json` — react, react-dom, @types/react, @types/react-dom majors
- `frontend/package-lock.json` — resolved tree
- `frontend/src/**/*.tsx` — ONLY mechanical codemods React 19 requires (none expected; every edit needs a compiler-or-test justification recorded in NOTES)

**Out of scope** (do NOT touch):
- Recharts, testing-library, or any other dependency version (unless a peer conflict forces it — then STOP, don't freelance)
- Backend of any kind
- Behavior, copy, or styling changes of any kind

## Git workflow

- Branch: `plan/047-react-19`
- Commits: `chore(deps): migrate frontend to React 19` (single commit unless a codemod needs separation — then two, and say why).
  Merge commit: `merge: plan 047 — React 19 migration`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Establish a green baseline

On the unmodified checkout: `cd frontend && npm run lint && npm run
typecheck && npm run build && npm test` (all exit 0) and one e2e pass
(27 passed). If `node_modules/` is missing, `npm ci` first (never
`npm install`).

**Verify**: baseline green, recorded.

### Step 1: Confirm the compat facts, then bump

1. `grep -rn "ReactDOM.render" frontend/src` → no matches (legacy API absent).
2. `grep -rn "UNSAFE_\|componentWill\|defaultProps" frontend/src --include="*.tsx" | grep -v test` → record output; any hits on function components' `defaultProps` must be converted to default parameters (the one React 19 removal that bites silently).
3. Edit `package.json`: `react`/`react-dom` `^18.3.1` → `^19`, `@types/react`/`@types/react-dom` → `^19` (matching minor: take whatever `npm` resolves; record the resolved versions).
4. `npm ci` (lockfile is stale after a package.json edit — regenerate the
   lock entries with `npm install --package-lock-only`, then `npm ci`;
   both commands are scoped to this bump, not general installs).
5. The install output must show ZERO peer-dependency warnings mentioning
   react (recharts/testing-library compat proof). Any ERESOLVE or react
   peer warning → STOP and report (do not `--force` or `--legacy-peer-deps`).

**Verify**: install clean with zero react peer warnings; resolved versions recorded.

### Step 2: Gates

`cd frontend && npm run lint && npm run typecheck && npm run build &&
npm test` → all exit 0. Typecheck is the load-bearing gate here (type
breaking changes surface first). Then e2e → 27 passed. If e2e flakes
once, re-run that spec file alone to distinguish flakes from regressions;
two consistent failures → STOP.

**Verify**: all green; `git status` / three-dot diff shows only in-scope files.

## Test plan

- No new tests (migration; the existing 183 + 27 are the net, and they are
  unusually strong for this: hook suites pin unmount/abort behavior that
  concurrent-mode changes would disturb).
- If Step 1 item 2 found `defaultProps`-on-function-component hits, the
  converted components get their existing suites re-run explicitly by file
  (`npx vitest run <file>`) and the file names recorded in NOTES.

## Done criteria

ALL must hold:

- [ ] `grep '"react": "\^19' frontend/package.json` and same for react-dom, @types/react, @types/react-dom
- [ ] Install log shows zero react peer warnings (recorded in NOTES or commit message)
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] e2e — 27 passed
- [ ] `git diff --name-only <base>...HEAD` lists only `frontend/package.json`, `frontend/package-lock.json` (+ justified `.tsx` codemods, if any)
- [ ] `plans/README.md` status row for 047 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- Any react peer warning / ERESOLVE appears (no `--force`, no `--legacy-peer-deps`).
- A codemod beyond `defaultProps`-to-defaults is required (report it; the "clean migration" assumption failed).
- e2e or hook suites fail in ways traceable to React behavior change (report the failing suite + diff, don't refactor app code to suit).
- A `declared` command fails on the unmodified checkout (broken baseline — report, don't repair).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- After this lands, the `"^18"` references in docs/TESTING.md or comments (if any) should read 19 — grep and fix stragglers in a follow-up, not here.
- Recharts stays 2.15.x: a recharts v3 migration is a separate decision (new animation/tooltip APIs), explicitly not this plan.
- **Deferred:** recharts v3 evaluation — blocked on nothing, just out of scope.
