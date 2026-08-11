from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.providers import load_providers, resolver_provider_index


def _write_fixture(tmp_path: Path, content: list[dict]) -> Path:
    path = tmp_path / "test_providers.json"
    path.write_text(json.dumps(content), encoding="utf-8")
    return path


def test_minimal_valid_dohe_provider_loads(monkeypatch, tmp_path) -> None:
    fixtures = [
        {
            "id": "test-provider",
            "name": "Test",
            "dns": ["1.1.1.1"],
            "tags": [],
            "region": "global",
            "country": None,
            "goals": [],
            "features": {"doh": "yes", "doh_url": "https://dns.example.com/dns-query"},
            "notes_es": "",
        }
    ]
    path = _write_fixture(tmp_path, fixtures)
    monkeypatch.setattr("app.providers.PROVIDERS_PATH", path)
    providers = load_providers()
    assert len(providers) == 1


def test_doh_yes_without_url_raises(monkeypatch, tmp_path) -> None:
    fixtures = [
        {
            "id": "bad-provider",
            "name": "Bad",
            "dns": ["1.1.1.1"],
            "tags": [],
            "region": "global",
            "country": None,
            "goals": [],
            "features": {"doh": "yes", "doh_url": ""},
            "notes_es": "",
        }
    ]
    path = _write_fixture(tmp_path, fixtures)
    monkeypatch.setattr("app.providers.PROVIDERS_PATH", path)
    with pytest.raises(ValueError, match="doh=yes sin doh_url"):
        load_providers()


def test_doh_yes_with_http_url_raises(monkeypatch, tmp_path) -> None:
    fixtures = [
        {
            "id": "bad-provider",
            "name": "Bad",
            "dns": ["1.1.1.1"],
            "tags": [],
            "region": "global",
            "country": None,
            "goals": [],
            "features": {"doh": "yes", "doh_url": "http://example.com"},
            "notes_es": "",
        }
    ]
    path = _write_fixture(tmp_path, fixtures)
    monkeypatch.setattr("app.providers.PROVIDERS_PATH", path)
    with pytest.raises(ValueError, match="doh_url inválido"):
        load_providers()


def test_duplicate_provider_id_raises(monkeypatch, tmp_path) -> None:
    fixtures = [
        {
            "id": "dup",
            "name": "A",
            "dns": ["1.1.1.1"],
            "tags": [],
            "region": "global",
            "country": None,
            "goals": [],
            "features": {},
            "notes_es": "",
        },
        {
            "id": "dup",
            "name": "B",
            "dns": ["8.8.8.8"],
            "tags": [],
            "region": "global",
            "country": None,
            "goals": [],
            "features": {},
            "notes_es": "",
        },
    ]
    path = _write_fixture(tmp_path, fixtures)
    monkeypatch.setattr("app.providers.PROVIDERS_PATH", path)
    with pytest.raises(ValueError, match="duplicado"):
        load_providers()


def test_duplicate_resolver_raises(monkeypatch, tmp_path) -> None:
    fixtures = [
        {
            "id": "a",
            "name": "A",
            "dns": ["1.1.1.1"],
            "tags": [],
            "region": "global",
            "country": None,
            "goals": [],
            "features": {},
            "notes_es": "",
        },
        {
            "id": "b",
            "name": "B",
            "dns": ["1.1.1.1"],
            "tags": [],
            "region": "global",
            "country": None,
            "goals": [],
            "features": {},
            "notes_es": "",
        },
    ]
    path = _write_fixture(tmp_path, fixtures)
    monkeypatch.setattr("app.providers.PROVIDERS_PATH", path)
    with pytest.raises(ValueError, match="duplicado"):
        load_providers()


def test_empty_dns_list_raises(monkeypatch, tmp_path) -> None:
    fixtures = [
        {
            "id": "empty",
            "name": "Empty",
            "dns": [],
            "tags": [],
            "region": "global",
            "country": None,
            "goals": [],
            "features": {},
            "notes_es": "",
        }
    ]
    path = _write_fixture(tmp_path, fixtures)
    monkeypatch.setattr("app.providers.PROVIDERS_PATH", path)
    with pytest.raises(ValueError, match="no tiene lista dns"):
        load_providers()


def test_resolver_provider_index_rejects_duplicates() -> None:
    providers = [
        {
            "id": "a",
            "dns": ["1.1.1.1"],
        },
        {
            "id": "b",
            "dns": ["1.1.1.1"],
        },
    ]
    with pytest.raises(ValueError, match="duplicado"):
        resolver_provider_index(providers)


def test_packaged_catalog_loads() -> None:
    providers = load_providers()
    index = resolver_provider_index(providers)
    assert len(providers) > 0
    assert len(index) > 0
    assert "8.20.247.20" in index
    assert index["8.20.247.20"]["id"] == "comodo"
