import pytest
from pydantic import ValidationError

from app.models import (
    BenchmarkGoal,
    BenchmarkRequest,
    SelectionSource,
    TargetSnapshot,
)


def test_invalid_resolver_rejected():
    with pytest.raises(ValidationError):
        BenchmarkRequest(resolvers=["not-an-ip"])


def test_invalid_domain_rejected():
    with pytest.raises(ValidationError):
        BenchmarkRequest(queries=["bad domain"])


def test_valid_request_accepts_ipv4():
    req = BenchmarkRequest(resolvers=["1.1.1.1"], queries=["example.com"])
    assert req.resolvers == ["1.1.1.1"]


def test_legacy_goal_only_is_compatible() -> None:
    req = BenchmarkRequest(resolvers=["1.1.1.1"], queries=["example.com"], goal=BenchmarkGoal.security)
    assert req.effective_scoring_profile() == "security"
    assert req.scoring_profile is None


def test_canonical_scoring_profile_only() -> None:
    req = BenchmarkRequest(
        resolvers=["1.1.1.1"], queries=["example.com"], scoring_profile=BenchmarkGoal.privacy
    )
    assert req.effective_scoring_profile() == "privacy"
    assert req.goal is None


def test_equal_goal_and_scoring_profile_is_valid() -> None:
    req = BenchmarkRequest(
        resolvers=["1.1.1.1"],
        queries=["example.com"],
        goal=BenchmarkGoal.speed,
        scoring_profile=BenchmarkGoal.speed,
    )
    assert req.effective_scoring_profile() == "speed"


def test_conflicting_goal_and_scoring_profile_rejected() -> None:
    with pytest.raises(ValidationError, match="entran en conflicto"):
        BenchmarkRequest(
            resolvers=["1.1.1.1"],
            queries=["example.com"],
            goal=BenchmarkGoal.speed,
            scoring_profile=BenchmarkGoal.security,
        )


def test_target_snapshot_valid_provider_ids() -> None:
    snapshot = TargetSnapshot(
        resolver_ips=["1.1.1.1", "8.8.8.8"],
        selection_source=SelectionSource.manual,
        provider_ids={"1.1.1.1": "cloudflare"},
    )
    assert snapshot.provider_ids == {"1.1.1.1": "cloudflare"}


def test_target_snapshot_invalid_provider_id_key() -> None:
    with pytest.raises(ValidationError, match="not in resolver_ips"):
        TargetSnapshot(
            resolver_ips=["1.1.1.1"],
            selection_source=SelectionSource.manual,
            provider_ids={"9.9.9.9": "quad9"},
        )


def test_target_snapshot_empty_resolver_ips() -> None:
    with pytest.raises(ValidationError):
        TargetSnapshot(resolver_ips=[], selection_source=SelectionSource.manual)


def test_default_scoring_profile_is_speed() -> None:
    req = BenchmarkRequest(resolvers=["1.1.1.1"], queries=["example.com"])
    assert req.effective_scoring_profile() == "speed"
