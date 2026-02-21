import pytest
from pydantic import ValidationError

from app.models import BenchmarkRequest


def test_invalid_resolver_rejected():
    with pytest.raises(ValidationError):
        BenchmarkRequest(resolvers=["not-an-ip"])


def test_invalid_domain_rejected():
    with pytest.raises(ValidationError):
        BenchmarkRequest(queries=["bad domain"])


def test_valid_request_accepts_ipv4():
    req = BenchmarkRequest(resolvers=["1.1.1.1"], queries=["example.com"])
    assert req.resolvers == ["1.1.1.1"]
