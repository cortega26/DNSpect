# Reproducible Build Notes

This project uses pinned toolchain and dependency inputs for CI/release builds.

## Toolchain Pins

- Node.js: `24.x` (see `.github/workflows/ci.yml` and `.github/workflows/release.yml`)
- Python: `3.13` for CI and release packaging

## Python Dependency Lock Strategy

- Source of truth: `backend/pyproject.toml`
- Compiled lock constraints: `backend/constraints.txt`
- Generated with:

```bash
cd backend
python -m pip install "pip-tools==7.6.0"
pip-compile --extra=dev --extra=pack --output-file=constraints.txt pyproject.toml
```

`constraints.txt` covers both `dev` and `pack` extras so CI and release
install the same pinned transitive set.

## Required Install Commands

- Backend CI/dev checks:

```bash
cd backend
python -m pip install -r constraints.txt -e .[dev]
```

- Release packaging:

```bash
python -m pip install -r backend/constraints.txt -e "./backend[pack]"
```

## Audit Gate

Run the lock-only audit target before any dependency change:

```bash
make dependency-audit
```

This executes `pip-audit` against `backend/constraints.txt` and `npm audit
--package-lock-only` against the frontend lock. Both CI and release workflows
enforce the same checks.

## Frontend Reproducibility

- Use `npm ci` (lockfile-based install) instead of `npm install`.
- CI/release workflows already enforce this.
