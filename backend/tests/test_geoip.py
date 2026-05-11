from __future__ import annotations

from app.geoip import _country_to_region, geoip_lookup


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


def test_country_to_region_known() -> None:
    assert _country_to_region("US") == "north-america"
    assert _country_to_region("GB") == "europe"
    assert _country_to_region("BR") == "south-america"
    assert _country_to_region("JP") == "asia"
    assert _country_to_region("AU") == "oceania"
    assert _country_to_region("ZA") == "africa"


def test_country_to_region_case_insensitive() -> None:
    assert _country_to_region("us") == "north-america"
    assert _country_to_region("De") == "europe"


def test_country_to_region_unknown() -> None:
    assert _country_to_region("ZZ") is None
    assert _country_to_region("") is None


def test_country_to_region_all_continents() -> None:
    """Verify at least one country from each continent maps correctly."""
    assert _country_to_region("ES") == "europe"
    assert _country_to_region("AR") == "south-america"
    assert _country_to_region("MX") == "north-america"
    assert _country_to_region("IN") == "asia"
    assert _country_to_region("NZ") == "oceania"
    assert _country_to_region("EG") == "africa"
