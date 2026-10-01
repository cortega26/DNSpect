#!/usr/bin/env python3
"""Emit the pinned runtime dependency closure for the Flatpak python module.

`packaging/flatpak/requirements.txt` lists only DNSpect's direct runtime
dependencies, so `flatpak-pip-generator` resolves the transitive closure on its
own and silently floats to the newest release on PyPI. That is how the flatpak
python sources drifted away from `backend/constraints.txt`: the regenerated
manifest carried `anyio 4.15.1` and `watchfiles 1.3.0` while the backend is
pinned to `4.13.0` and `1.1.1`.

This script walks the "# via" annotations that pip-compile writes into
constraints.txt, starting from the direct pins, and writes a fully pinned
requirements file so the generator cannot float anything.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parents[1]
CONSTRAINTS = ROOT / "backend" / "constraints.txt"
DIRECT = ROOT / "packaging" / "flatpak" / "requirements.txt"

PIN_RE = re.compile(r"^(?P<name>[A-Za-z0-9._-]+)==(?P<version>[^\s;]+)")
# A dependent is a bare distribution name: no parentheses, slashes or dots that
# would indicate an annotation such as "(pyproject.toml)".
DEPENDENT_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


def canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name.strip().lower())


# DNSpect itself appears as a dependent in every "# via dnspect-backend" line and
# is never part of the runtime closure.
PROJECT_NAME = canonical(
    tomllib.loads((ROOT / "backend" / "pyproject.toml").read_text())["project"]["name"]
)


def parse_constraints() -> tuple[dict[str, str], dict[str, set[str]]]:
    """Return (name -> pin, name -> set of packages that name requires).

    pip-compile writes each pin with a "# via" block naming its dependents, so the
    annotation is inverted relative to a dependency graph: the block under
    `click` lists what clicks on `click`. The returned map records the forward
    direction (`click` requires `black`, `uvicorn`) so a closure walk can follow
    dependencies from the direct pins.
    """
    pins: dict[str, str] = {}
    required_by: dict[str, set[str]] = {}

    name: str | None = None
    for raw in CONSTRAINTS.read_text().splitlines():
        if not raw.strip():
            name = None
            continue

        pin = PIN_RE.match(raw)
        if pin and not raw[0].isspace():
            name = canonical(pin.group("name"))
            pins[name] = pin.group("version")
            required_by.setdefault(name, set())
            continue

        if not raw.startswith((" ", "\t")):
            name = None
            continue

        stripped = raw.strip().lstrip("#").strip()
        if not stripped or PIN_RE.match(stripped):
            # The header block or a bare pin reference, not a dependent list.
            continue
        if name is None:
            continue
        if stripped == "via":
            # A "# via" header whose dependent list follows on later lines.
            continue
        stripped = stripped.removeprefix("via ")
        for dependent in stripped.split():
            # Drop provenance annotations such as "(pyproject.toml)" and the
            # project itself ("dnspect-backend"), which is never a dependency.
            if not DEPENDENT_RE.fullmatch(dependent):
                continue
            key = canonical(dependent)
            if key == PROJECT_NAME:
                continue
            required_by.setdefault(name, set()).add(key)

    return pins, required_by


def main() -> int:
    pins, required_by = parse_constraints()

    direct: list[str] = []
    for raw in DIRECT.read_text().splitlines():
        token = raw.split("#", 1)[0].strip()
        if not token:
            continue
        direct.append(token.split("[", 1)[0].split("==", 1)[0].strip())

    # Invert the dependent map pip-compile gives us into a forward dependency
    # graph: package -> the packages it requires.
    requires: dict[str, set[str]] = {}
    for package, dependents in required_by.items():
        for dependent in dependents:
            requires.setdefault(dependent, set()).add(package)

    closure: set[str] = set()
    queue = [canonical(name) for name in direct]
    while queue:
        current = queue.pop()
        if current in closure:
            continue
        closure.add(current)
        queue.extend(requires.get(current, set()))

    missing = sorted(name for name in closure if name not in pins)
    if missing:
        print(
            "flatpak closure fail: not pinned in backend/constraints.txt: "
            + ", ".join(missing),
            file=sys.stderr,
        )
        return 1

    lines = [f"{name}=={pins[name]}" for name in sorted(closure)]
    sys.stdout.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
