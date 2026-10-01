#!/usr/bin/env python3
"""Run flatpak-builder-lint over a build dir, tolerating only pre-submission errors.

`flatpak-builder-lint --exceptions` skips errors that Flathub has registered as
exceptions *for this app-id*, and those are only granted after the app is
submitted. DNSpect is not on Flathub yet, so `--exceptions` cannot suppress the
screenshot-mirroring error and `make flatpak-validate` fails for a reason that
is not a defect.

This wrapper keeps the project's rule that real errors are never suppressed: it
drops exactly the codes in ALLOWED_PRE_SUBMISSION and fails on everything else.
Once the app is submitted and the exception is granted, remove the entry here.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


def linter_command() -> list[str]:
    """The linter as a full command line.

    FLATPAK_BUILDER_LINT may be a bare binary or a wrapper command line (the
    flatpak-builder-lint in org.flatpak.Builder is only reachable as
    `flatpak run ... --command=flatpak-builder-lint ...`, which is several
    tokens), so split it rather than treating it as one executable.
    """
    return shlex.split(os.environ.get("FLATPAK_BUILDER_LINT", "flatpak-builder-lint"))


ALLOWED_PRE_SUBMISSION = {
    # Flathub mirrors externally hosted screenshots to dl.flathub.org *after*
    # submission. The metainfo points at permanent raw.githubusercontent.com URLs
    # pinned to a commit, which is the recommended source, so the error is an
    # artefact of validating before the app is submitted.
    "appstream-external-screenshot-url",
}


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {Path(__file__).name} BUILDDIR", file=sys.stderr)
        return 2

    builddir = Path(sys.argv[1]).resolve()
    if not builddir.is_dir():
        print(f"flatpak builddir lint: {builddir} is not a directory", file=sys.stderr)
        return 2

    result = subprocess.run(
        [*linter_command(), "builddir", str(builddir)],
        capture_output=True,
        text=True,
        check=False,
    )

    raw = (result.stdout or "").strip()
    try:
        report = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        print(
            "flatpak builddir lint: could not parse the linter output", file=sys.stderr
        )
        return 2

    errors = report.get("errors") or []
    if isinstance(errors, dict):  # linter has used a mapping in the past
        errors = sorted(errors)

    tolerated = sorted(set(errors) & ALLOWED_PRE_SUBMISSION)
    blocking = sorted(set(errors) - ALLOWED_PRE_SUBMISSION)

    for code in tolerated:
        print(f"  tolerated pre-submission: {code}")
    for line in report.get("info") or []:
        if any(code in line for code in tolerated):
            print(f"    {line}")

    if blocking:
        print("\nflatpak builddir lint: FAIL", file=sys.stderr)
        for code in blocking:
            print(f"  FAIL  {code}", file=sys.stderr)
        for line in report.get("info") or []:
            if any(code in line for code in blocking):
                print(f"    {line}", file=sys.stderr)
        return 1

    print("flatpak builddir lint: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
