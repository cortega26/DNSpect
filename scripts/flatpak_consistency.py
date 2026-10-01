#!/usr/bin/env python3
"""Fail-fast consistency gate for the Flatpak submission.

Every check here corresponds to a defect that reached a release because
RELEASE_CHECKLIST section 6 relied on a human remembering to re-run the
dependency generators. The gate is pure-stdlib and offline: it reads the
manifest, the generated dependency manifests, the metainfo and the git tree,
and exits non-zero on any drift.

Checks
------
1. version contract      backend/pyproject.toml == backend/app/__init__.py ==
                         frontend/package.json
2. manifest pin          the git source commit equals `git rev-parse v<version>`
3. app id parity         manifest app-id == metainfo <id> == desktop/metainfo/
                         icon filenames
4. metainfo releases     the highest <release> version equals the version contract
5. node sources          every package pinned by the frontend lockfile *at the
                         pinned commit* is present in generated-sources.json at the
                         same version (offline `npm install` depends on this)
6. python sources        every distribution pinned in
                         packaging/flatpak/requirements.txt has a module in
                         python3-requirements.json
7. asset parity          the manifest installs the desktop file, metainfo, icon
                         and LICENSE under /app
"""

from __future__ import annotations

import io
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
MANIFEST = ROOT / "io.github.cortega26.DNSpect.yaml"
METAINFO = ROOT / "packaging" / "flatpak" / "io.github.cortega26.DNSpect.metainfo.xml"
NODE_SOURCES = ROOT / "packaging" / "flatpak" / "generated-sources.json"
PY_SOURCES = ROOT / "packaging" / "flatpak" / "python3-requirements.json"
FLATPAK_REQUIREMENTS = ROOT / "packaging" / "flatpak" / "requirements.txt"
LOCKFILE_REL = "frontend/package-lock.json"

# npm tarball URLs look like .../<name>/-/<basename>-<version>.tgz. Scoped names
# keep their slash, so capture the name up to the /-/ separator.
NPM_TARBALL_RE = re.compile(
    r"^https://registry\.npmjs\.org/(?P<name>.+)/-/[^/]+?-(?P<version>\d[0-9A-Za-z.+-]*)\.tgz$"
)


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def fail(self, check: str, detail: str) -> None:
        self.errors.append(f"{check}: {detail}")

    def note(self, message: str) -> None:
        self.notes.append(message)


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def version_contract() -> str:
    pyproject = tomllib.loads((ROOT / "backend" / "pyproject.toml").read_text())
    backend_init = (ROOT / "backend" / "app" / "__init__.py").read_text().split('"')[1]
    package_json = json.loads((ROOT / "frontend" / "package.json").read_text())
    versions = {
        pyproject["project"]["version"],
        backend_init,
        package_json["version"],
    }
    if len(versions) != 1:
        raise SystemExit(f"version contract broken: {sorted(versions)}")
    return versions.pop()


def manifest_app_id(text: str) -> str:
    match = re.search(r"^app-id:\s*(\S+)\s*$", text, re.MULTILINE)
    if not match:
        raise SystemExit("manifest has no app-id")
    return match.group(1)


def manifest_commit(text: str) -> str | None:
    match = re.search(r"^\s+commit:\s*(\S+)\s*$", text, re.MULTILINE)
    return match.group(1) if match else None


def node_package_versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    for entry in json.loads(NODE_SOURCES.read_text()):
        if not isinstance(entry, dict) or entry.get("type") != "file":
            continue
        match = NPM_TARBALL_RE.match(entry.get("url", ""))
        if match:
            versions.setdefault(match.group("name"), set()).add(match.group("version"))
    return {name: sorted(found) for name, found in versions.items()}


def lockfile_versions(ref: str) -> dict[str, str]:
    raw = git("show", f"{ref}:{LOCKFILE_REL}")
    lock = json.loads(raw)
    return {
        key.split("node_modules/")[-1]: value["version"]
        for key, value in lock["packages"].items()
        if key and value.get("version")
    }


def python_source_versions() -> dict[str, list[str]]:
    """Map distribution name -> the versions the generated modules install.

    Each generated module carries a pip command naming the exact pin it
    satisfies, which is how the flatpak sources can be compared against
    backend/constraints.txt rather than merely counted.
    """
    payload = json.loads(PY_SOURCES.read_text())
    modules = payload["modules"] if isinstance(payload, dict) else payload
    versions: dict[str, list[str]] = {}
    pin_re = re.compile(r"[A-Za-z0-9._-]+==([^\s\"'\\]+)")
    for module in modules:
        if not isinstance(module, dict):
            continue
        for command in module.get("build-commands", []):
            for version in pin_re.findall(command):
                versions.setdefault(
                    canonical_distribution(str(module.get("name", ""))), []
                ).append(version)
    return versions


def constraint_pin(name: str) -> str | None:
    """Look up the backend/constraints.txt pin for a canonical name."""
    for raw in (ROOT / "backend" / "constraints.txt").read_text().splitlines():
        match = re.match(r"^([A-Za-z0-9._-]+)==(\S+)", raw)
        if match and canonical_distribution(match.group(1)) == name:
            return match.group(2)
    return None


def runtime_closure() -> dict[str, str]:
    """name -> constraints.txt pin for the full flatpak runtime closure.

    Delegates to flatpak_python_closure so the gate and the generator share one
    definition of "the closure".
    """
    from flatpak_python_closure import main as closure_main

    saved = sys.stdout
    sys.stdout = io.StringIO()
    try:
        exit_code = closure_main()
        rendered = sys.stdout.getvalue()
    finally:
        sys.stdout = saved
    if exit_code != 0:
        raise SystemExit(rendered.strip() or "runtime closure is not resolvable")

    closure: dict[str, str] = {}
    for line in rendered.splitlines():
        if "==" in line:
            name, version = line.strip().split("==", 1)
            closure[canonical_distribution(name)] = version
    return closure


def canonical_distribution(name: str) -> str:
    """Normalise a distribution name for comparison.

    PEP 503 treats runs of -_. as equivalent, so `backports.tarfile`,
    `python3-backports.tarfile` and `backports-tarfile` must all collapse to the
    same key. Generated module names keep their dotted spelling, so the
    `python3-` prefix flatpak-pip-generator adds is stripped first.
    """
    lowered = name.strip().lower()
    if lowered.startswith("python3-"):
        lowered = lowered.removeprefix("python3-")
    return re.sub(r"[-_.]+", "-", lowered)


def python_module_names() -> set[str]:
    payload = json.loads(PY_SOURCES.read_text())
    modules = payload["modules"] if isinstance(payload, dict) else payload
    return {
        canonical_distribution(str(module["name"]))
        for module in modules
        if isinstance(module, dict) and module.get("name")
    }


def requirement_names() -> set[str]:
    names: set[str] = set()
    for line in FLATPAK_REQUIREMENTS.read_text().splitlines():
        token = line.split("#", 1)[0].strip()
        if not token:
            continue
        base = re.split(r"[=<>\[]", token, maxsplit=1)[0]
        names.add(canonical_distribution(base))
    return names


def main() -> int:
    report = Report()
    manifest_text = MANIFEST.read_text()
    app_id = manifest_app_id(manifest_text)
    version = version_contract()

    # 1. version contract (version_contract raises on mismatch)
    report.note(f"version contract: {version}")

    # 2. manifest pin == release tag
    commit = manifest_commit(manifest_text)
    if commit is None:
        report.fail("manifest-pin", "no git source commit in the manifest")
    else:
        tag = f"v{version}"
        try:
            # `rev-parse v<tag>` returns the *tag object* hash for annotated tags,
            # which never equals the commit the manifest pins. `^{commit}` peels
            # it to the commit the tag points at.
            tag_commit = git("rev-parse", f"{tag}^{{commit}}")
        except subprocess.CalledProcessError:
            report.fail("manifest-pin", f"tag {tag} does not exist yet")
        else:
            if tag_commit != commit:
                report.fail(
                    "manifest-pin",
                    f"manifest commit {commit[:12]} != {tag} {tag_commit[:12]}",
                )
            else:
                report.note(f"manifest pin matches {tag} ({commit[:12]})")

    # 3. app id parity
    tree = ET.parse(METAINFO)
    meta_id = tree.getroot().findtext("id", "").strip()
    if meta_id != app_id:
        report.fail("app-id", f"metainfo id {meta_id!r} != manifest {app_id!r}")
    for suffix in (".desktop", ".metainfo.xml", ".svg"):
        path = ROOT / "packaging" / "flatpak" / f"{app_id}{suffix}"
        if not path.is_file():
            report.fail("app-id", f"missing {path.name}")
    if ROOT / f"{app_id}.yaml" != MANIFEST:
        report.fail("app-id", "manifest filename does not match the app id")

    # 4. metainfo releases
    releases = tree.getroot().findall("./releases/release")
    if not releases:
        report.fail("metainfo-releases", "no <release> entries")
    else:
        versions = [rel.get("version", "") for rel in releases]
        if versions[0] != version:
            report.fail(
                "metainfo-releases",
                f"latest release {versions[0]!r} != version contract {version!r}",
            )
        else:
            report.note(f"metainfo latest release: {versions[0]}")

    # 5. node sources cover the lockfile at the pinned commit
    if commit is not None:
        try:
            lock = lockfile_versions(commit)
        except subprocess.CalledProcessError:
            report.fail("node-sources", f"cannot read {LOCKFILE_REL} at {commit[:12]}")
        else:
            cached = node_package_versions()
            missing = []
            mismatched = []
            for name, wanted in lock.items():
                have = cached.get(name)
                if not have:
                    missing.append(f"{name}@{wanted}")
                elif wanted not in have:
                    mismatched.append(f"{name}@{wanted} (cached {','.join(have)})")
            if missing:
                report.fail(
                    "node-sources",
                    f"{len(missing)} package(s) absent from generated-sources.json: "
                    + ", ".join(sorted(missing)[:8]),
                )
            if mismatched:
                report.fail(
                    "node-sources",
                    f"{len(mismatched)} package(s) at the wrong version: "
                    + ", ".join(sorted(mismatched)[:8]),
                )
            if not missing and not mismatched:
                report.note(
                    f"node sources cover all {len(lock)} locked packages at {commit[:12]}"
                )

    # 6. python sources cover the runtime dependency closure
    modules = python_module_names()
    wanted = requirement_names()
    absent = sorted(name for name in wanted if name not in modules)
    if absent:
        report.fail(
            "python-sources",
            "requirements.txt pins not present in python3-requirements.json: "
            + ", ".join(absent),
        )
    else:
        # The generated sources must satisfy the whole runtime closure, not just
        # the direct pins: a transitive dependency that floated (anyio, click,
        # watchfiles...) is exactly how the v1.3.0-era manifest drifted away from
        # backend/constraints.txt.
        versions = python_source_versions()
        drifted = sorted(
            f"{name} (flatpak {','.join(found)} vs constraints {pin})"
            for name, pin in sorted(runtime_closure().items())
            if (found := versions.get(name)) and pin not in found
        )
        unsatisfied = sorted(
            f"{name}=={pin}"
            for name, pin in sorted(runtime_closure().items())
            if pin not in versions.get(name, [])
        )
        if unsatisfied:
            report.fail(
                "python-sources",
                f"{len(unsatisfied)} runtime distribution(s) not pinned as "
                "constraints.txt requires: " + ", ".join(unsatisfied[:8]),
            )
        elif drifted:
            report.fail(
                "python-sources",
                f"{len(drifted)} distribution(s) drifted from constraints.txt: "
                + ", ".join(drifted[:8]),
            )
        else:
            report.note(
                f"python sources pin all {len(runtime_closure())} runtime "
                "distributions to backend/constraints.txt"
            )

    # 7. manifest installs the required assets
    commands = manifest_text
    required = [
        f"/app/share/applications/{app_id}.desktop",
        f"/app/share/metainfo/{app_id}.metainfo.xml",
        f"/app/share/icons/hicolor/scalable/apps/{app_id}.svg",
        f"/app/share/licenses/{app_id}/LICENSE",
    ]
    for target in required:
        if target not in commands:
            report.fail("assets", f"manifest does not install {target}")

    for note in report.notes:
        print(f"  ok  {note}")
    if report.errors:
        print("\nflatpak consistency: FAIL", file=sys.stderr)
        for error in report.errors:
            print(f"  FAIL  {error}", file=sys.stderr)
        return 1
    print("\nflatpak consistency: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
