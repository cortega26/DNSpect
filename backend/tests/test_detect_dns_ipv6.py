from __future__ import annotations

import subprocess

from app import detect_dns


def _completed(args: list[str], *, stdout: str, returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=args, returncode=returncode, stdout=stdout, stderr="")


def test_detect_linux_dns_resolvectl_keeps_ipv4_and_ipv6() -> None:
    resolvectl_output = """
Global
       DNS Servers: 2001:4860:4860::8888 8.8.8.8
Link 2 (eth0)
    DNS Server: 2620:fe::fe
"""

    def fake_run(cmd: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        assert cmd == ["resolvectl", "status"]
        return _completed(cmd, stdout=resolvectl_output)

    original_run = detect_dns.subprocess.run
    detect_dns.subprocess.run = fake_run  # type: ignore[assignment]
    try:
        resolvers, method = detect_dns.detect_linux_dns()
    finally:
        detect_dns.subprocess.run = original_run  # type: ignore[assignment]

    assert method == "resolvectl"
    assert resolvers == ["2001:4860:4860::8888", "8.8.8.8", "2620:fe::fe"]


def test_detect_windows_dns_ipconfig_keeps_ipv4_and_ipv6() -> None:
    ipconfig_output = """
Windows IP Configuration

Ethernet adapter Ethernet:
   DNS Servers . . . . . . . . . . . : 2001:4860:4860::8888
                                       8.8.8.8
"""

    def fake_run(cmd: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if cmd == ["ipconfig", "/all"]:
            return _completed(cmd, stdout=ipconfig_output)
        raise AssertionError(f"unexpected command: {cmd}")

    original_run = detect_dns.subprocess.run
    detect_dns.subprocess.run = fake_run  # type: ignore[assignment]
    try:
        resolvers, method = detect_dns.detect_windows_dns()
    finally:
        detect_dns.subprocess.run = original_run  # type: ignore[assignment]

    assert method == "ipconfig"
    assert resolvers == ["2001:4860:4860::8888", "8.8.8.8"]


def test_detect_windows_dns_netsh_fallback_keeps_ipv6() -> None:
    def fake_run(cmd: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if cmd == ["ipconfig", "/all"]:
            return _completed(cmd, stdout="", returncode=1)
        if cmd == ["netsh", "interface", "ip", "show", "dns"]:
            return _completed(
                cmd,
                stdout="""
DNS servers configured through DHCP: 2606:4700:4700::1111
Statically Configured DNS Servers: 1.1.1.1
""",
            )
        raise AssertionError(f"unexpected command: {cmd}")

    original_run = detect_dns.subprocess.run
    detect_dns.subprocess.run = fake_run  # type: ignore[assignment]
    try:
        resolvers, method = detect_dns.detect_windows_dns()
    finally:
        detect_dns.subprocess.run = original_run  # type: ignore[assignment]

    assert method == "netsh"
    assert resolvers == ["2606:4700:4700::1111", "1.1.1.1"]
