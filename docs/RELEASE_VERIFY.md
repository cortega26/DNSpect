# Release Artifact Verification

DNSpect release assets include platform executables plus a `checksums.txt` file with SHA256 hashes.

Expected artifact names:

- `dnspect-linux-x64`
- `dnspect-windows-x64.exe`
- `dnspect-macos-x64`
- `dnspect-macos-arm64`
- `checksums.txt`
- `checksums.txt.sig` (optional, if signing is enabled)

## 1) Download assets

1. Open the target release in GitHub Releases.
2. Download your executable plus `checksums.txt`.
3. If available, also download `checksums.txt.sig`.

## 2) Verify SHA256

### Linux

```bash
sha256sum --check checksums.txt
```

Or verify only one file:

```bash
sha256sum dnspect-linux-x64
```

### macOS

```bash
shasum -a 256 dnspect-macos-arm64
shasum -a 256 dnspect-macos-x64
```

Compare output against entries in `checksums.txt`.

### Windows (PowerShell)

```powershell
Get-FileHash .\dnspect-windows-x64.exe -Algorithm SHA256
```

Compare `Hash` value with `checksums.txt`.

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

## 4) Runtime sanity check

Run the executable and open:

- `http://127.0.0.1:8000`

Optional runtime environment variables:

- `DNS_SPEED_LAB_HOST`
- `DNS_SPEED_LAB_PORT`
- `DNS_SPEED_LAB_OPEN_BROWSER`
