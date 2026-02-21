from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


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
    return providers


def load_default_queries() -> list[str]:
    queries: list[str] = []
    with QUERIES_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            candidate = line.strip().lower()
            if not candidate or candidate.startswith("#"):
                continue
            queries.append(candidate)
    return queries


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
        for ip in provider.get("dns", []):
            index[ip] = provider
    return index
