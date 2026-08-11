#!/usr/bin/env python3
"""Move plans marked Complete in plans/README.md to plans/archive/.

The rule: the moment the reviewer marks a plan row **Complete** in
plans/README.md, this script must be run so the plan file lives in
plans/archive/ and the index link points there. It is idempotent: rows
already pointing at archive/ and files already archived are skipped.

Archived plans are immutable historical records; their internal prose
is never rewritten.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLANS_DIR = ROOT / "plans"
ARCHIVE_DIR = PLANS_DIR / "archive"
INDEX = PLANS_DIR / "README.md"

ROW_PATTERN = re.compile(r"^\| \[[^]]+\]\(([^)]+)\) \|.*\*\*Complete\*\*.*\|$")
LINK_PATTERN = re.compile(r"\]\(([0-9]{3}-[^)]+\.md)\)")


def main() -> int:
    if not INDEX.exists():
        print(f"error: {INDEX.relative_to(ROOT)} not found", file=sys.stderr)
        return 1

    index = INDEX.read_text(encoding="utf-8")
    moved: list[str] = []
    skipped: list[str] = []

    for row in index.splitlines():
        match = ROW_PATTERN.match(row)
        if not match:
            continue
        target = match.group(1)
        if target.startswith("archive/"):
            skipped.append(target)
            continue
        source = PLANS_DIR / target
        if not source.is_file():
            print(f"warning: {target} listed Complete but missing", file=sys.stderr)
            continue
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        destination = ARCHIVE_DIR / target
        if destination.exists():
            print(f"warning: {destination.relative_to(ROOT)} already exists", file=sys.stderr)
            continue
        import subprocess

        subprocess.run(["git", "mv", str(source), str(destination)], check=True)
        index = LINK_PATTERN.sub(r"](archive/\1)", index, count=1)
        moved.append(target)

    INDEX.write_text(index, encoding="utf-8")

    if moved:
        print(f"archived {len(moved)} plan(s):")
        for name in moved:
            print(f"  plans/archive/{name}")
    else:
        print("no plans to archive")
    if skipped:
        print(f"already archived: {len(skipped)} plan(s)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
