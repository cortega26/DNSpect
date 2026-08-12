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


def main() -> int:
    if not INDEX.exists():
        print(f"error: {INDEX.relative_to(ROOT)} not found", file=sys.stderr)
        return 1

    index = INDEX.read_text(encoding="utf-8")
    lines: list[str] = []
    moved: list[str] = []
    skipped: list[str] = []

    for line in index.splitlines():
        match = ROW_PATTERN.match(line)
        if not match:
            lines.append(line)
            continue
        target = match.group(1)
        if target.startswith("archive/"):
            skipped.append(target)
            lines.append(line)
            continue
        source = PLANS_DIR / target
        if not source.is_file():
            print(f"warning: {target} listed Complete but missing", file=sys.stderr)
            lines.append(line)
            continue
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        destination = ARCHIVE_DIR / target
        if destination.exists():
            print(f"warning: {destination.relative_to(ROOT)} already exists", file=sys.stderr)
            lines.append(line)
            continue
        import subprocess

        subprocess.run(["git", "mv", str(source), str(destination)], check=True)
        # Rewrite only this row's own link. A global count=1 rewrite over the
        # whole index would corrupt the first archive-eligible link in the
        # file instead of the moved row's (the bug that mislinked 028/030).
        line = line.replace(f"]({target})", f"](archive/{target})", 1)
        lines.append(line)
        moved.append(target)

    if moved:
        # The input file is newline-terminated; splitlines() drops that
        # final newline, so re-add it when writing back.
        INDEX.write_text("\n".join(lines) + "\n", encoding="utf-8")

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
