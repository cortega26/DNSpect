from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .models import HOSTNAME_RE


def _resolve_data_root() -> Path:
    override = os.getenv("DNS_SPEED_LAB_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path.cwd())) / "data"
    return Path(__file__).resolve().parents[2] / "data"


DATA_ROOT = _resolve_data_root()
PROVIDERS_PATH = DATA_ROOT / "dns_providers.es.json"
QUERIES_PATH = DATA_ROOT / "queries.txt"

BLOCKING_DOMAINS_PATH = DATA_ROOT / "blocking_domains.txt"

EXTRA_DEFAULT_RESOLVERS = [
    "4.2.2.1",
    "4.2.2.2",
    "4.2.2.3",
    "4.2.2.4",
    "4.2.2.5",
    "4.2.2.6",
]


def load_providers() -> list[dict[str, Any]]:
    with PROVIDERS_PATH.open("r", encoding="utf-8") as f:
        providers = json.load(f)
    if not isinstance(providers, list):
        raise ValueError("dns_providers.es.json debe ser una lista")
    _validate_providers(providers)
    return providers


def _validate_providers(providers: list[dict[str, Any]]) -> None:
    seen_ids: set[str] = set()
    seen_resolvers: dict[str, str] = {}
    for provider in providers:
        pid = provider.get("id")
        if not isinstance(pid, str) or not pid.strip():
            raise ValueError("Provider sin id válido")
        if pid in seen_ids:
            raise ValueError(f"ID de provider duplicado: {pid}")
        seen_ids.add(pid)

        dns = provider.get("dns")
        if not isinstance(dns, list) or len(dns) == 0:
            raise ValueError(f"Provider '{pid}' no tiene lista dns o está vacía")
        for ip in dns:
            if not isinstance(ip, str) or not ip.strip():
                raise ValueError(f"Resolver vacío en provider '{pid}'")
            if ip in seen_resolvers:
                raise ValueError(f"Resolver duplicado '{ip}' en provider '{pid}' y '{seen_resolvers[ip]}'")
            seen_resolvers[ip] = pid

    for provider in providers:
        pid = provider.get("id", "")
        features = provider.get("features")
        if not isinstance(features, dict):
            continue
        doh_flag = features.get("doh")
        if doh_flag != "yes":
            continue
        doh_url = features.get("doh_url", "")
        if not isinstance(doh_url, str) or not doh_url.strip():
            raise ValueError(f"Provider '{pid}' declara doh=yes sin doh_url configurable")
        parsed = urlparse(doh_url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError(f"Provider '{pid}' tiene doh_url inválido: {doh_url}")


def load_default_queries() -> list[str]:
    queries: list[str] = []
    with QUERIES_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            candidate = line.strip().lower()
            if not candidate or candidate.startswith("#"):
                continue
            queries.append(candidate)
    return queries


def load_blocking_domains() -> list[str]:
    domains: list[str] = []
    with BLOCKING_DOMAINS_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            candidate = line.strip().lower()
            if not candidate or candidate.startswith("#"):
                continue
            domains.append(candidate)
    return domains


def build_default_resolvers(providers: list[dict[str, Any]]) -> list[str]:
    resolvers: list[str] = []
    for p in providers:
        for ip in p.get("dns", []):
            if ip and ip not in resolvers:
                resolvers.append(ip)
    for ip in EXTRA_DEFAULT_RESOLVERS:
        if ip not in resolvers:
            resolvers.append(ip)
    return resolvers


def resolver_provider_index(providers: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for provider in providers:
        pid = provider.get("id", "")
        for ip in provider.get("dns", []):
            if ip in index:
                raise ValueError(
                    f"Resolver duplicado '{ip}' en provider '{pid}' y '{index[ip].get('id', '')}'"
                )
            index[ip] = provider
    return index


def is_valid_dns_hostname(hostname: str) -> bool:
    """Syntactic DNS hostname check for comparison-time DoT endpoints."""
    return bool(HOSTNAME_RE.match(hostname))


def is_valid_doh_url(url: str) -> bool:
    """Absolute HTTPS check for comparison-time DoH endpoints (plan-006 shape)."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme == "https" and bool(parsed.hostname)
