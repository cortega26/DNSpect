# Plan 012: Align the Flatpak runtime, sources, and generated modules with the release

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A coordinating reviewer maintains
> `plans/README.md` for this planning batch, so do **not** edit that file.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- io.github.cortega26.DNSpect.yaml packaging/flatpak/requirements.txt packaging/flatpak/python3-requirements.json packaging/flatpak/generated-sources.json packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml Makefile docs/distribution/flathub-readiness.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/011-dependency-security-remediation.md`
- **Category**: migration, tech-debt, dx
- **Planned at**: commit `e09fd2d`, 2026-08-10

## Why this matters

The Flatpak manifest currently builds the 1.0.1 source commit on a Python 3.12
runtime while the project now declares Python 3.13+, ships 1.2.0, and has a
newly remediated dependency lock from plan 011. Its generated Python module
still installs old multipart and CPython 3.12 pydantic-core wheels, omits the
runtime `httpx` required for DoH, and is independent of the frontend lock.
This plan makes the packaging inputs mechanically regenerable and ties the
Flatpak to an approved immutable release tag, so the desktop package can be
reproduced and its contents truthfully match the release being advertised.

## Current state

- `io.github.cortega26.DNSpect.yaml` — Flatpak manifest, runtime selection,
  offline generated modules, and pinned upstream source.
- `packaging/flatpak/requirements.txt` — intended Flatpak runtime Python input,
  but it is manually maintained and incomplete.
- `packaging/flatpak/python3-requirements.json` — generated offline Python
  module consumed by the manifest; currently targets CPython 3.12 artifacts.
- `packaging/flatpak/generated-sources.json` — generated offline npm sources
  consumed by the manifest.
- `packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml` — AppStream
  release metadata and screenshot source pins.
- `Makefile` — current npm-source generator and Flatpak build/lint targets.
- `docs/distribution/flathub-readiness.md` — public packaging runbook, which
  currently records the obsolete baseline rather than the current release.

The manifest currently uses the incompatible runtime and stale release source:

```yaml
# io.github.cortega26.DNSpect.yaml:1-6,15-26,36-40
runtime: org.freedesktop.Platform
runtime-version: "24.08"
sdk: org.freedesktop.Sdk
sdk-extensions:
  - org.freedesktop.Sdk.Extension.node24
modules:
  - packaging/flatpak/python3-requirements.json
...
      - type: git
        url: https://github.com/cortega26/DNSpect.git
        commit: fec2979a8fa0910433f9951f73b8a6a75b545a98
```

The installed 24.08 SDK reports `Python 3.12.12`; the available 25.08 SDK
reports `Python 3.13.12`. The current project contract is
`requires-python = ">=3.13"` (`backend/pyproject.toml:9`). Retaining 24.08
would therefore require an intentional whole-project decision to restore
Python 3.12 support, not a Flatpak-only workaround. The recommended policy in
this plan is to preserve the project contract and move the Flatpak platform,
SDK, and node24 extension together to 25.08.

The generated Python module does not match runtime requirements:

```text
# packaging/flatpak/requirements.txt:1-8
fastapi==0.129.2
starlette==0.49.3
...
python-multipart==0.0.28
# (httpx is absent)

# packaging/flatpak/python3-requirements.json:48,56,206
pydantic_core-2.33.2-cp312-cp312-...x86_64.whl
pydantic_core-2.33.2-cp312-cp312-...aarch64.whl
"python-multipart==0.0.22"
```

The backend requires `httpx==0.28.1` at runtime (`backend/pyproject.toml:18`),
and `run_doh_query` calls `dns.query.https` (`backend/app/runner.py:854-887`),
which uses httpx. The manifest installs the application with `pip3 ...
--no-deps` (`io.github.cortega26.DNSpect.yaml:26`), so every runtime import
must be supplied by the generated module.

The source/release metadata is also behind the repository: the manifest commit
is the `v1.0.1` source commit, while `v1.2.0` resolves to immutable commit
`53ef4cd76c48242c065f852a36bfb31eb9457fe8` and the AppStream releases list
only 1.0.1/1.0.0 (`packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml:46-49`).
Plan 011 deliberately changes release inputs, so **do not simply replace the
pin with v1.2.0**; the final pin must be the next maintainer-approved release
tag containing plan 011's final locks.

Conventions to retain:

- The manifest uses `--share=network` only and the launcher injects Flatpak
  paths (`io.github.cortega26.DNSpect.yaml:8-13` and
  `packaging/flatpak/dnspect-launcher:4-9`). Do not broaden sandbox access.
- `Makefile:40-48` already generates npm sources from
  `frontend/package-lock.json` and validates a clean Flatpak build with
  `flatpak-builder-lint`; extend this reproducibility model to Python rather
  than hand-maintaining JSON.
- The non-versioned `.agents/flathub-compliance.md` is currently ignored by
  `.gitignore:31-32` and still says node22. It is local advisory material, not
  a distributable source of truth; do not alter `.gitignore` or invent a
  tracking-policy migration in this plan.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prove the chosen SDK matches project Python | `flatpak run --command=python3 org.freedesktop.Sdk//25.08 --version` | `Python 3.13.*` |
| Confirm Node extension availability | `flatpak remote-ls flathub --runtime --columns=application,branch \| rg '^org\.freedesktop\.Sdk\.Extension\.node24[[:space:]]+25\.08$'` | one matching runtime row |
| Bootstrap and regenerate Python module (one subshell) | `( DNSPECT_FLATPAK_TOOL_VENV="$(mktemp -d)" && python3.13 -m venv "$DNSPECT_FLATPAK_TOOL_VENV" && "$DNSPECT_FLATPAK_TOOL_VENV/bin/pip" install "flatpak-pip-generator==2026.5.28" && FLATPAK_PIP_GENERATOR="$DNSPECT_FLATPAK_TOOL_VENV/bin/flatpak-pip-generator" make flatpak-python-deps; rc=$?; rm -rf "$DNSPECT_FLATPAK_TOOL_VENV"; exit "$rc" )` | exit 0; the temporary venv is removed and `packaging/flatpak/python3-requirements.json` is regenerated |
| Regenerate npm module | `make flatpak-deps` | exit 0; `packaging/flatpak/generated-sources.json` is regenerated from the final lock |
| Static metadata validation | `desktop-file-validate packaging/flatpak/io.github.cortega26.DNSpect.desktop && appstreamcli validate --no-net packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml && flatpak-builder-lint manifest io.github.cortega26.DNSpect.yaml` | all exit 0 |
| Native-architecture reproducible build | `make flatpak-validate` | exit 0; native-architecture build and manifest/appdir lint pass |
| Import smoke inside built app | `flatpak build build-flatpak/build python3 -c 'import fastapi, starlette, httpx, dns, multipart, pydantic_core; print("flatpak-python-imports-ok")'` | prints `flatpak-python-imports-ok` |
| Scope review | `git diff --check && git status --short` | no whitespace errors; only in-scope files changed (plus ignored build/tool directories) |

## Suggested executor toolkit

- Use `flatpak-pip-generator --help` before generating if a future version
  changes CLI syntax; keep the planned generator pin unless a maintainer
  explicitly approves an update.
- Use `git show <release-tag>:backend/pyproject.toml` and
  `git show <release-tag>:frontend/package-lock.json` to prove the manifest's
  source tag contains the release inputs it packages. Do not use `HEAD`.

## Scope

**In scope** (the only files you should modify):

- `io.github.cortega26.DNSpect.yaml`
- `packaging/flatpak/requirements.txt`
- `packaging/flatpak/python3-requirements.json` (generated)
- `packaging/flatpak/generated-sources.json` (generated)
- `packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml`
- `Makefile`
- `docs/distribution/flathub-readiness.md`

**Out of scope**:

- `backend/pyproject.toml`, `backend/constraints.txt`, `frontend/package.json`,
  and `frontend/package-lock.json` — plan 011 owns security remediation. Do
  not change them here; regenerate Flatpak inputs from their completed state.
- Any downgrade of `requires-python` to keep runtime 24.08, or an unapproved
  broadening of Python support. That is a project compatibility policy change,
  not packaging work.
- `.agents/flathub-compliance.md` and `.gitignore` — the local ignored guide's
  tracking policy is deliberately not changed here.
- `packaging/flatpak/dnspect-launcher`, desktop file, icon, permissions,
  browser behavior, and system-DNS sandbox policy.
- Flatpak/Flathub submission, tag creation, pushing, publishing, and any
  external repository mutation. This plan prepares verified artifacts only.
- `plans/README.md` and all other plan files.

## Git workflow

- Branch: `advisor/012-flatpak-release-parity`.
- Start only after plan 011 is merged or otherwise present in the working
  tree and `make dependency-audit` passes.
- Use focused conventional commits, for example:
  `build(flatpak): align runtime and generated sources with release`.
- Do not create/push a release tag, publish a Flatpak, open a Flathub PR, or
  edit `plans/README.md` unless the operator explicitly authorizes it.

## Steps

### Step 1: Record the Python-runtime policy and require an immutable source tag

Adopt the recommended policy: preserve the repository's declared Python 3.13+
contract and upgrade the Flatpak platform/SDK/node24 extension branch from
24.08 to 25.08. Confirm the SDK and extension availability with the first two
commands above. Do **not** make an application-specific exception in the
manifest.

Before editing the source pin, obtain from the maintainer the next immutable,
pushed release tag that contains plan 011's final runtime and frontend locks.
Set `RELEASE_TAG` to that approved tag and derive `RELEASE_COMMIT` using:

```bash
RELEASE_TAG='v<maintainer-approved-version>'
RELEASE_COMMIT="$(git rev-parse "${RELEASE_TAG}^{commit}")"
git diff --exit-code "$RELEASE_TAG" -- backend/pyproject.toml frontend/package.json frontend/package-lock.json
git show "$RELEASE_TAG:backend/pyproject.toml" | rg 'requires-python = ">=3.13"|fastapi==0.141.1|starlette==1.6.0|python-multipart==0.0.32'
```

The `git diff` must be empty for those release inputs; it proves the source tag
will contain precisely the dependency state being packaged. The tag can
precede the Flatpak manifest's self-reference update: the external manifest is
allowed to be a follow-up packaging commit that pins the already immutable app
source. Never use the untagged `HEAD`, a branch name, or the old `v1.0.1`
commit. If the maintainer elects Python 3.12 support instead, stop: that
requires a separate approved compatibility migration across the project and
cannot be represented as a one-file runtime change.

**Verify**: `flatpak run --command=python3 org.freedesktop.Sdk//25.08 --version && git cat-file -e "${RELEASE_TAG}^{commit}" && test -n "$RELEASE_COMMIT"` → reports Python 3.13.*, exits 0, and has a non-empty immutable source SHA.

### Step 2: Make the Flatpak runtime and source pin describe that exact release

In `io.github.cortega26.DNSpect.yaml`, change `runtime-version` to `"25.08"`
and keep `runtime`, `sdk`, and `org.freedesktop.Sdk.Extension.node24` on the
same branch. Replace the old `fec297...` source commit with exactly
`$RELEASE_COMMIT`, retaining the Git URL, destination, offline npm source, and
minimal finish arguments.

In the AppStream metainfo, add a top release entry whose version is
`${RELEASE_TAG#v}` and whose date is the approved release date. Retain old
release history. Update each screenshot URL from the old 1.0.1 SHA to
`$RELEASE_COMMIT` only after `git ls-tree -r --name-only "$RELEASE_TAG"`
confirms both referenced screenshot paths exist in that tag. This keeps the
metadata and source image URLs reproducible rather than leaving old commits
behind.

**Verify**: `rg -n 'runtime-version: "25\.08"|Sdk\.Extension\.node24|commit: ' io.github.cortega26.DNSpect.yaml && rg -n "<release version=\"${RELEASE_TAG#v}\"|${RELEASE_COMMIT}" packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml` → manifest shows 25.08/node24 and exactly one source commit; metainfo has the matching new release and screenshot SHA.

### Step 3: Derive all Flatpak Python modules from the remediated runtime dependencies

Replace `packaging/flatpak/requirements.txt` with the exact runtime projection
of the completed `backend/pyproject.toml` dependencies — no `dev`, `geoip`, or
`pack` entries. At the plan 011 baseline it must include:

```text
fastapi==0.141.1
starlette==1.6.0
uvicorn[standard]==0.35.0
pydantic==2.11.7
dnspython==2.7.0
httpx==0.28.1
backports.tarfile==1.2.0
python-multipart==0.0.32
platformdirs==4.4.0
```

Create the `DNSPECT_FLATPAK_TOOL_VENV` temporary virtual environment once for
this step, install the pinned generator in it, and export
`FLATPAK_PIP_GENERATOR` to its executable while invoking the Make target.
Remove that exact `mktemp -d` directory after generation. Add a
`flatpak-python-deps` target to `Makefile` containing the generator command,
with `FLATPAK_PIP_GENERATOR ?= flatpak-pip-generator`, the 25.08 SDK branch,
`requirements.txt`, x86_64/aarch64 wheels, and the output basename. Keep
`flatpak-deps` as the npm-only target; users must be able to regenerate each
generated artifact deliberately.

Use this exact target shape (retain the existing `.PHONY` declarations and
add `flatpak-python-deps` to the appropriate one):

```make
FLATPAK_PIP_GENERATOR ?= flatpak-pip-generator

flatpak-python-deps:
	$(FLATPAK_PIP_GENERATOR) --runtime=org.freedesktop.Sdk//25.08 \
		--requirements-file=packaging/flatpak/requirements.txt \
		--wheel-arches=x86_64,aarch64 \
		--output=packaging/flatpak/python3-requirements
```

Run the bootstrap and target in one shell so the temporary generator path is
available to `make`; the single command in the commands table does this and
removes the temporary directory even when generation fails:

```bash
DNSPECT_FLATPAK_TOOL_VENV="$(mktemp -d)" && \
  python3.13 -m venv "$DNSPECT_FLATPAK_TOOL_VENV" && \
  "$DNSPECT_FLATPAK_TOOL_VENV/bin/pip" install "flatpak-pip-generator==2026.5.28" && \
  FLATPAK_PIP_GENERATOR="$DNSPECT_FLATPAK_TOOL_VENV/bin/flatpak-pip-generator" \
  make flatpak-python-deps
```

Inspect the generated JSON instead of manually changing URLs or hashes. It
must include the final FastAPI/Starlette/multipart/httpx requirements and
their transitive closure, include CPython 3.13 pydantic-core artifacts for
both x86_64 and aarch64 where wheels are used, and contain no `cp312` wheel.
The manifest's application `pip3 install --no-deps` must remain: imports are
the proof that the generated modules supply the closure.

**Verify**: run this exact check:

```bash
python3 - <<'PY'
import json
from pathlib import Path

payload = json.dumps(json.loads(Path('packaging/flatpak/python3-requirements.json').read_text(encoding='utf-8')))
for required in ('fastapi==0.141.1', 'starlette==1.6.0', 'httpx==0.28.1', 'python-multipart==0.0.32'):
    assert required in payload, required
assert 'cp312' not in payload
assert 'cp313' in payload
print('flatpak-python-lock-ok')
PY
```

Expected: prints `flatpak-python-lock-ok`.

### Step 4: Regenerate frontend sources from the audited lock and make stale artifacts detectable

Run `make flatpak-deps` only after plan 011's `frontend/package-lock.json` is
final. It must regenerate `packaging/flatpak/generated-sources.json` from the
audited Vite/Vitest toolchain rather than retain the old package URLs/hashes.

Add an explicit documentation note in `docs/distribution/flathub-readiness.md`
and `Makefile` comments/target names that both generated files are release
inputs: `requirements.txt` → `python3-requirements.json`, and
`frontend/package-lock.json` → `generated-sources.json`. Do not claim either
generated file can be safely hand-edited.

**Verify**: `make flatpak-deps && test -s packaging/flatpak/generated-sources.json && rg -n 'vite-8\.2\.1|vitest-4\.1\.10' packaging/flatpak/generated-sources.json && git diff -- packaging/flatpak/generated-sources.json` → generator exits 0, the file is non-empty, final direct toolchain source URLs are present, and its diff is the generated lock-derived update.

### Step 5: Replace the stale Flathub runbook and validate a native build plus generated multi-architecture inputs

Rewrite only the stale factual portions of `docs/distribution/flathub-readiness.md`:

- describe the selected 25.08/Python 3.13/node24 policy and the final approved
  source tag/commit, not the 1.0.1 baseline;
- state the two generated-input derivations and the pinned generator bootstrap;
- replace all node22 and 24.08 bootstrap commands with 25.08/node24 commands;
- update AppStream release/source references and remove the obsolete absolute
  `/home/carlos/VS_Code_Projects/DNS_app/...` link; and
- distinguish evidence newly produced by this plan from historical validation
  facts rather than copying old `pass` claims forward.

Install the 25.08 SDK, node24 extension, and Flatpak Builder locally if they
are not present. Then run static validation, `make flatpak-validate`, and an
import smoke from the built app directory. Finally run one bounded headless
server smoke in the build directory, poll `/api/health`, and terminate the
process:

```bash
flatpak run org.flatpak.Builder --run build-flatpak/build io.github.cortega26.DNSpect.yaml \
  sh -lc 'DNS_SPEED_LAB_GUI=headless DNS_SPEED_LAB_PORT=18083 DNS_SPEED_LAB_FRONTEND_DIR=/app/share/dnspect/frontend DNS_SPEED_LAB_DATA_DIR=/app/share/dnspect/data dnspect' \
  > build-flatpak/dnspect-headless-smoke.log 2>&1 &
SMOKE_PID=$!
for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:18083/api/health && break
  sleep 1
done
curl -fsS http://127.0.0.1:18083/api/health | rg '"status"[[:space:]]*:[[:space:]]*"ok"'
kill "$SMOKE_PID"
wait "$SMOKE_PID" || true
```

If the health loop never succeeds, print
`build-flatpak/dnspect-headless-smoke.log` and stop rather than changing
permissions, host binding, or launcher behavior.

**Verify**: `desktop-file-validate packaging/flatpak/io.github.cortega26.DNSpect.desktop && appstreamcli validate --no-net packaging/flatpak/io.github.cortega26.DNSpect.metainfo.xml && make flatpak-validate && flatpak build build-flatpak/build python3 -c 'import fastapi, starlette, httpx, dns, multipart, pydantic_core; print("flatpak-python-imports-ok")'` → all validation/build commands exit 0 and the final command prints `flatpak-python-imports-ok`.

## Test plan

- Runtime-policy test: the actual selected Flatpak SDK must report Python 3.13,
  matching `backend/pyproject.toml`; do not infer it from the branch name.
- Source-parity test: the manifest source SHA resolves from an approved release
  tag whose backend and frontend lock inputs match the final plan 011 state.
- Generated-Python test: JSON contains the final direct runtime requirements,
  `httpx`, CPython 3.13 wheel markers, no CPython 3.12 wheels, and imports all
  runtime packages after a clean Flatpak build.
- Generated-npm test: `make flatpak-deps` produces non-empty source JSON
  containing the audited Vite/Vitest artifacts from the final frontend lock.
- Distribution test: desktop, AppStream, manifest/appdir lint, a clean build
  on the executor's native architecture, and a bounded headless health smoke
  all pass without additional sandbox permissions. The generated Python module
  separately contains x86_64 and aarch64-compatible inputs; this is not a
  claim that the local build executed both architectures.

## Done criteria

- [ ] The manifest, SDK, and node24 extension use branch 25.08, and the SDK
  demonstrably runs Python 3.13.*.
- [ ] The manifest pin is an immutable maintainer-approved release-tag SHA that
  contains plan 011's final backend and frontend dependency inputs; it is not
  `HEAD`, v1.0.1, or an unverified branch.
- [ ] `requirements.txt` is a complete exact projection of runtime
  dependencies, including `httpx`; `python3-requirements.json` is regenerated
  from it, has no `cp312` artifacts, and includes x86_64/aarch64-compatible
  CPython 3.13 inputs where platform wheels are used.
- [ ] `generated-sources.json` is regenerated from the final frontend lock.
- [ ] The AppStream release version/date and screenshot source SHA match the
  approved release, while older release entries remain intact.
- [ ] `desktop-file-validate`, AppStream validation, `make flatpak-validate`,
  and the built-app Python import smoke all exit 0 on the executor's native
  architecture.
- [ ] The headless Flatpak health smoke returns `status: ok` and leaves no
  running background process.
- [ ] `docs/distribution/flathub-readiness.md` gives reproducible 25.08/node24
  commands and contains no node22, 24.08, v1.0.1 baseline, or absolute local
  repository link.
- [ ] `git diff --check` exits 0 and `git status --short` lists only in-scope
  files (ignoring `build-flatpak/`); the temporary tool virtual environment is
  removed.
- [ ] `plans/README.md` is unchanged.

## STOP conditions

Stop and report back if:

- Plan 011 is not complete, its lock audits do not pass, or its final runtime
  versions differ from the dependency projection stated here.
- The maintainer does not provide an immutable pushed release tag containing
  the final app dependency inputs. Do not substitute a branch or untagged SHA.
- The maintainer chooses to retain 24.08/Python 3.12 or asks for Python 3.12
  support; that is a cross-project compatibility decision beyond this plan.
- 25.08 with `org.freedesktop.Sdk.Extension.node24` is not available for a
  supported Flatpak architecture, or its SDK does not report Python 3.13.
- The generator cannot create a complete x86_64/aarch64 CPython 3.13 module,
  produces `cp312` artifacts, omits httpx, or requires hand-editing generated
  hashes/URLs to build.
- A release requirement demands executed aarch64 validation but the executor
  has only an x86_64 local Flatpak environment. Record the generated-module
  evidence and request an aarch64 runner/CI validation; do not claim that
  `make flatpak-validate` cross-built or executed the other architecture.
- The source tag lacks a referenced screenshot, the Flatpak build fails twice,
  or the built app cannot import the required Python modules.
- The only way to pass the smoke is to add filesystem/D-Bus permissions,
  change localhost binding, or modify the launcher/application behavior.

## Maintenance notes

- Whenever a runtime dependency or frontend lock changes, regenerate the
  corresponding Flatpak JSON in the same release-preparation cycle and review
  its diff as generated supply-chain data.
- Keep Python runtime policy explicit: moving to a future Flatpak branch must
  first prove its SDK Python version still satisfies `requires-python`.
- The ignored `.agents` compliance note remains a known local-documentation
  limitation. Do not mistake it for a committed release contract; the tracked
  manifest and runbook are the reviewable evidence produced by this plan.
