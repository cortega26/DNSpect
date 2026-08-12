from __future__ import annotations

import types

from fastapi.testclient import TestClient

from app import geoip
from app.geoip import _country_to_region, geoip_lookup
from app.main import app

client = TestClient(app)


class FakeInvalidDatabaseError(RuntimeError):
    """Mirrors maxminddb.errors.InvalidDatabaseError (a RuntimeError subclass)."""


def _fake_maxminddb(*, open_database=None) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        MODE_AUTO=1,
        errors=types.SimpleNamespace(InvalidDatabaseError=FakeInvalidDatabaseError),
        open_database=open_database,
    )


def test_private_ip_returns_empty() -> None:
    result = geoip_lookup("192.168.1.1")
    assert result == {}

    result = geoip_lookup("10.0.0.1")
    assert result == {}

    result = geoip_lookup("172.16.0.1")
    assert result == {}


def test_loopback_ip_returns_empty() -> None:
    result = geoip_lookup("127.0.0.1")
    assert result == {}

    result = geoip_lookup("::1")
    assert result == {}


def test_invalid_ip_returns_empty() -> None:
    result = geoip_lookup("not-an-ip")
    assert result == {}

    result = geoip_lookup("")
    assert result == {}


def test_no_database_returns_empty() -> None:
    result = geoip_lookup("8.8.8.8")
    assert isinstance(result, dict)


def test_existing_database_without_optional_package_returns_empty(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "GeoLite2-City.mmdb"
    db_path.write_bytes(b"placeholder")
    monkeypatch.setenv("DNS_SPEED_LAB_GEOIP_DB", str(db_path))
    monkeypatch.setattr(geoip, "_load_maxminddb", lambda: None)

    result = geoip_lookup("8.8.8.8")
    assert result == {}


def test_corrupt_database_returns_empty(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "GeoLite2-City.mmdb"
    db_path.write_bytes(b"not a maxmind db")
    monkeypatch.setenv("DNS_SPEED_LAB_GEOIP_DB", str(db_path))

    def raise_invalid(*args, **kwargs):
        del args, kwargs
        raise FakeInvalidDatabaseError("not a valid MaxMind DB file")

    monkeypatch.setattr(geoip, "_load_maxminddb", lambda: _fake_maxminddb(open_database=raise_invalid))

    result = geoip_lookup("8.8.8.8")
    assert result == {}


def test_unreadable_database_returns_empty(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "GeoLite2-City.mmdb"
    db_path.write_bytes(b"placeholder")
    monkeypatch.setenv("DNS_SPEED_LAB_GEOIP_DB", str(db_path))

    def raise_unreadable(*args, **kwargs):
        del args, kwargs
        raise PermissionError("read-only file system")

    monkeypatch.setattr(geoip, "_load_maxminddb", lambda: _fake_maxminddb(open_database=raise_unreadable))

    result = geoip_lookup("8.8.8.8")
    assert result == {}


class _FakeReader:
    def __init__(self, *, raises_on_get: bool) -> None:
        self.closed = False
        self._raises_on_get = raises_on_get

    def get(self, ip: str) -> None:
        del ip
        if self._raises_on_get:
            raise FakeInvalidDatabaseError("corrupt search tree")
        return None

    def close(self) -> None:
        self.closed = True


def test_lookup_failure_returns_empty_and_closes_reader(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "GeoLite2-City.mmdb"
    db_path.write_bytes(b"placeholder")
    monkeypatch.setenv("DNS_SPEED_LAB_GEOIP_DB", str(db_path))
    reader = _FakeReader(raises_on_get=True)
    monkeypatch.setattr(
        geoip,
        "_load_maxminddb",
        lambda: _fake_maxminddb(open_database=lambda *a, **k: reader),
    )

    result = geoip_lookup("8.8.8.8")
    assert result == {}
    assert reader.closed is True


def test_successful_read_closes_reader(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "GeoLite2-City.mmdb"
    db_path.write_bytes(b"placeholder")
    monkeypatch.setenv("DNS_SPEED_LAB_GEOIP_DB", str(db_path))
    reader = _FakeReader(raises_on_get=False)
    monkeypatch.setattr(
        geoip,
        "_load_maxminddb",
        lambda: _fake_maxminddb(open_database=lambda *a, **k: reader),
    )

    result = geoip_lookup("8.8.8.8")
    assert result == {}
    assert reader.closed is True


def test_geoip_endpoint_returns_stable_empty_shape(monkeypatch) -> None:
    monkeypatch.setattr("app.main.geoip_lookup", lambda ip: {})

    response = client.get("/api/geoip?ip=8.8.8.8")
    assert response.status_code == 200
    assert set(response.json().keys()) == {"country_code", "country_name", "region", "city", "source"}
    assert all(value is None for value in response.json().values())


def test_geoip_endpoint_returns_stable_success_shape(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.geoip_lookup",
        lambda ip: {
            "country_code": "CO",
            "country_name": "Colombia",
            "region": "south-america",
            "city": "Bogota",
        },
    )

    response = client.get("/api/geoip?ip=8.8.8.8")
    assert response.status_code == 200
    assert set(response.json().keys()) == {"country_code", "country_name", "region", "city", "source"}
    assert response.json()["country_code"] == "CO"
    assert response.json()["country_name"] == "Colombia"
    assert response.json()["region"] == "south-america"
    assert response.json()["city"] == "Bogota"
    assert response.json()["source"] == "GeoIP database"


def test_geoip_endpoint_without_country_sets_source_none(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.geoip_lookup",
        lambda ip: {"country_code": None, "country_name": None, "region": None, "city": None},
    )

    response = client.get("/api/geoip?ip=8.8.8.8")
    assert response.status_code == 200
    assert response.json()["source"] is None


def test_country_to_region_known() -> None:
    assert _country_to_region("US") == "north-america"
    assert _country_to_region("GB") == "europe"
    assert _country_to_region("BR") == "south-america"
    assert _country_to_region("JP") == "asia"


def test_country_to_region_case_insensitive() -> None:
    assert _country_to_region("us") == "north-america"
    assert _country_to_region("De") == "europe"


def test_country_to_region_unknown() -> None:
    assert _country_to_region("ZZ") is None
    assert _country_to_region("") is None
    assert _country_to_region("AU") is None
    assert _country_to_region("ZA") is None


def test_country_to_region_all_continents() -> None:
    """Verify at least one country from each supported continent maps correctly."""
    assert _country_to_region("ES") == "europe"
    assert _country_to_region("AR") == "south-america"
    assert _country_to_region("MX") == "north-america"
    assert _country_to_region("IN") == "asia"
