#!/usr/bin/env python3
"""Run flatpak-builder-lint over a builddir or an OSTree repo.

Flathub runs both checks on every build (`manifest` and `repo` are automated
against all builds; `builddir` and `repo` are what the submission guide asks you
to run locally), so this covers both artifact types. It tolerates only
pre-submission errors.

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
    # Both of these are never granted as exceptions, and neither needs one: they
    # appear only because a local build does not mirror media. Flathub passes
    # --compose-url-policy=full --mirror-screenshots-url=https://dl.flathub.org/media
    # itself and commits the screenshots/<arch> ref, after which both clear. The
    # metainfo points at permanent raw.githubusercontent.com URLs pinned to a
    # commit, which is the recommended source.
    "appstream-external-screenshot-url",
    "appstream-screenshots-not-mirrored-in-ostree",
}


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] not in {"builddir", "repo"}:
        print(f"usage: {Path(__file__).name} (builddir|repo) PATH", file=sys.stderr)
        return 2
    kind = args[0]
    paths = [Path(value).resolve() for value in args[1:]]
    missing = [path for path in paths if not path.is_dir()]
    if not paths or missing:
        for path in missing:
            print(f"flatpak {kind} lint: {path} is not a directory", file=sys.stderr)
        return 2

    result = subprocess.run(
        [*linter_command(), kind, *(str(path) for path in paths)],
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
        print(f"\nflatpak {kind} lint: FAIL", file=sys.stderr)
        for code in blocking:
            print(f"  FAIL  {code}", file=sys.stderr)
        for line in report.get("info") or []:
            if any(code in line for code in blocking):
                print(f"    {line}", file=sys.stderr)
        return 1

    print(f"flatpak {kind} lint: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
