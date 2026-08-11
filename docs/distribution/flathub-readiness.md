# DNSpect Flathub Readiness

## Chosen identity

- App ID: `io.github.cortega26.DNSpect`
- Verification path: GitHub-based Flathub verification, using the existing upstream repository `https://github.com/cortega26/DNSpect`
- Architecture scope: `x86_64` and `aarch64`

Why this ID:

- Flathub requires reverse-DNS style IDs and recommends `io.github.*` for apps hosted on GitHub.
- The GitHub owner in the upstream repository is `cortega26`, so `io.github.cortega26.DNSpect` lines up with Flathub’s GitHub verification model.

Primary references:

- Flathub requirements: `https://docs.flathub.org/docs/for-app-authors/requirements/`
- Flathub app ID guidance: `https://docs.flathub.org/docs/for-app-authors/requirements/#application-id`
- Flathub verification: `https://docs.flathub.org/docs/for-app-authors/verification/`
- Flatpak Python guide: `https://docs.flatpak.org/en/latest/python.html`
- Flatpak sandbox permissions: `https://docs.flatpak.org/en/latest/sandbox-permissions.html`

## Packaging strategy

DNSpect ships as a single local HTTP process: FastAPI serves the built React frontend from `frontend/dist`, and the binary or CLI opens `http://127.0.0.1:<port>`. The Flatpak packaging keeps that model instead of introducing a separate embedded browser or rewriting the app as a native toolkit UI.

Strategy details:

- Install the Python backend into `/app` from source.
- Build the React frontend inside Flatpak using `org.freedesktop.Sdk.Extension.node24`.
- Install the generated `frontend/dist` bundle into `/app/share/dnspect/frontend`.
- Install the provider/query/blocking-domain data into `/app/share/dnspect/data`.
- Launch through a small wrapper that sets the Flatpak-specific data/frontend paths, waits for the local server, and opens the localhost UI.
- Request only `--share=network`, because DNS benchmarking and the localhost UI both require networking, but no host filesystem or privileged D-Bus access is needed.

Why this is the current path:

- The Flatpak platform/SDK and node24 extension use branch `25.08`, whose SDK runs Python 3.13 (`flatpak run --user --command=python3 org.freedesktop.Sdk/x86_64/25.08 --version` reports `Python 3.13.12`), matching the repository contract `requires-python = ">=3.13"`.
- The manifest builds from the immutable release tag `v1.3.0` (commit `a1a97c3efe17f7822d2d5988206fa6adc2a02ed4`), which contains the exact backend and frontend dependency inputs being packaged.
- Both generated Flatpak inputs are mechanically regenerable (see below); neither is safe to hand-edit.

## Generated release inputs

Two generated files are derived from repository locks and must be regenerated together in release preparation:

| Source of truth | Generated artifact | Command |
|---|---|---|
| `packaging/flatpak/requirements.txt` (exact runtime projection of `backend/pyproject.toml`, no dev/geoip/pack entries) | `packaging/flatpak/python3-requirements.json` | `make flatpak-python-deps` (see bootstrap below) |
| `frontend/package-lock.json` | `packaging/flatpak/generated-sources.json` | `make flatpak-deps` |

Python module bootstrap (pinned generator in a throwaway virtual environment):

```bash
DNSPECT_FLATPAK_TOOL_VENV="$(mktemp -d)" && \
  python3.13 -m venv "$DNSPECT_FLATPAK_TOOL_VENV" && \
  "$DNSPECT_FLATPAK_TOOL_VENV/bin/pip" install "flatpak-pip-generator==2026.5.28" && \
  FLATPAK_PIP_GENERATOR="$DNSPECT_FLATPAK_TOOL_VENV/bin/python3.13 -m flatpak_pip_generator.__main__" \
  make flatpak-python-deps; rc=$?; rm -rf "$DNSPECT_FLATPAK_TOOL_VENV"; exit "$rc"
```

Notes on the generators:

- The pinned `flatpak-pip-generator==2026.5.28` console script is broken upstream (`flatpak_pip_generator` references a `main` that does not exist), so the bootstrap invokes the same pinned package through `python -m flatpak_pip_generator.__main__`. The Makefile default (`FLATPAK_PIP_GENERATOR ?= flatpak-pip-generator`) still works on hosts where the script is functional.
- The target passes `--prefer-wheels=pydantic-core,uvloop,httptools,watchfiles` so the C-extension packages resolve to CPython 3.13 x86_64/aarch64 wheels instead of sdists that would need a Rust/C toolchain inside the build sandbox.
- The npm target uses `flatpak-node-generator npm --stub-requests`: it emits sources from the lockfile's own registry URLs and integrity data and skips the special "playwright browser" sources. Test-tooling browsers are not part of the packaged application; the manifest installs the frontend with `npm install --offline --ignore-scripts`.
- If a future generator version fixes the playwright browser URL handling, the `--stub-requests` flag can be removed from `make flatpak-deps`.

## Validation results (2026-08-11, v1.3.0 / 25.08)

### Static validation

- `desktop-file-validate packaging/flatpak/io.github.cortega26.DNSpect.desktop`
  - Result: pass
- `appstreamcli validate --no-net packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml`
  - Result: pass (one informational redundancy notice)
- `flatpak-builder-lint manifest io.github.cortega26.DNSpect.yaml`
  - Result: pass

### Flatpak build validation (native x86_64)

- `make flatpak-validate FLATPAK_BUILDER="flatpak run --command=flatpak-builder org.flatpak.Builder" FLATPAK_BUILDER_LINT="flatpak run --command=flatpak-builder-lint org.flatpak.Builder"`
  - Native build from the `v1.3.0` source tag with the 25.08 SDK and node24 extension: pass.
  - Manifest lint: pass.
  - Builddir lint: one known pre-submission item, `appstream-external-screenshot-url` (screenshots are not mirrored to `https://dl.flathub.org/media` yet). Flathub mirrors screenshot media after the submission PR; this item is expected to clear on Flathub's infrastructure and is recorded here rather than suppressed.
- Built-app Python import smoke:
  - `flatpak run org.flatpak.Builder --run build-flatpak/build io.github.cortega26.DNSpect.yaml python3 -c 'import fastapi, starlette, httpx, dns, multipart, pydantic_core; print("flatpak-python-imports-ok")'`
  - Result: `flatpak-python-imports-ok` (the generated module supplies the full runtime closure; the manifest installs with `pip3 install --no-deps`)
- Headless health smoke (bounded, no sandbox permission changes):
  - Launched `dnspect` headless on port 18083 inside the built app and polled `/api/health`.
  - Result: `{"status":"ok",...}`; the background process was terminated after the check.

## Runtime and sandbox notes

- Required permission: `--share=network` (outbound DNS benchmarking and the localhost UI).
- No host filesystem permission is requested.
- No extra D-Bus permission is requested.
- `drill` is not bundled; the observed runtime engine inside Flatpak is `dnspython`.
- The localhost flow works inside the sandbox.

## Known gaps and remaining risks

- System DNS auto-detection is degraded inside the sandbox: `/api/dns/system` reports the sandbox-visible resolver stub via `resolv.conf`, not the fuller host resolver set. Benchmarking explicit resolvers works. Host-accurate system DNS detection inside Flatpak needs a separate design decision.
- The AppStream release entry says `1.3.0` (the approved release tag), while `backend/pyproject.toml` still reports application version `1.2.0`. Bumping the backend/frontend version pair to `1.3.0` is a release-preparation step that must land before the Flathub PR so the packaged app advertises the same version as its metadata.
- The pre-submission builddir lint screenshot item described above will clear once Flathub mirrors the screenshot media.
- Multi-arch: the generated Python module contains x86_64 and aarch64-compatible CPython 3.13 inputs, but only the native x86_64 build was executed locally.

## Exact next manual actions

1. Bump `backend/pyproject.toml` and `frontend/package.json` to `1.3.0` (version parity) and cut the release commit for the Flathub PR.
2. Fork `flathub/flathub` with the `new-pr` branch included, as required by Flathub submission docs.
3. Clone your fork on the `new-pr` branch and create a submission branch.
4. Copy these files into the root of that Flathub branch:
   - `io.github.cortega26.DNSpect.yaml`
   - `packaging/flatpak/python3-requirements.json`
   - `packaging/flatpak/generated-sources.json`
   - `packaging/flatpak/dnspect-launcher`
   - `packaging/flatpak/io.github.cortega26.DNSpect.desktop`
   - `packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml`
   - `packaging/flatpak/io.github.cortega26.DNSpect.svg`
5. Commit and push that branch, then open the PR against `flathub/flathub:new-pr`.
6. After acceptance and collaborator access, complete GitHub-based verification in the Flathub Developer Portal.
7. Decide whether the sandboxed “system DNS detected” view is acceptable for v1, or whether it should be called out in release notes.

## Reproduction commands

```bash
# Metadata validation
desktop-file-validate packaging/flatpak/io.github.cortega26.DNSpect.desktop
appstreamcli validate --no-net packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest io.github.cortega26.DNSpect.yaml

# Flatpak tooling bootstrap (25.08 / node24 / builder)
flatpak install -y flathub org.freedesktop.Sdk//25.08
flatpak install -y flathub org.freedesktop.Sdk.Extension.node24//25.08
flatpak install -y flathub org.flatpak.Builder

# Regenerate the Python module (pinned generator, throwaway venv)
DNSPECT_FLATPAK_TOOL_VENV="$(mktemp -d)" && \
  python3.13 -m venv "$DNSPECT_FLATPAK_TOOL_VENV" && \
  "$DNSPECT_FLATPAK_TOOL_VENV/bin/pip" install "flatpak-pip-generator==2026.5.28" && \
  FLATPAK_PIP_GENERATOR="$DNSPECT_FLATPAK_TOOL_VENV/bin/python3.13 -m flatpak_pip_generator.__main__" \
  make flatpak-python-deps; rc=$?; rm -rf "$DNSPECT_FLATPAK_TOOL_VENV"; exit "$rc"

# Regenerate the npm sources from the audited lock
make flatpak-deps   # uses flatpak-node-generator npm --stub-requests

# Flatpak build + lint (native architecture)
make flatpak-validate FLATPAK_BUILDER="flatpak run --command=flatpak-builder org.flatpak.Builder" FLATPAK_BUILDER_LINT="flatpak run --command=flatpak-builder-lint org.flatpak.Builder"

# Built-app import smoke
flatpak run org.flatpak.Builder --run build-flatpak/build io.github.cortega26.DNSpect.yaml python3 -c 'import fastapi, starlette, httpx, dns, multipart, pydantic_core; print("flatpak-python-imports-ok")'

# Sandbox headless health smoke
flatpak run org.flatpak.Builder --run build-flatpak/build io.github.cortega26.DNSpect.yaml \
  sh -lc 'DNS_SPEED_LAB_GUI=headless DNS_SPEED_LAB_PORT=18083 DNS_SPEED_LAB_FRONTEND_DIR=/app/share/dnspect/frontend DNS_SPEED_LAB_DATA_DIR=/app/share/dnspect/data dnspect' &
curl -fsS http://127.0.0.1:18083/api/health
```
