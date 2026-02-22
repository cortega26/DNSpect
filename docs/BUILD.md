# Reproducible Build Notes

This project uses pinned toolchain and dependency inputs for CI/release builds.

## Toolchain Pins

- Node.js: `22.14.0` (see `.github/workflows/ci.yml` and `.github/workflows/release.yml`)
- Python: `3.11` for release packaging, `3.11` and `3.12` for backend CI

## Python Dependency Lock Strategy

- Source of truth: `backend/pyproject.toml`
- Compiled lock constraints: `backend/constraints.txt`
- Generated with:

```bash
cd backend
python -m pip install pip-tools
pip-compile pyproject.toml --extra dev --extra pack --output-file constraints.txt
```

## Required Install Commands

- Backend CI/dev checks:

```bash
cd backend
python -m pip install -c constraints.txt -e .[dev]
```

- Release packaging:

```bash
python -m pip install -c backend/constraints.txt -e "./backend[pack]"
```

## Frontend Reproducibility

- Use `npm ci` (lockfile-based install) instead of `npm install`.
- CI/release workflows already enforce this.
