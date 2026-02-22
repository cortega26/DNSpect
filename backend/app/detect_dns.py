from __future__ import annotations

import ipaddress
import platform
import re
import subprocess
import sys
from pathlib import Path

IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
SCUTIL_NAMESERVER_RE = re.compile(r"^\s*nameserver(?:\[\d+\])?\s*:\s*(.+?)\s*$", re.IGNORECASE)


def _extract_ips(text: str) -> list[str]:
    ips = []
    for match in IP_RE.findall(text):
        if match not in ips:
            ips.append(match)
    return ips


def _normalize_ip_list(values: list[str]) -> list[str]:
    normalized: list[str] = []
    for raw in values:
        candidate = _extract_first_ip_token(raw)
        if candidate is None:
            continue
        ip = candidate
        if ip not in normalized:
            normalized.append(ip)
    return normalized


def _extract_first_ip_token(value: str) -> str | None:
    if not value:
        return None

    tokens = re.split(r"[\s,;]+", value.strip())
    for token in tokens:
        candidate = token.strip().strip("()[]{}")
        if not candidate:
            continue
        if "%" in candidate:
            candidate = candidate.split("%", 1)[0]
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            continue
    return None


def _parse_scutil_nameservers(scutil_output: str) -> list[str]:
    candidates: list[str] = []
    in_resolver_block = False

    for raw_line in scutil_output.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.lower().startswith("resolver #"):
            in_resolver_block = True
            continue
        if not in_resolver_block:
            continue

        match = SCUTIL_NAMESERVER_RE.match(line)
        if match:
            candidates.append(match.group(1).strip())

    return _normalize_ip_list(candidates)


def _parse_networksetup_dnsservers(output: str) -> list[str]:
    lowered = output.lower()
    if "there aren't any dns servers set" in lowered:
        return []
    if "there are no dns servers set" in lowered:
        return []

    candidates = [line.strip() for line in output.splitlines() if line.strip()]
    return _normalize_ip_list(candidates)


def detect_macos_dns() -> dict:
    try:
        proc = subprocess.run(
            ["scutil", "--dns"],
            capture_output=True,
            text=True,
            timeout=4,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout:
            resolvers = _parse_scutil_nameservers(proc.stdout)
            if resolvers:
                return {
                    "dns_servers": resolvers,
                    "method": "scutil",
                    "platform": "macos",
                }
    except (FileNotFoundError, subprocess.SubprocessError):
        pass

    services: list[str] = []
    try:
        list_proc = subprocess.run(
            ["networksetup", "-listallnetworkservices"],
            capture_output=True,
            text=True,
            timeout=4,
            check=False,
        )
        if list_proc.returncode == 0 and list_proc.stdout:
            for raw_line in list_proc.stdout.splitlines():
                service = raw_line.strip()
                if not service:
                    continue
                if service.lower().startswith("an asterisk"):
                    continue
                if service.startswith("*"):
                    continue
                services.append(service)
    except (FileNotFoundError, subprocess.SubprocessError):
        services = []

    resolvers = []
    for service in services:
        try:
            proc = subprocess.run(
                ["networksetup", "-getdnsservers", service],
                capture_output=True,
                text=True,
                timeout=4,
                check=False,
            )
        except (FileNotFoundError, subprocess.SubprocessError):
            continue
        if proc.returncode != 0:
            continue
        resolvers.extend(_parse_networksetup_dnsservers(proc.stdout))

    return {
        "dns_servers": _normalize_ip_list(resolvers),
        "method": "networksetup",
        "platform": "macos",
    }


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
    if sys.platform == "darwin":
        try:
            macos_payload = detect_macos_dns()
            return {
                "resolvers": macos_payload.get("dns_servers", []),
                "method": macos_payload.get("method", "none"),
                "platform": macos_payload.get("platform", "macos"),
                "error_detail": None,
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "resolvers": [],
                "method": f"error:{exc.__class__.__name__}",
                "platform": "macos",
                "error_detail": str(exc),
            }

    system = platform.system().lower()
    if "windows" in system:
        resolvers, method = detect_windows_dns()
    else:
        resolvers, method = detect_linux_dns()

    return {
        "resolvers": resolvers,
        "method": method,
        "platform": system,
        "error_detail": None,
    }
