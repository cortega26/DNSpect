from __future__ import annotations

import ipaddress
import re
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator

HOSTNAME_RE = re.compile(r"^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*\.?$")


class BenchmarkMode(str, Enum):
    quick = "quick"
    standard = "standard"
    exhaustive = "exhaustive"


class BenchmarkGoal(str, Enum):
    speed = "speed"
    security = "security"
    privacy = "privacy"
    ad_blocking = "ad-blocking"
    family = "family"


class BenchmarkProtocol(str, Enum):
    udp = "udp"
    dot = "dot"
    doh = "doh"
    doq = "doq"


class SelectionSource(str, Enum):
    manual = "manual"
    catalog = "catalog"
    system = "system"


class WatchOrigin(str, Enum):
    watch = "watch"


class TargetSnapshot(BaseModel):
    resolver_ips: list[str] = Field(min_length=1)
    selection_source: SelectionSource
    provider_ids: dict[str, str] | None = None

    @field_validator("provider_ids")
    @classmethod
    def validate_provider_ids(
        cls, value: dict[str, str] | None, info: ValidationInfo
    ) -> dict[str, str] | None:
        if value is None:
            return None
        resolver_ips = set(info.data.get("resolver_ips", []))
        for key in value:
            if key not in resolver_ips:
                raise ValueError(f"provider_ids key '{key}' not in resolver_ips")
        return value


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
    goal: BenchmarkGoal | None = Field(
        default=None,
        description="Deprecated: use scoring_profile instead.",
    )
    scoring_profile: BenchmarkGoal | None = Field(
        default=None,
        description="Canonical scoring profile that determines ranking weights.",
    )
    protocol: BenchmarkProtocol = BenchmarkProtocol.udp
    target_snapshot: TargetSnapshot | None = None
    origin: WatchOrigin | None = None

    @field_validator("resolvers")
    @classmethod
    def validate_resolvers(cls, values: Optional[list[str]]) -> Optional[list[str]]:
        return _normalize_resolvers(values, max_items=256)

    @field_validator("queries")
    @classmethod
    def validate_queries(cls, values: Optional[list[str]]) -> Optional[list[str]]:
        return _normalize_queries(values, max_items=256)

    @model_validator(mode="after")
    def resolve_scoring_profile(self) -> BenchmarkRequest:
        goal = self.goal
        scoring = self.scoring_profile
        if goal is not None and scoring is not None and goal != scoring:
            raise ValueError("goal y scoring_profile entran en conflicto")
        return self

    def effective_scoring_profile(self) -> str:
        return (self.scoring_profile or self.goal or BenchmarkGoal.speed).value

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


class RunManifest(BaseModel):
    """Immutable measurement contract of a persisted run.

    Two ``done`` runs are numerically comparable only when every field here is
    exactly equal. See docs/ARCHITECTURE.md for the derivation rules.
    """

    run_manifest_version: int
    response_semantics_version: str
    scoring_semantics_version: str
    scoring_profile: str
    target_snapshot: dict[str, object] | None
    protocol: str
    mode: str
    runs: int
    timeout_sec: float
    normal_query_schedule_version: str
    normal_query_plan_sha256: str
    normal_query_count: int
    blocking_query_plan_sha256: str
    blocking_query_count: int
    diagnostic_policy_version: str
    provider_catalog_sha256: str


class ComparisonReasonCode(str, Enum):
    manifest_missing = "manifest_missing"
    manifest_invalid = "manifest_invalid"
    manifest_version_mismatch = "manifest_version_mismatch"
    response_semantics_mismatch = "response_semantics_mismatch"
    scoring_semantics_mismatch = "scoring_semantics_mismatch"
    scoring_profile_mismatch = "scoring_profile_mismatch"
    target_snapshot_mismatch = "target_snapshot_mismatch"
    protocol_mismatch = "protocol_mismatch"
    query_plan_mismatch = "query_plan_mismatch"
    mode_mismatch = "mode_mismatch"
    runs_mismatch = "runs_mismatch"
    timeout_mismatch = "timeout_mismatch"
    diagnostic_policy_mismatch = "diagnostic_policy_mismatch"
    provider_catalog_mismatch = "provider_catalog_mismatch"


class RunComparisonMetrics(BaseModel):
    median_ms: float | None
    p95_ms: float | None
    success_rate: float | None
    failure_rate: float | None
    blocking_efficacy: float | None
    score_total: float | None


class RunComparisonDeltas(BaseModel):
    median_ms: float | None
    p95_ms: float | None
    success_rate: float | None
    failure_rate: float | None
    blocking_efficacy: float | None
    score_total: float | None
    rank: int


class RunComparisonRow(BaseModel):
    resolver: str
    baseline: RunComparisonMetrics
    candidate: RunComparisonMetrics
    baseline_rank: int
    candidate_rank: int
    deltas: RunComparisonDeltas


class RunComparisonResponse(BaseModel):
    baseline_id: str
    candidate_id: str
    baseline_manifest: RunManifest | None
    candidate_manifest: RunManifest | None
    comparable: bool
    reason_codes: list[ComparisonReasonCode]
    rows: list[RunComparisonRow]
    missing_baseline_results: list[str]
    missing_candidate_results: list[str]


CANONICAL_PROTOCOL_ORDER = (BenchmarkProtocol.udp, BenchmarkProtocol.dot, BenchmarkProtocol.doh)


class ProtocolComparisonRequest(BaseModel):
    """One parent session measuring one common target set across transports."""

    model_config = ConfigDict(extra="forbid")

    protocols: list[BenchmarkProtocol] = Field(min_length=2, max_length=3)
    target_snapshot: TargetSnapshot
    scoring_profile: BenchmarkGoal
    mode: BenchmarkMode = BenchmarkMode.standard
    queries: Optional[list[str]] = None
    runs: Optional[int] = Field(default=None, ge=1, le=300)
    timeout_sec: float = Field(default=2.0, gt=0.1, le=10.0)

    @field_validator("protocols")
    @classmethod
    def validate_protocols(cls, values: list[BenchmarkProtocol]) -> list[BenchmarkProtocol]:
        seen: set[str] = set()
        for protocol in values:
            if protocol.value in seen:
                raise ValueError("Protocolos duplicados en comparación")
            seen.add(protocol.value)
        return [protocol for protocol in CANONICAL_PROTOCOL_ORDER if protocol in values]

    @field_validator("target_snapshot")
    @classmethod
    def validate_target_snapshot(cls, value: TargetSnapshot) -> TargetSnapshot:
        normalized = _normalize_resolvers(value.resolver_ips, max_items=256)
        if not normalized:
            raise ValueError("Sin resolvers en el snapshot de destino")
        provider_ids: dict[str, str] | None = None
        if value.provider_ids is not None:
            provider_ids = {ip: pid for ip, pid in value.provider_ids.items() if ip in normalized}
        return TargetSnapshot(
            resolver_ips=normalized,
            selection_source=value.selection_source,
            provider_ids=provider_ids,
        )

    @field_validator("queries")
    @classmethod
    def validate_queries(cls, values: Optional[list[str]]) -> Optional[list[str]]:
        return _normalize_queries(values, max_items=256)

    def effective_runs(self) -> int:
        if self.runs is not None:
            return min(max(self.runs, 1), 300)
        return MODE_DEFAULT_RUNS[self.mode]


class ProtocolExclusion(BaseModel):
    resolver: str
    protocol: BenchmarkProtocol
    code: str


class ProtocolEndpointIdentity(BaseModel):
    resolver: str
    udp_resolver_ip: str
    dot_hostname: str | None
    doh_url: str | None


class ProtocolComparisonPreflightResponse(BaseModel):
    canonical_protocols: list[BenchmarkProtocol]
    requested_target_snapshot: TargetSnapshot
    common_eligible_target_snapshot: TargetSnapshot | None
    exclusions: list[ProtocolExclusion]
    endpoint_identities: list[ProtocolEndpointIdentity]
    normal_query_plan_sha256: str
    normal_query_count: int
    blocking_query_plan_sha256: str
    blocking_query_count: int
    effective_runs: int
    timeout_sec: float
    total_attempts: int
    estimated_duration_sec: float
    admissible: bool
    admission_reason_codes: list[
        Literal["no_common_targets", "attempt_budget_exceeded", "duration_budget_exceeded"]
    ]


class ProtocolComparisonProgress(BaseModel):
    current: int
    total: int
    current_protocol: BenchmarkProtocol | None
    current_resolver: str | None
    last_sample_at: int | None
    avg_latency_ms: float | None


class ProtocolComparisonManifest(BaseModel):
    manifest_version: int
    scoring_profile: str
    requested_target_snapshot: TargetSnapshot
    common_eligible_target_snapshot: TargetSnapshot
    canonical_protocols: list[BenchmarkProtocol]
    normal_query_plan_sha256: str
    normal_query_count: int
    blocking_query_plan_sha256: str
    blocking_query_count: int
    diagnostic_policy_version: str
    diagnostic_plan_sha256: str
    effective_runs: int
    timeout_sec: float
    endpoint_identities: list[ProtocolEndpointIdentity]


class ProtocolSubrunError(BaseModel):
    code: str
    message: str


class ProtocolSubrunResult(BaseModel):
    protocol: BenchmarkProtocol
    status: Literal["done", "failed"]
    complete: bool
    error: ProtocolSubrunError | None
    results: list[dict[str, Any]]


class ProtocolMetrics(BaseModel):
    median_ms: float | None
    p95_ms: float | None
    success_rate: float | None
    failure_rate: float | None
    blocking_efficacy: float | None
    score_total: float | None


class ProtocolMetricDeltas(ProtocolMetrics):
    pass


class ProtocolDeltaRow(BaseModel):
    resolver: str
    baseline: ProtocolMetrics | None
    candidate: ProtocolMetrics | None
    deltas: ProtocolMetricDeltas


class ProtocolDeltaPair(BaseModel):
    baseline_protocol: BenchmarkProtocol
    candidate_protocol: BenchmarkProtocol
    rows: list[ProtocolDeltaRow]


class ProtocolComparisonStatusResponse(BaseModel):
    comparison_id: str
    status: Literal["queued", "running", "done", "failed"]
    complete: bool
    error: str | None
    run_storage_warning: str | None
    progress: ProtocolComparisonProgress
    manifest: ProtocolComparisonManifest
    exclusions: list[ProtocolExclusion]
    subruns: list[ProtocolSubrunResult]
    delta_pairs: list[ProtocolDeltaPair]


WATCH_METRIC_KEYS = (
    "median_ms",
    "p95_ms",
    "success_rate",
    "failure_rate",
    "blocking_efficacy",
    "score_total",
)

DEFAULT_WATCH_THRESHOLDS = {
    "median_ms": 25.0,
    "failure_rate": 5.0,
    "success_rate": 5.0,
}


class WatchConfigRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_snapshot: TargetSnapshot
    protocol: BenchmarkProtocol = BenchmarkProtocol.udp
    scoring_profile: BenchmarkGoal = BenchmarkGoal.speed
    mode: BenchmarkMode = BenchmarkMode.quick
    runs: int | None = Field(default=None, ge=1, le=300)
    timeout_sec: float = Field(default=2.0, gt=0.1, le=10.0)
    interval_min: int = Field(default=30, ge=1)
    thresholds: dict[str, float] = Field(default_factory=dict, validate_default=True)
    queries: list[str] | None = None

    @field_validator("thresholds")
    @classmethod
    def validate_thresholds(cls, value: dict[str, float]) -> dict[str, float]:
        unknown = set(value) - set(WATCH_METRIC_KEYS)
        if unknown:
            raise ValueError(f"Thresholds desconocidos: {sorted(unknown)}")
        if any(v < 0 for v in value.values()):
            raise ValueError("Los thresholds deben ser >= 0")
        return value or dict(DEFAULT_WATCH_THRESHOLDS)

    @field_validator("queries")
    @classmethod
    def validate_queries(cls, values: list[str] | None) -> list[str] | None:
        return _normalize_queries(values, max_items=256)

    def effective_runs(self) -> int:
        if self.runs is not None:
            return min(max(self.runs, 1), 300)
        return MODE_DEFAULT_RUNS[self.mode]
