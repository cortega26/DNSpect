# Release Checklist (`<version>`)

## 1. Version Verification

Run the agreement check first — all three version sources must agree and match
the tag you are about to cut:

```bash
python3 -c 'import json, tomllib; from pathlib import Path; versions={tomllib.loads(Path("backend/pyproject.toml").read_text())["project"]["version"], Path("backend/app/__init__.py").read_text().split("\"")[1], json.loads(Path("frontend/package.json").read_text())["version"]}; assert len(versions) == 1, versions; print("version-contract-ok:" + versions.pop())'
```

- [ ] The command prints `version-contract-ok:<version>` matching the release tag.
- [ ] `CHANGELOG.md` contains the released version entry and date.

## 2. CI Verification

- [ ] `ci.yml` workflow green on `main` (backend, frontend, dependency-audit, packaged-linux-smoke, packaged-windows-smoke, semgrep).
- [ ] `release.yml` validated for the tag trigger pattern `v*`.
- [ ] Local backend gate passes: `make backend-check`.
- [ ] Local frontend gate passes: `npm run lint && npm run typecheck && npm test && npm run build`.
- [ ] Local dependency audit passes: `make dependency-audit`.

## 3. Smoke Test Verification

- [ ] `scripts/smoke_test.sh` completes successfully.
- [ ] API health endpoint responds `200` with `status=ok`.
- [ ] Benchmark run completes and result export endpoints are reachable.

## 4. Packaging Verification

- [ ] Frontend production build exists in `frontend/dist`.
- [ ] Packaging command succeeds: `python scripts/package_backend.py` (or project venv equivalent).
- [ ] `dist/` contains the platform binary.

## 5. Release Matrix Artifacts

Expected release assets (produced by `release.yml` from the tagged commit):

- `dnspect-linux-x64`
- `dnspect-windows-x64.exe`
- `dnspect-macos-arm64` (macOS is published on the arm64 channel only)
- `checksums.txt` (SHA256)
- `checksums.txt.sig` (optional, only if signing is enabled)

- [ ] `release/` contains the bundled artifact and compressed archive.
- [ ] Packaged binary starts successfully.
- [ ] `GET /api/health` returns a healthy response from the packaged runtime.
- [ ] Root route (`/`) serves frontend HTML from the packaged runtime.
- [ ] Per-asset verification: run the checks in `docs/RELEASE_VERIFY.md` against each downloaded asset.

## 6. Flatpak Manifest Verification

The order below matters: the tag must exist before the manifest can be pinned to
it, and the generated dependency sources must be regenerated from the pinned
tree *before* the consistency gate can pass.

- [ ] Regenerate the pinned runtime closure and the python deps:
  `make flatpak-python-deps`.
  - Derives `packaging/flatpak/requirements.closure.txt` from
    `backend/constraints.txt`, so transitive dependencies cannot float to
    whatever PyPI currently serves. Both the closure script and the generators
    need local tooling (`flatpak-pip-generator`); without it, record the
    regeneration as an item for the release machine.
- [ ] Regenerate `packaging/flatpak/generated-sources.json` (node deps):
  `make flatpak-deps`.
- [ ] Set the manifest `commit:` field to the release tag hash:
  `git rev-parse v<version>`.
- [ ] Run the offline consistency gate: `make flatpak-consistency`.
  - Verifies the version contract, the manifest pin against the tag, app-id
    parity across manifest/metainfo/desktop/icon, that the metainfo's latest
    `<release>` matches the version contract, that the generated node sources
    cover every package in the lockfile *at the pinned commit*, and that the
    generated python sources pin the whole runtime closure to
    `backend/constraints.txt`. This is the gate that would have caught the
    v1.4.0 packaging defects, so do not skip it.
- [ ] When tooling is available, build and lint the artifacts:
  `make flatpak-validate`.

## 7. Pre-Upload Windows Packaged Smoke

Before publishing the Windows asset:

- [ ] Run the packaged-Windows smoke against the built artifact:
  `pwsh ./scripts/smoke_packaged_windows.ps1 -BinaryPath release-assets/dnspect-windows-x64.exe`
- [ ] The smoke log shows the health check passing and no unexpected failures.

## 8. GitHub Release Steps

- [ ] Local tag created: `git tag v<version>`.
- [ ] Push branch and tag:
  - `git push origin main`
  - `git push origin v<version>`
- [ ] Confirm `release.yml` workflow executes for the tag.
- [ ] Validate uploaded release artifacts on the GitHub Release page.
- [ ] Publish release notes (auto-generated or curated).
