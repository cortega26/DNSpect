from __future__ import annotations

import subprocess

from app import detect_dns


def _completed(args: list[str], *, stdout: str, returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=args, returncode=returncode, stdout=stdout, stderr="")


def test_detect_macos_dns_parses_scutil_multiple_resolvers() -> None:
    scutil_output = """
DNS configuration

resolver #1
  search domain[0] : local
  nameserver[0] : 8.8.8.8
  nameserver[1] : 2001:4860:4860::8888

resolver #2
  domain : example.internal
  nameserver[0] : 1.1.1.1
  nameserver[1] : 2001:4860:4860::8888
"""

    def fake_run(cmd: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        assert cmd == ["scutil", "--dns"]
        return _completed(cmd, stdout=scutil_output)

    original_run = detect_dns.subprocess.run
    detect_dns.subprocess.run = fake_run  # type: ignore[assignment]
    try:
        payload = detect_dns.detect_macos_dns()
    finally:
        detect_dns.subprocess.run = original_run  # type: ignore[assignment]

    assert payload == {
        "dns_servers": ["8.8.8.8", "2001:4860:4860::8888", "1.1.1.1"],
        "method": "scutil",
        "platform": "macos",
    }


def test_detect_macos_dns_fallback_networksetup_ignores_none_set() -> None:
    def fake_run(cmd: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if cmd == ["scutil", "--dns"]:
            return _completed(cmd, stdout="DNS configuration\n")
        if cmd == ["networksetup", "-listallnetworkservices"]:
            return _completed(
                cmd,
                stdout="An asterisk (*) denotes that a network service is disabled.\nWi-Fi\nThunderbolt Bridge\n",
            )
        if cmd == ["networksetup", "-getdnsservers", "Wi-Fi"]:
            return _completed(cmd, stdout="There aren't any DNS Servers set on Wi-Fi.\n")
        if cmd == ["networksetup", "-getdnsservers", "Thunderbolt Bridge"]:
            return _completed(cmd, stdout="There are no DNS Servers set on Thunderbolt Bridge.\n")
        raise AssertionError(f"unexpected command: {cmd}")

    original_run = detect_dns.subprocess.run
    detect_dns.subprocess.run = fake_run  # type: ignore[assignment]
    try:
        payload = detect_dns.detect_macos_dns()
    finally:
        detect_dns.subprocess.run = original_run  # type: ignore[assignment]

    assert payload == {
        "dns_servers": [],
        "method": "networksetup",
        "platform": "macos",
    }


def test_parse_networksetup_dnsservers_mixed_ipv4_ipv6() -> None:
    output = "2001:4860:4860::8844\n8.8.4.4\nnot-an-ip\n"
    assert detect_dns._parse_networksetup_dnsservers(output) == ["2001:4860:4860::8844", "8.8.4.4"]


def test_normalize_ip_list_dedup_preserves_order() -> None:
    values = [
        "2001:0db8:0:0::1",
        "1.1.1.1",
        "2001:db8::1",
        "1.1.1.1",
        "8.8.8.8",
    ]
    assert detect_dns._normalize_ip_list(values) == ["2001:db8::1", "1.1.1.1", "8.8.8.8"]


def test_detect_system_dns_uses_macos_detector_on_darwin(monkeypatch) -> None:
    monkeypatch.setattr(detect_dns.sys, "platform", "darwin")
    monkeypatch.setattr(
        detect_dns,
        "detect_macos_dns",
        lambda: {
            "dns_servers": ["2001:4860:4860::8888", "8.8.8.8"],
            "method": "scutil",
            "platform": "macos",
        },
    )

    payload = detect_dns.detect_system_dns()
    assert payload == {
        "resolvers": ["2001:4860:4860::8888", "8.8.8.8"],
        "method": "scutil",
        "platform": "macos",
    }


def test_detect_system_dns_macos_error_is_non_fatal(monkeypatch) -> None:
    monkeypatch.setattr(detect_dns.sys, "platform", "darwin")

    def boom() -> dict:
        raise RuntimeError("simulated failure")

    monkeypatch.setattr(detect_dns, "detect_macos_dns", boom)

    payload = detect_dns.detect_system_dns()
    assert payload == {
        "resolvers": [],
        "method": "error:RuntimeError",
        "platform": "macos",
    }
