# Release Artifact Verification

DNSpect release assets include platform executables plus a `checksums.txt` file with SHA256 hashes.
The release matrix publishes three assets: Linux x64, Windows x64, and macOS arm64 (macOS is published on the arm64 channel only).

Expected artifact names:

- `dnspect-linux-x64`
- `dnspect-windows-x64.exe`
- `dnspect-macos-arm64`
- `checksums.txt`
- `checksums.txt.sig` (optional, only if signing is enabled)

## 1) Download assets

1. Open the target release in GitHub Releases.
2. Download your executable plus `checksums.txt`.
3. If available, also download `checksums.txt.sig`.

## 2) Verify SHA256

### Linux (or macOS)

```bash
shasum -a 256 -c checksums.txt
```

Or verify one file directly:

```bash
shasum -a 256 dnspect-linux-x64
```

### macOS

```bash
shasum -a 256 dnspect-macos-arm64
```

Compare output against entries in `checksums.txt`.

### Windows (Command Prompt / PowerShell)

```powershell
CertUtil -hashfile .\dnspect-windows-x64.exe SHA256
```

Compare the printed SHA256 value against the matching line in `checksums.txt`.

## 3) Verify GPG signature (optional)

Only applicable when `checksums.txt.sig` is present.

1. Import the maintainer public key:

```bash
gpg --import maintainer-public-key.asc
```

2. Verify the signature:

```bash
gpg --verify checksums.txt.sig checksums.txt
```

Expected result: valid signature from the trusted maintainer key.

## 4) macOS Gatekeeper note

Unsigned/notarized-open-source binaries can trigger Gatekeeper warnings on first launch.

If this happens, use Finder -> right click the binary -> Open, then confirm.

## 5) Runtime sanity check

The DNSpect binary starts a local web server when launched.

1. Run the executable.
2. Open `http://127.0.0.1:8000` in your browser.
3. Verify health endpoint:

```bash
curl -sS http://127.0.0.1:8000/api/health
```

Expected: HTTP 200 with a healthy status payload.

4. Verify the root route serves the frontend HTML:

```bash
curl -sS http://127.0.0.1:8000/ | head -5
```

Expected: the built frontend `index.html` document.

## 6) Packaged Windows smoke

Before uploading the Windows asset, run the packaged-artifact smoke:

```powershell
pwsh ./scripts/smoke_packaged_windows.ps1 -BinaryPath release-assets/dnspect-windows-x64.exe
```

Expected: the script starts the packaged binary, checks the health endpoint,
and exits 0. See `docs/RELEASE_CHECKLIST.md` for the full pre-upload sequence.
