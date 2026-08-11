# Plan 013: Verify Python 3.13 and the packaged Windows executable before release

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A coordinating reviewer maintains
> `plans/README.md` for this planning batch, so do **not** edit that file.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- scripts/dev.ps1 scripts/smoke_test.ps1 scripts/smoke_packaged_windows.ps1 .github/workflows/ci.yml .github/workflows/release.yml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/011-dependency-security-remediation.md`
- **Category**: dx, tests, migration
- **Planned at**: commit `e09fd2d`, 2026-08-10
- **Merged**: `45ba4fb`, 2026-08-11

## Why this matters

DNSpect declares Python 3.13+ and its release workflow builds a Windows x64
asset with Python 3.13, but the two Windows entry scripts create a 3.11 virtual
environment whenever the Python launcher is present. The release matrix also
publishes the Windows executable without exercising it; Linux and macOS alone
receive packaged smoke coverage. This leaves both contributor setup and a
published Windows binary vulnerable to regressions that the repository's
current checks cannot detect.

## Current state

- `scripts/dev.ps1` — Windows full-stack development entry point; creates and
  activates `backend/.venv` before launching Uvicorn and Vite.
- `scripts/smoke_test.ps1` — Windows source smoke; starts Uvicorn, checks
  health, runs a small benchmark, and checks both export formats.
- `scripts/smoke_packaged_linux.sh` — established executable-smoke structure
  to mirror for Windows, including bounded health polling and cleanup.
- `scripts/package_backend.py` — PyInstaller packaging contract and Windows
  executable name; read it but do not change it in this plan.
- `.github/workflows/ci.yml` — validates a packaged Linux executable only.
- `.github/workflows/release.yml` — builds/publishes a Windows executable but
  only invokes package smoke scripts for Linux and macOS.

The development and source-smoke scripts hard-code the wrong interpreter:

```powershell
# scripts/dev.ps1:9-23
Set-Location "$root\backend"
if (-not (Test-Path ".venv")) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    py -3.11 -m venv .venv
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    python -m venv .venv
  }
}
.\.venv\Scripts\Activate.ps1
python -m pip install -c constraints.txt -e .[dev]

# scripts/smoke_test.ps1:7-22
if (-not (Test-Path ".venv")) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    py -3.11 -m venv .venv
  }
}
```

This conflicts with the authoritative project declaration:

```toml
# backend/pyproject.toml:9
requires-python = ">=3.13"
```

The release matrix correctly targets Python 3.13 and publishes the expected
Windows asset, but has no Windows smoke step:

```yaml
# .github/workflows/release.yml:19-34,63-85,109-119
- os: windows-latest
  source_binary: dnspect-windows.exe
  asset_name: dnspect-windows-x64.exe
...
python-version: "3.13"
...
- name: Smoke test Linux packaged artifact
  if: ${{ matrix.asset_name == 'dnspect-linux-x64' }}
- name: Smoke test macOS arm64 packaged artifact
  if: ${{ matrix.asset_name == 'dnspect-macos-arm64' }}
```

`scripts/package_backend.py:26-32,61-65` defines the stable Windows output:
`dist/dnspect-windows.exe`. The release rename step copies it to
`release-assets/dnspect-windows-x64.exe`. The existing Linux packaged smoke
sets `DNS_SPEED_LAB_GUI=headless`, polls `/api/health` with a timeout, checks
startup output, and always kills its child (`scripts/smoke_packaged_linux.sh:42-123`).
The Windows equivalent must preserve those safety properties and additionally
verify that the bundled root page responds, without relying on a GUI or a live
external DNS benchmark.

Existing conventions to retain:

- Source smoke uses one short live benchmark and validates CSV/JSON export
  (`scripts/smoke_test.ps1:31-58`). Keep it as a source-level smoke, separate
  from the deterministic packaged-app health/UI smoke.
- CI's packaged Linux job builds the frontend, installs `.[pack]` under
  constraints, verifies `backports.tarfile`, packages, renames, then smokes
  (`.github/workflows/ci.yml:105-152`). Mirror that sequence on Windows.
- Release assets and checksums use the exact name
  `dnspect-windows-x64.exe` (`.github/workflows/release.yml:25-29,197-205`);
  do not rename or zip the published executable in this plan.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Parse all Windows scripts without executing them | `pwsh -NoProfile -Command '$ErrorActionPreference="Stop"; "scripts/dev.ps1", "scripts/smoke_test.ps1", "scripts/smoke_packaged_windows.ps1" \| ForEach-Object { [scriptblock]::Create((Get-Content -Raw $_)) \| Out-Null }; "powershell-parse-ok"'` | prints `powershell-parse-ok` |
| Verify development venv version | `pwsh -NoProfile -Command '& .\backend\.venv\Scripts\python.exe -c "import sys; assert sys.version_info >= (3, 13), sys.version; print(sys.version)"'` | exit 0; prints Python 3.13.* or newer |
| Source Windows smoke | `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke_test.ps1` | exit 0; prints `Smoke test OK (benchmark_id=...)` |
| Build a Windows package | `npm --prefix frontend ci; npm --prefix frontend run build; py -3.13 -m pip install -c backend/constraints.txt -e ".\backend[pack]"; py -3.13 scripts/package_backend.py` | exit 0; `dist\dnspect-windows.exe` exists |
| Packaged Windows smoke | `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke_packaged_windows.ps1 -BinaryPath .\release-assets\dnspect-windows-x64.exe` | exit 0; prints `Packaged Windows artifact smoke test OK` |
| Backend compatibility gate on Windows | `pwsh -NoProfile -Command '$ErrorActionPreference="Stop"; Push-Location backend; try { & .\.venv\Scripts\python.exe -m ruff check .; if ($LASTEXITCODE) { exit $LASTEXITCODE }; & .\.venv\Scripts\python.exe -m ruff format --check .; if ($LASTEXITCODE) { exit $LASTEXITCODE }; & .\.venv\Scripts\python.exe -m mypy; if ($LASTEXITCODE) { exit $LASTEXITCODE }; & .\.venv\Scripts\python.exe -m bandit -q -c pyproject.toml -r app; if ($LASTEXITCODE) { exit $LASTEXITCODE }; & .\.venv\Scripts\python.exe -m pytest -q; exit $LASTEXITCODE } finally { Pop-Location }'` | exit 0 under Python 3.13 |
| Workflow/scope review | `git diff --check && git status --short` | no whitespace errors; only in-scope files changed |

## Scope

**In scope** (the only files you should modify):

- `scripts/dev.ps1`
- `scripts/smoke_test.ps1`
- `scripts/smoke_packaged_windows.ps1` (new)
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

**Out of scope**:

- `backend/pyproject.toml`, `backend/constraints.txt`, and dependency versions
  — plan 011 owns the Python 3.13 dependency baseline.
- `scripts/package_backend.py`, asset naming, checksum generation, signing,
  and release upload behavior. Consume its current Windows artifact contract.
- Linux/macOS smoke scripts; they are the structural pattern, not targets.
- README, troubleshooting, and release-verification documentation — plan 016
  updates documented Windows support after this coverage exists.
- GUI/browser automation, actual DNS-provider result assertions, and network
  protocol changes. The packaged smoke must remain a local headless process
  check, so CI does not depend on resolver availability.
- `plans/README.md` and all other plan files.

## Git workflow

- Branch: `advisor/013-windows-release-verification`.
- Start after plan 011's constraints lock and dependency-audit workflow are
  available, because this plan packages that exact Python 3.13 environment.
- Use conventional commits, for example:
  `fix(windows): create Python 3.13 virtual environments` and
  `test(release): smoke packaged Windows artifact`.
- Do not push, tag, publish a release, or edit `plans/README.md` unless the
  operator explicitly asks.

## Steps

### Step 1: Make both PowerShell entry points select and enforce Python 3.13

In both `scripts/dev.ps1` and `scripts/smoke_test.ps1`, replace
`py -3.11 -m venv .venv` with `py -3.13 -m venv .venv`. Preserve the fallback
to `python -m venv`, but before accepting it execute a version check that
requires `sys.version_info >= (3, 13)` and throws an actionable Spanish error
when it is older.

Also validate an existing `backend/.venv` through its own
`Scripts\python.exe`, not whichever `python` happens to be on `PATH`. If it is
older than 3.13, fail before installing packages and tell the operator to
remove/recreate that local venv with Python 3.13. Do not automatically delete
or overwrite an existing `.venv`. Keep `$ErrorActionPreference = "Stop"`, the
existing host/port environment support, and the `try/finally` process cleanup.

**Verify**: on a Windows host with `py`, remove only a disposable test venv,
run `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke_test.ps1`,
then run `& .\backend\.venv\Scripts\python.exe -c "import sys; assert sys.version_info[:2] >= (3,13); print('python313-ok')"` → source smoke passes and prints `python313-ok`.

### Step 2: Add a bounded, headless packaged-Windows smoke script

Create `scripts/smoke_packaged_windows.ps1` with a positional
`-BinaryPath` parameter defaulting to
`release-assets\dnspect-windows-x64.exe`, plus optional startup timeout and
port parameters. Model cleanup and failure diagnostics on
`scripts/smoke_packaged_linux.sh`, using native PowerShell primitives:

1. Resolve and require an existing `.exe`; create distinct temporary stdout
   and stderr log paths under `$env:TEMP`.
2. Save and temporarily set `DNS_SPEED_LAB_GUI=headless`,
   `DNS_SPEED_LAB_HOST=127.0.0.1`, and a non-default port; launch the executable
   with `Start-Process -PassThru -RedirectStandardOutput ...
   -RedirectStandardError ...`.
3. Poll `http://127.0.0.1:<port>/api/health` with `Invoke-RestMethod` until it
   returns `status = "ok"`, while failing early if the child exits and printing
   both logs. Bound the loop by the supplied timeout.
4. Request `/` with `Invoke-WebRequest` and require HTTP 200 plus HTML content.
   This proves the PyInstaller data bundle contains the built frontend rather
   than merely that Uvicorn imported.
5. Require the packaged startup log to contain the existing
   `DNSpect server running on http://` message from `backend/app/cli.py:101-109`.
   In one `finally` block, stop/wait the child if needed, restore each prior
   environment value, and remove only the two generated temporary logs.

Do not try `--help` as a success shortcut and do not run a live benchmark in
this packaged smoke. A locally healthy, headless server and bundled root page
are the deterministic release checks required here.

**Verify**: after building and copying the executable to `release-assets`, run `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke_packaged_windows.ps1 -BinaryPath .\release-assets\dnspect-windows-x64.exe -Port 18081` → prints `Packaged Windows artifact smoke test OK`; no process remains bound to port 18081.

### Step 3: Add a Windows packaged-artifact job to pull-request CI

In `.github/workflows/ci.yml`, add `packaged-windows-smoke` alongside the
existing `packaged-linux-smoke` job. It must run on `windows-latest` and use
the following order:

1. checkout;
2. setup Node 24 x64 and run `npm ci` then `npm run build` in `frontend`;
3. setup Python 3.13 x64 with the same backend lock cache paths as the Linux
   packaged job;
4. install `-c backend/constraints.txt -e ".\\backend[pack]"`, verify
   `import backports, backports.tarfile`, and run `python scripts/package_backend.py`;
5. copy `dist\dnspect-windows.exe` to
   `release-assets\dnspect-windows-x64.exe`; and
6. invoke the new script with `shell: pwsh` and that exact asset path.

Use `shell: pwsh` for Windows-specific copy and smoke commands. Keep Python
and Node setup action versions, cache keys, and the existing Linux job intact.

**Verify**: `rg -n 'packaged-windows-smoke|windows-latest|dnspect-windows-x64\.exe|smoke_packaged_windows\.ps1|python-version: "3\.13"' .github/workflows/ci.yml` → each required token is present in the new Windows job; a pull request run shows `packaged-windows-smoke` green.

### Step 4: Smoke the Windows asset in the tagged release matrix before upload

In `.github/workflows/release.yml`, immediately after the generic rename step,
add a Windows-only smoke step guarded by
`matrix.asset_name == 'dnspect-windows-x64.exe'`. Use `shell: pwsh` and invoke:

```powershell
.\scripts\smoke_packaged_windows.ps1 -BinaryPath "release-assets\${{ matrix.asset_name }}"
```

It must occur before `Upload executable artifact`, so a failure prevents the
asset from reaching the release assembly/publish jobs. Do not alter the
existing Linux/macOS smoke guards, release matrix values, checksum list, or
publish file list.

**Verify**: `rg -n "Smoke test Windows packaged artifact|matrix\.asset_name == 'dnspect-windows-x64\.exe'|shell: pwsh|smoke_packaged_windows\.ps1|Upload executable artifact" .github/workflows/release.yml` → the Windows smoke step appears before the upload step and has the exact asset guard.

### Step 5: Run local Windows checks and inspect the release boundary

On Windows, run the source smoke from a clean Python 3.13 venv, package the
frontend/backend, copy the expected executable, and run the new packaged
smoke. Run the direct PowerShell backend-quality command from the commands
table in the same Python 3.13 environment; do not assume GNU Make is installed
on a contributor's Windows machine. Review the workflow diff to ensure the new
release step is a gate, not a post-upload diagnostic, and that neither workflow
uses `py -3.11`.

**Verify**: `pwsh -NoProfile -Command 'rg -n "py -3\.11" scripts/*.ps1; if ($LASTEXITCODE -eq 1) { "no-py311-selectors"; exit 0 }; exit $LASTEXITCODE' && git diff --check` → prints `no-py311-selectors`; no whitespace error is reported.

## Test plan

- Virtual-environment selection: fresh Windows venvs use `py -3.13`; a fallback
  interpreter or pre-existing venv below 3.13 fails explicitly before install.
- Source smoke: health, small benchmark completion, CSV, and JSON export retain
  the current `scripts/smoke_test.ps1` behavior under Python 3.13.
- Packaged smoke: missing binary, early exit, startup timeout, unhealthy
  response, missing bundled HTML, missing startup log, and successful health
  route are all handled without leaving a child process or temp logs behind.
- CI/release wiring: Windows packaging uses the existing output/asset names;
  PR CI runs a Windows smoke and tagged release runs it before upload.
- Compatibility: Ruff, format check, mypy, Bandit, and pytest pass through the
  direct PowerShell command under the same Python 3.13 baseline installed by
  release packaging.

## Done criteria

- [ ] Neither PowerShell entry script selects Python 3.11; a new or existing
  venv is verified as Python 3.13+ before dependency installation.
- [ ] An old existing venv fails with an actionable recreate instruction and is
  never automatically deleted.
- [ ] `scripts/smoke_packaged_windows.ps1` validates a headless packaged .exe,
  health JSON, root HTML, and startup log with bounded polling and guaranteed
  child/env/temp-file cleanup.
- [ ] A local Windows package produces `dist\dnspect-windows.exe`, copies to
  `release-assets\dnspect-windows-x64.exe`, and passes the new smoke script.
- [ ] CI has a green `packaged-windows-smoke` job on `windows-latest` using
  Python 3.13 and Node 24.
- [ ] Release smoke for `dnspect-windows-x64.exe` runs before artifact upload;
  Linux/macOS smoke and published asset/checksum names are unchanged.
- [ ] The direct PowerShell backend quality gate and source Windows smoke exit
  0 under Python 3.13.
- [ ] `git diff --check` exits 0 and `git status --short` lists only in-scope
  files.
- [ ] `plans/README.md` is unchanged.

## STOP conditions

Stop and report back if:

- Python 3.13 is unavailable through both `py -3.13` and the fallback
  `python`, or the Windows GitHub runner cannot provision it. Do not weaken
  `requires-python` or restore 3.11 just to make scripts run.
- An existing venv must be deleted or a machine-wide Python installation must
  be changed automatically to proceed; report the required manual action.
- `scripts/package_backend.py` no longer creates
  `dist\dnspect-windows.exe`, or the release matrix uses a different Windows
  asset contract. Update this plan rather than guessing at renamed files.
- The packaged process cannot pass health/root smoke without GUI automation,
  an external DNS benchmark, a changed host binding, or a different sandbox
  policy.
- Windows CI/release needs an artifact-name, checksum, signing, or publishing
  behavior change outside the defined scope.
- Any source, packaged, or full backend gate fails twice after a reasonable
  in-scope correction.

## Maintenance notes

- Keep the PowerShell venv validation synchronized with
  `backend/pyproject.toml` whenever the declared Python floor changes; do not
  leave a selector hard-coded to an older migration baseline.
- Treat the Windows package smoke as a release contract: it must remain
  headless, bounded, and independent of public resolver availability.
- Plan 016 should update user-facing Windows/release verification documentation
  only after the workflow names and evidence in this plan are merged.
