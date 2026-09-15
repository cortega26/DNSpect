# Plan 045: Remediate the 3 open Dependabot alerts (vitest toolchain)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 57a8e34..HEAD -- frontend/package.json frontend/package-lock.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (dev-only attack surface, but CI supply-chain hygiene; all 3 are `medium`)
- **Effort**: S
- **Risk**: LOW (devDependency bumps; production bundle untouched)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `57a8e34`, 2026-09-15

## Why this matters

Three Dependabot alerts are open on this repo, all `medium`, all in the
frontend dev toolchain: a path-traversal/arbitrary-file-read in
`vitest` + `@vitest/mocker` (GHSA-82fw-gwwq-j7x9, via redirect mocks) and
a symlink-escape in `@humanfs/node` (GHSA-p498-v437-472g). They are
dev-only (test runner, never shipped), so exploitability is limited to a
malicious test fixture or a poisoned local checkout — but the fix is a
patch/minor bump with a full test net to catch regressions. No open
production advisories exist (the starlette/python-multipart/js-yaml items
are all `fixed` state).

## Current state

- `frontend/package.json:36` — `"vitest": "^4.1.10"` (devDependency; the
  vulnerable package). `@vitest/mocker` and `@humanfs/node` arrive
  transitively via the vitest toolchain (verify with `npm ls`).
- Open alerts (verified 2026-09-15 via `gh api
  repos/cortega26/DNSpect/dependabot/alerts`):
  - `vitest` + `@vitest/mocker` — GHSA-82fw-gwwq-j7x9 (medium)
  - `@humanfs/node` — GHSA-p498-v437-472g (medium)
- Repo conventions: lockfile installs only (`npm ci`, never bare
  `npm install` — see AGENTS.md); frontend gates are `npm run lint &&
  npm run typecheck && npm run build && npm test` plus e2e
  (`frontend/tests/e2e`, 27 specs). Prior remediation precedent: plan 011
  (archived).

## Commands you will need

| Purpose | Command | Provenance | Expected on success |
|---|---|---|---|
| Drift check | `git diff --stat 57a8e34..HEAD -- <in-scope paths>` | declared | exit 0 (empty) |
| Advisory list | `npm audit --audit-level=moderate` (in `frontend/`) | declared | lists the 3 advisories pre-fix, none post-fix |
| Fix | `npm audit fix` (in `frontend/`) | declared | exit 0, lockfile updated |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | declared | all exit 0 (183 vitest) |
| e2e | `cd frontend && npx playwright test --reporter=line` (port-shifted if :5173 busy) | declared | 27 passed |
| Scope | `git diff --name-only <base>...HEAD` (three dots) | declared | only in-scope files |

## Scope

**In scope** (the only files you should modify):
- `frontend/package.json` — only if a fix requires a direct version bump
- `frontend/package-lock.json` — the advisory fixes

**Out of scope** (do NOT touch):
- `packaging/flatpak/requirements.txt` — its starlette alerts are `fixed` state already
- Any production dependency or version (react, recharts, backend pins)
- Backend of any kind

## Git workflow

- Branch: `plan/045-dependabot-remediation`
- Commits: `fix(deps): remediate vitest/humanfs advisories` (one commit is fine).
  Merge commit: `merge: plan 045 — dependabot remediation`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Establish a green baseline

On the unmodified checkout: `cd frontend && npm audit --audit-level=moderate`
(record the 3 advisories), then `npm run lint && npm run typecheck &&
npm run build && npm test` (expect all exit 0). Do NOT run `npm ci`
unless `node_modules/` is missing.

**Verify**: baseline green; the 3 advisories reproduce.

### Step 1: Apply the fixes

1. `cd frontend && npm audit fix`. (This updates the lockfile and, if
   required, `package.json`. Do NOT run bare `npm install` or
   `npm update` beyond what `audit fix` does.)
2. `git diff --stat` — the diff must touch ONLY the in-scope files. If
   `audit fix` wants to touch anything else, STOP and report.
3. `npm audit --audit-level=moderate` → expect no remaining moderate+
   advisories (informational/low may remain; record them, do not chase).

**Verify**: audit clean at moderate+; scope clean.

### Step 2: Regression gates

`cd frontend && npm run lint && npm run typecheck && npm run build &&
npm test` → all exit 0 (vitest 183/183 — the bumped package IS the test
runner, so this is the real regression net). Then e2e (port-shifted if
needed) → 27 passed.

**Verify**: gates green; `git status` shows only in-scope files.

## Test plan

- No new tests (dependency bump; existing suites are the net).
- If `npm audit fix` changes vitest's major version, run the full e2e
  suite twice (flakiness check on the new runner) and say so in NOTES.

## Done criteria

ALL must hold:

- [ ] `npm audit --audit-level=moderate` in `frontend/` reports zero advisories
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] e2e — 27 passed
- [ ] `git diff --name-only <base>...HEAD` lists only `frontend/package.json` / `frontend/package-lock.json`
- [ ] `plans/README.md` status row for 045 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- A fix requires a MAJOR version bump of vitest (report the version delta instead of taking it).
- `npm audit fix` touches files outside scope, or a `declared` command fails on the unmodified checkout (broken baseline — report, don't repair).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Dependabot will re-alert on the next advisory batch; this plan is the repeatable playbook (audit → fix → gates).
- The `fixed`-state alerts (starlette, python-multipart, brace-expansion, js-yaml, postcss) need no action unless reopened.
- **Deferred:** nothing — one-shot remediation.
