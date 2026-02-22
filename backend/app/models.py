from __future__ import annotations

import ipaddress
import re
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator

HOSTNAME_RE = re.compile(r"^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*\.?$")


class BenchmarkMode(str, Enum):
    quick = "quick"
    standard = "standard"
    exhaustive = "exhaustive"


MODE_DEFAULT_RUNS = {
    BenchmarkMode.quick: 12,
    BenchmarkMode.standard: 30,
    BenchmarkMode.exhaustive: 80,
}


def _normalize_resolvers(values: Optional[list[str]], *, max_items: int) -> Optional[list[str]]:
    if values is None:
        return None
    if len(values) > max_items:
        raise ValueError("Demasiados resolvers")
    parsed: list[str] = []
    for raw in values:
        raw = raw.strip()
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError as exc:
            raise ValueError(f"Resolver inválido: {raw}") from exc
        parsed.append(str(ip))
    return list(dict.fromkeys(parsed))


def _normalize_queries(values: Optional[list[str]], *, max_items: int) -> Optional[list[str]]:
    if values is None:
        return None
    if len(values) > max_items:
        raise ValueError("Demasiados dominios")
    cleaned: list[str] = []
    for domain in values:
        d = domain.strip().lower()
        if not d or not HOSTNAME_RE.match(d):
            raise ValueError(f"Dominio inválido: {domain}")
        cleaned.append(d.rstrip("."))
    return list(dict.fromkeys(cleaned))


class BenchmarkRequest(BaseModel):
    runs: Optional[int] = Field(default=None, ge=1, le=300)
    timeout_sec: float = Field(default=2.0, gt=0.1, le=10.0)
    resolvers: Optional[list[str]] = None
    queries: Optional[list[str]] = None
    mode: BenchmarkMode = BenchmarkMode.standard

    @field_validator("resolvers")
    @classmethod
    def validate_resolvers(cls, values: Optional[list[str]]) -> Optional[list[str]]:
        return _normalize_resolvers(values, max_items=256)

    @field_validator("queries")
    @classmethod
    def validate_queries(cls, values: Optional[list[str]]) -> Optional[list[str]]:
        return _normalize_queries(values, max_items=256)

    def effective_runs(self) -> int:
        if self.runs is not None:
            return min(max(self.runs, 1), 300)
        return MODE_DEFAULT_RUNS[self.mode]


class ProbeRequest(BaseModel):
    resolvers: list[str] = Field(min_length=1, max_length=8)
    queries: Optional[list[str]] = None
    timeout_sec: float = Field(default=1.5, gt=0.1, le=5.0)
    runs_per_resolver: int = Field(default=4, ge=1, le=5)

    @field_validator("resolvers")
    @classmethod
    def validate_resolvers(cls, values: list[str]) -> list[str]:
        normalized = _normalize_resolvers(values, max_items=8)
        return normalized or []

    @field_validator("queries")
    @classmethod
    def validate_queries(cls, values: Optional[list[str]]) -> Optional[list[str]]:
        return _normalize_queries(values, max_items=32)
