# DNSpect Flathub Readiness

## Chosen identity

- App ID: `io.github.cortega26.DNSpect`
- Verification path: GitHub-based Flathub verification, using the existing upstream repository `https://github.com/cortega26/DNSpect`
- Architecture scope in this baseline: `x86_64` and `aarch64`

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

DNSpect already ships as a single local HTTP process: FastAPI serves the built React frontend from `frontend/dist`, and the binary or CLI opens `http://127.0.0.1:<port>`. The Flatpak packaging keeps that model instead of introducing a separate embedded browser or rewriting the app as a native toolkit UI.

Strategy details:

- Install the Python backend into `/app` from source.
- Build the React frontend inside Flatpak using `org.freedesktop.Sdk.Extension.node22`.
- Install the generated `frontend/dist` bundle into `/app/share/dnspect/frontend`.
- Install the provider/query data into `/app/share/dnspect/data`.
- Launch through a small wrapper that sets the Flatpak-specific data/frontend paths, waits for the local server, and opens the localhost UI.
- Request only `--share=network`, because DNS benchmarking and the localhost UI both require networking, but no host filesystem or privileged D-Bus access is needed.

Why this is the safest current path:

- It preserves the shipped runtime model already validated by the repo’s packaged Linux binary.
- It avoids bundling the existing PyInstaller executable into Flathub.
- It builds from the upstream GitHub release tag instead of relying on local checkout-only sources.
- It uses an offline npm source manifest generated from `frontend/package-lock.json`, which matches Flathub’s offline build expectations.

## Files added or updated

- `io.github.cortega26.DNSpect.yaml`: Flatpak manifest for local validation and packaging.
- `packaging/flatpak/requirements.txt`: Flatpak-only Python runtime dependency list.
- `packaging/flatpak/python3-requirements.json`: pinned Python source/wheel inputs for offline Flatpak builds.
- `packaging/flatpak/generated-sources.json`: pinned npm sources for offline frontend builds inside Flatpak.
- `packaging/flatpak/dnspect-launcher`: wrapper that injects Flatpak paths and opens the localhost UI.
- `packaging/flatpak/io.github.cortega26.DNSpect.desktop`: desktop entry for app launch and Software Manager discovery.
- `packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml`: AppStream metadata for Flathub and Linux software centers.
- `packaging/flatpak/io.github.cortega26.DNSpect.svg`: scalable app icon.
- `backend/pyproject.toml`: simplified license metadata to remove setuptools deprecation noise during Flatpak builds.

## Validation results

### Static validation

- `desktop-file-validate packaging/flatpak/io.github.cortega26.DNSpect.desktop`
  - Result: pass
- `appstreamcli validate --no-net packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml`
  - Result: pass
- `python3 -c 'import yaml; yaml.safe_load(open("io.github.cortega26.DNSpect.yaml", encoding="utf-8")); print("manifest-ok")'`
  - Result: pass

### App build and test validation

- `cd frontend && npm run build`
  - Result: pass
  - Note: Vite emitted the existing large-chunk warning for the main JS bundle; build still succeeded.
- `cd backend && ./.venv/bin/pytest -q`
  - Result: `38 passed`
- `bash scripts/smoke_test.sh`
  - Result: pass
- `bash scripts/smoke_packaged_linux.sh dist/dnspect-linux`
  - Result: pass

### Flatpak build validation

- `flatpak remote-add --if-not-exists --user flathub-user https://dl.flathub.org/repo/flathub.flatpakrepo`
  - Result: pass
- `flatpak install --user -y flathub-user org.freedesktop.Sdk//24.08 org.flatpak.Builder//stable`
  - Result: pass
- `flatpak install --user -y flathub-user org.freedesktop.Sdk.Extension.node22//24.08`
  - Result: pass
- `flatpak run org.flatpak.Builder --user --disable-rofiles-fuse --force-clean --install-deps-from=flathub-user build-flatpak io.github.cortega26.DNSpect.yaml`
  - Result: pass
  - Note: `--disable-rofiles-fuse` was needed on this host because a subsequent rebuild hit a local `Transport endpoint is not connected` rofiles-fuse error.
- Build source shape:
  - Manifest pulls upstream source from `https://github.com/cortega26/DNSpect.git` at `v1.0.1` commit `fec2979a8fa0910433f9951f73b8a6a75b545a98`
  - Frontend is built offline from `packaging/flatpak/generated-sources.json`

### Flatpak runtime smoke validation

- `flatpak run org.flatpak.Builder --run build-flatpak io.github.cortega26.DNSpect.yaml sh -lc 'DNS_SPEED_LAB_OPEN_BROWSER=0 DNS_SPEED_LAB_PORT=18083 DNS_SPEED_LAB_FRONTEND_DIR=/app/share/dnspect/frontend DNS_SPEED_LAB_DATA_DIR=/app/share/dnspect/data dnspect'`
  - Result: pass
- `curl -fsS http://127.0.0.1:18083/api/health`
  - Result: pass
- `curl -fsS -X POST http://127.0.0.1:18083/api/benchmarks -H 'Content-Type: application/json' -d '{"runs":2,"timeout_sec":1,"resolvers":["1.1.1.1"],"queries":["example.com"],"mode":"quick"}'`
  - Result: pass
- Polled benchmark result from sandboxed Flatpak run
  - Result: pass
  - Observed engine: `dnspython`

### Installed Flatpak launcher validation

- `flatpak run org.flatpak.Builder --user --install --force-clean --install-deps-from=flathub-user build-flatpak io.github.cortega26.DNSpect.yaml`
  - Result: pass
- `flatpak run --env=DNS_SPEED_LAB_PORT=18084 io.github.cortega26.DNSpect`
  - Result: pass
  - Evidence: the launcher started the server, hit `/api/health`, opened `/`, and loaded `/assets/*`, `/api/providers`, and `/api/dns/system`.

## Runtime and sandbox notes

- Required permission: `--share=network`
  - Needed for outbound DNS benchmarking and the localhost UI on `127.0.0.1`.
- No host filesystem permission is requested.
- No extra D-Bus permission is requested.
- `drill` is not bundled in the Flatpak baseline.
  - Observed runtime engine inside Flatpak: `dnspython`
- Localhost flow works inside the sandbox.
  - The app serves the UI and API on `127.0.0.1`.
  - The installed Flatpak launcher successfully triggered browser traffic to `/`.

## Known gaps and remaining risks

- System DNS auto-detection is degraded inside the sandbox.
  - In the Flatpak UI, `/api/dns/system` reported the sandbox-visible resolver stub (`127.0.0.53`) via `resolv.conf`, not the fuller host resolver set seen outside Flatpak.
  - Benchmarking explicit resolvers still worked.
  - If DNSpect needs host-accurate system DNS detection inside Flatpak, that will require a follow-up design decision, likely involving a more privileged host-call path.
- The manifest is pinned to upstream `v1.0.1`.
  - To submit a newer release, update the `commit` in [io.github.cortega26.DNSpect.yaml](/home/carlos/VS_Code_Projects/DNS_app/io.github.cortega26.DNSpect.yaml), refresh `packaging/flatpak/generated-sources.json` if frontend dependencies changed, and rebuild locally before updating Flathub.
- The Python dependency module now pins `pydantic-core` wheels for both `x86_64` and `aarch64` using `only-arches`.
  - If wider multi-arch support becomes necessary later, revisit the dependency module or add the missing Rust toolchain path for source builds.

## Exact next manual actions

1. Merge these packaging changes to `github.com/cortega26/DNSpect`.
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
7. Decide whether the sandboxed “system DNS detected” view is acceptable for v1, or whether it should be called out in release notes before submission.

## Reproduction commands

```bash
# Metadata validation
desktop-file-validate packaging/flatpak/io.github.cortega26.DNSpect.desktop
appstreamcli validate --no-net packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml
python3 -c 'import yaml; yaml.safe_load(open("io.github.cortega26.DNSpect.yaml", encoding="utf-8")); print("manifest-ok")'

# Project validation
cd frontend && npm run build
cd ../backend && ./.venv/bin/pytest -q
cd ..
bash scripts/smoke_test.sh
bash scripts/smoke_packaged_linux.sh dist/dnspect-linux

# Flatpak tooling bootstrap (user install)
flatpak remote-add --if-not-exists --user flathub-user https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y flathub-user org.freedesktop.Sdk//24.08 org.flatpak.Builder//stable
flatpak install --user -y flathub-user org.freedesktop.Sdk.Extension.node22//24.08

# Flatpak build
flatpak run org.flatpak.Builder --user --disable-rofiles-fuse --force-clean --install-deps-from=flathub-user build-flatpak io.github.cortega26.DNSpect.yaml

# Sandbox smoke test
flatpak run org.flatpak.Builder --run build-flatpak io.github.cortega26.DNSpect.yaml sh -lc 'DNS_SPEED_LAB_OPEN_BROWSER=0 DNS_SPEED_LAB_PORT=18083 DNS_SPEED_LAB_FRONTEND_DIR=/app/share/dnspect/frontend DNS_SPEED_LAB_DATA_DIR=/app/share/dnspect/data dnspect'

# Install the locally built Flatpak
flatpak run org.flatpak.Builder --user --install --force-clean --install-deps-from=flathub-user build-flatpak io.github.cortega26.DNSpect.yaml

# Run the installed app on a non-default port during testing
flatpak run --env=DNS_SPEED_LAB_PORT=18084 io.github.cortega26.DNSpect

# Flathub submission branch bootstrap
gh repo fork --clone flathub/flathub && cd flathub && git checkout --track origin/new-pr
git checkout -b dnspect-submission new-pr
```
