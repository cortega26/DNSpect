# Release Checklist (`v0.2.0`)

## 1. Version Verification

- [ ] `backend/app/__init__.py` version matches release (`0.2.0`).
- [ ] `backend/pyproject.toml` project version matches release (`0.2.0`).
- [ ] `frontend/package.json` version matches release (`0.2.0`).
- [ ] `CHANGELOG.md` contains released version entry and date.

## 2. CI Verification

- [ ] `ci.yml` workflow green on `main`.
- [ ] `release.yml` validated for tag trigger pattern `v*`.
- [ ] Backend gates pass: `ruff check .`, `ruff format --check .`, `mypy`, `pytest -q`.
- [ ] Frontend gates pass: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`.

## 3. Smoke Test Verification

- [ ] `scripts/smoke_test.sh` completes successfully.
- [ ] API health endpoint responds `200` with `status=ok`.
- [ ] Benchmark run completes and result export endpoints are reachable.

## 4. Packaging Verification

- [ ] Frontend production build exists in `frontend/dist`.
- [ ] Packaging command succeeds: `python scripts/package_backend.py` (or project venv equivalent).
- [ ] `dist/` contains platform binary (`dns-speed-lab-*`).
- [ ] `release/` contains bundled artifact and compressed archive.

## 5. Artifact Verification

- [ ] Packaged binary starts successfully.
- [ ] `GET /api/health` returns healthy response from packaged runtime.
- [ ] Root route (`/`) serves frontend HTML from packaged runtime.
- [ ] Archive naming is version-appropriate for release upload.

## 6. GitHub Release Steps

- [ ] Local tag created: `git tag v0.2.0`.
- [ ] Push branch and tag:
  - `git push origin main`
  - `git push origin v0.2.0`
- [ ] Confirm `release.yml` workflow executes for the tag.
- [ ] Validate uploaded release artifacts on GitHub Release page.
- [ ] Publish release notes (auto-generated or curated).
