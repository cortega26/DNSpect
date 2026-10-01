# Plan 046: Regenerate the Flatpak node sources (release unblock)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 57a8e34..HEAD -- packaging/flatpak/generated-sources.json frontend/package-lock.json io.github.cortega26.DNSpect.yaml Makefile`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (deferred release-checklist item from plan 037; the next release tag cannot ship Flatpak without it)
- **Effort**: S
- **Risk**: LOW (generated file + validation; no app code)
- **Depends on**: none (run BEFORE plan 045's lockfile change if both are in flight — regen must reflect the final lockfile; if 045 merges first, re-run Step 1 here)
- **Category**: dx (release readiness)
- **Planned at**: commit `57a8e34`, 2026-09-15

## Why this matters

`docs/RELEASE_CHECKLIST.md` §6 requires regenerating
`packaging/flatpak/generated-sources.json` from the current
`frontend/package-lock.json` before any release, and plan 037 deferred
exactly this step. The lockfile has since moved (revamp waves 040–044
touched frontend deps indirectly via audits, and plan 045 may move it
again), so the generated sources are suspect until re-proven. A stale
generated-sources file means the Flatpak build either fails or ships the
wrong node tree.

## Current state

- `packaging/flatpak/generated-sources.json` — the generated node source
  list (committed; consumed by the Flatpak manifest build).
- `Makefile:69-70` — the generator:
  `cd frontend && flatpak-node-generator npm --stub-requests package-lock.json -o ../packaging/flatpak/generated-sources.json`
- `docs/RELEASE_CHECKLIST.md:51-57` — §6 Flatpak Manifest Verification:
  regen via `make flatpak-deps`, manifest `commit:` must match the
  release tag hash, then `make flatpak-validate` when tooling is available.
- App ID `io.github.cortega26.DNSpect` must match across desktop file,
  icon, metainfo, manifest (Flatpak compliance, see AGENTS.md).

## Commands you will need

| Purpose | Command | Provenance | Expected on success |
|---|---|---|---|
| Drift check | `git diff --stat 57a8e34..HEAD -- <in-scope paths>` | declared | exit 0 (empty, or only the 045 lockfile context) |
| Regen | `make flatpak-deps` (repo root) | declared | exit 0, `generated-sources.json` rewritten |
| Staleness proof | `git diff --stat -- packaging/flatpak/generated-sources.json` | declared | empty (was fresh) or node-tree diff (was stale, now fixed) |
| Validate | `make flatpak-validate` (repo root) | declared | exit 0, or documented tooling-unavailable skip (see Step 3) |
| Consistency | `grep -c '"url"' packaging/flatpak/generated-sources.json` and cross-check package count vs lockfile | declared | counts consistent (exact command in Step 2) |

## Scope

**In scope** (the only files you should modify):
- `packaging/flatpak/generated-sources.json` — regenerated output only

**Out of scope** (do NOT touch):
- `io.github.cortega26.DNSpect.yaml` — the `commit:` field updates at release-tag time, not here
- `frontend/package-lock.json` — if the regen implies lockfile changes, STOP (that's plan 045's territory or a drift signal)
- Any app code, backend or frontend

## Git workflow

- Branch: `plan/046-flatpak-sources-regen`
- Commits: `chore(flatpak): regenerate node sources from current lockfile`
  (if the regen is byte-identical, commit nothing and report "already fresh" — that IS the completion). Merge commit: `merge: plan 046 — flatpak sources regen`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Baseline and tooling check

1. `git status --short` → clean (unmodified checkout).
2. `which flatpak-node-generator` → must resolve. If missing, STOP and
   report "tooling unavailable" (do not install toolchains to get moving).
3. Record `sha256sum packaging/flatpak/generated-sources.json` (the before-hash).

**Verify**: clean tree, tooling present, before-hash recorded.

### Step 1: Regenerate

`make flatpak-deps` → exit 0. Then `git status --short`:
- Only `packaging/flatpak/generated-sources.json` may be modified. Anything
  else (especially the lockfile) → STOP and report.

**Verify**: exit 0; scope clean.

### Step 2: Prove fresh-or-fixed

1. `git diff --stat -- packaging/flatpak/generated-sources.json`:
   - Empty → the file WAS fresh; record the after-hash (must equal the
     before-hash) and report "already fresh, reproducibility proven".
   - Non-empty → it WAS stale; sanity-check the diff is a node-tree
     version drift (package names/versions/URLs), not structural garbage:
     `git diff -- packaging/flatpak/generated-sources.json | grep "^[+-]" | grep -v "^[+-][+-]" | grep -vc '"version"\|"url"\|"sha256"\|"dest"'` should be ~0 (only version/url/sha lines changed).
2. Cross-check: the set of top-level package names in the generated file
   must cover `frontend/package-lock.json`'s `packages` entries (spot-check
   5 entries by hand, record which).

**Verify**: staleness verdict recorded with hashes; diff shape sane.

### Step 3: Validate

`make flatpak-validate` → exit 0. If the Flatpak toolchain
(flatpak-builder) is unavailable in this environment, record the exact
error output and mark this step SKIPPED-tooling (not failed) — the regen
proof in Step 2 is then the completion evidence. Do NOT attempt partial
builds or installs.

**Verify**: validate green, or exact tooling error recorded as skip.

## Test plan

- No new tests (generated artifact; validation is the net).
- The Step 2 hash/diff-shape evidence is the regression instrument: a
  future regen that silently changes structure will fail the shape check.

## Done criteria

ALL must hold:

- [ ] `make flatpak-deps` exits 0 and modifies ONLY `packaging/flatpak/generated-sources.json` (or proves it byte-identical)
- [ ] Before/after hashes recorded; stale-vs-fresh verdict stated with evidence
- [ ] `make flatpak-validate` green, or exact tooling-unavailable output recorded as SKIPPED-tooling
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 046 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- `flatpak-node-generator` is not installed.
- The regen touches the lockfile, the manifest, or any app file.
- The generated diff contains structural changes beyond version/url/sha lines.
- Plan 045 merged a lockfile change mid-flight (re-run Step 1 against the new lockfile rather than shipping a stale regen).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- This regen must re-run on EVERY lockfile change before a release; consider a CI check that diffs regen output (future plan, not this one).
- The manifest `commit:` pin is release-time work (RELEASE_CHECKLIST §6), not this plan.
- **Deferred:** CI regen-freshness check — unblocked by nothing, just not worth doing now.
