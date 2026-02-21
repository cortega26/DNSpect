from __future__ import annotations

import platform
import re
import subprocess
from pathlib import Path

IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


def _extract_ips(text: str) -> list[str]:
    ips = []
    for match in IP_RE.findall(text):
        if match not in ips:
            ips.append(match)
    return ips


def detect_linux_dns() -> tuple[list[str], str]:
    resolvers: list[str] = []
    try:
        proc = subprocess.run(
            ["resolvectl", "status"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout:
            for line in proc.stdout.splitlines():
                if "DNS Servers" in line or "DNS Server" in line:
                    resolvers.extend(_extract_ips(line))
            if resolvers:
                return list(dict.fromkeys(resolvers)), "resolvectl"
    except (FileNotFoundError, subprocess.SubprocessError):
        pass

    resolv_conf = Path("/etc/resolv.conf")
    if resolv_conf.exists():
        content = resolv_conf.read_text(encoding="utf-8", errors="ignore")
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("nameserver"):
                resolvers.extend(_extract_ips(line))
        if resolvers:
            return list(dict.fromkeys(resolvers)), "resolv.conf"

    return [], "none"


def detect_windows_dns() -> tuple[list[str], str]:
    try:
        proc = subprocess.run(
            ["ipconfig", "/all"],
            capture_output=True,
            text=True,
            timeout=4,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout:
            resolvers: list[str] = []
            capture_next = False
            for raw_line in proc.stdout.splitlines():
                line = raw_line.rstrip()
                if "DNS Servers" in line:
                    resolvers.extend(_extract_ips(line))
                    capture_next = True
                    continue
                if capture_next:
                    if not line.startswith(" ") and not line.startswith("\t"):
                        capture_next = False
                        continue
                    ips = _extract_ips(line)
                    if ips:
                        resolvers.extend(ips)
                    else:
                        capture_next = False
            resolvers = list(dict.fromkeys(resolvers))
            if resolvers:
                return resolvers, "ipconfig"
    except (FileNotFoundError, subprocess.SubprocessError):
        pass

    try:
        proc = subprocess.run(
            ["netsh", "interface", "ip", "show", "dns"],
            capture_output=True,
            text=True,
            timeout=4,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout:
            resolvers = list(dict.fromkeys(_extract_ips(proc.stdout)))
            if resolvers:
                return resolvers, "netsh"
    except (FileNotFoundError, subprocess.SubprocessError):
        pass

    return [], "none"


def detect_system_dns() -> dict:
    system = platform.system().lower()
    if "windows" in system:
        resolvers, method = detect_windows_dns()
    else:
        resolvers, method = detect_linux_dns()

    return {
        "resolvers": resolvers,
        "method": method,
        "platform": system,
    }
