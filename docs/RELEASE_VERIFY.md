# Release Artifact Verification

DNSpect release assets include platform executables plus a `checksums.txt` file with SHA256 hashes.
Current release channel publishes macOS as arm64-only.

Expected artifact names:

- `dnspect-linux-x64`
- `dnspect-windows-x64.exe`
- `dnspect-macos-arm64`
- `checksums.txt`
- `checksums.txt.sig` (optional, if signing is enabled)

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

Run the executable and open `http://127.0.0.1:8000`.
