from __future__ import annotations

import ipaddress
import os
from pathlib import Path
from typing import Any

from .providers import DATA_ROOT


def _resolve_db_path() -> Path | None:
    override = os.getenv("DNS_SPEED_LAB_GEOIP_DB")
    if override:
        path = Path(override).expanduser().resolve()
        if path.exists():
            return path
        return None
    candidate = DATA_ROOT / "GeoLite2-City.mmdb"
    return candidate if candidate.exists() else None


def _load_maxminddb() -> Any | None:
    """Import the optional maxminddb package, or None when it is unavailable."""
    try:
        import maxminddb  # type: ignore[import-untyped]
    except (ImportError, ModuleNotFoundError):
        return None
    return maxminddb


def _open_geoip_reader(db_path: Path) -> Any | None:
    """Open the GeoIP reader, or return None for expected component failures.

    Expected failures are the optional maxminddb package being absent, an
    unavailable/unreadable database path (OSError), the documented maxminddb
    invalid-database error, and the ValueError raised when an empty or
    unusable file cannot be mapped.
    """
    maxminddb = _load_maxminddb()
    if maxminddb is None:
        return None

    try:
        return maxminddb.open_database(str(db_path), maxminddb.MODE_AUTO)
    except (OSError, ValueError):
        return None
    except maxminddb.errors.InvalidDatabaseError:
        return None


def _expected_geoip_read_errors() -> tuple[type[BaseException], ...]:
    """Reader errors that mean 'GeoIP unavailable' rather than a bug."""
    maxminddb = _load_maxminddb()
    if maxminddb is None:
        return (OSError, ValueError)
    return (OSError, ValueError, maxminddb.errors.InvalidDatabaseError)


def geoip_lookup(client_ip: str) -> dict[str, Any]:
    """Look up the client IP in the GeoIP database.

    Returns a dict with country_code, country_name, and region info,
    or an empty dict if the database is unavailable or the IP is private.
    """
    try:
        addr = ipaddress.ip_address(client_ip)
    except ValueError:
        return {}

    if addr.is_private or addr.is_loopback:
        return {}

    db_path = _resolve_db_path()
    if db_path is None:
        return {}

    reader = _open_geoip_reader(db_path)
    if reader is None:
        return {}

    try:
        result = reader.get(client_ip)
    except _expected_geoip_read_errors():
        return {}
    finally:
        reader.close()

    if not result:
        return {}

    country = result.get("country") or result.get("registered_country") or {}
    city = result.get("city") or {}

    return {
        "country_code": (country.get("iso_code") or "").upper() or None,
        "country_name": (country.get("names") or {}).get("en") or None,
        "region": _country_to_region(country.get("iso_code") or ""),
        "city": (city.get("names") or {}).get("en") or None,
    }


def _country_to_region(country_code: str) -> str | None:
    mapping = {
        "global": "global",
        # Europe
        "AL": "europe",
        "AT": "europe",
        "BA": "europe",
        "BE": "europe",
        "BG": "europe",
        "BY": "europe",
        "CH": "europe",
        "CY": "europe",
        "CZ": "europe",
        "DE": "europe",
        "DK": "europe",
        "EE": "europe",
        "ES": "europe",
        "FI": "europe",
        "FR": "europe",
        "GB": "europe",
        "GR": "europe",
        "HR": "europe",
        "HU": "europe",
        "IE": "europe",
        "IS": "europe",
        "IT": "europe",
        "LI": "europe",
        "LT": "europe",
        "LU": "europe",
        "LV": "europe",
        "MD": "europe",
        "ME": "europe",
        "MK": "europe",
        "MT": "europe",
        "NL": "europe",
        "NO": "europe",
        "PL": "europe",
        "PT": "europe",
        "RO": "europe",
        "RS": "europe",
        "SE": "europe",
        "SI": "europe",
        "SK": "europe",
        "UA": "europe",
        "XK": "europe",
        # South America
        "AR": "south-america",
        "BO": "south-america",
        "BR": "south-america",
        "CL": "south-america",
        "CO": "south-america",
        "EC": "south-america",
        "GY": "south-america",
        "PE": "south-america",
        "PY": "south-america",
        "SR": "south-america",
        "UY": "south-america",
        "VE": "south-america",
        # North America
        "AG": "north-america",
        "AI": "north-america",
        "AW": "north-america",
        "BB": "north-america",
        "BM": "north-america",
        "BS": "north-america",
        "BZ": "north-america",
        "CA": "north-america",
        "CR": "north-america",
        "CU": "north-america",
        "DM": "north-america",
        "DO": "north-america",
        "GD": "north-america",
        "GL": "north-america",
        "GT": "north-america",
        "HN": "north-america",
        "HT": "north-america",
        "JM": "north-america",
        "KN": "north-america",
        "KY": "north-america",
        "LC": "north-america",
        "MX": "north-america",
        "NI": "north-america",
        "PA": "north-america",
        "PR": "north-america",
        "SV": "north-america",
        "TC": "north-america",
        "TT": "north-america",
        "US": "north-america",
        "VC": "north-america",
        "VG": "north-america",
        "VI": "north-america",
        # Asia
        "AE": "asia",
        "AF": "asia",
        "AM": "asia",
        "AZ": "asia",
        "BD": "asia",
        "BH": "asia",
        "BN": "asia",
        "BT": "asia",
        "CC": "asia",
        "CN": "asia",
        "GE": "asia",
        "HK": "asia",
        "ID": "asia",
        "IL": "asia",
        "IN": "asia",
        "IQ": "asia",
        "IR": "asia",
        "JO": "asia",
        "JP": "asia",
        "KG": "asia",
        "KH": "asia",
        "KP": "asia",
        "KR": "asia",
        "KW": "asia",
        "KZ": "asia",
        "LA": "asia",
        "LB": "asia",
        "LK": "asia",
        "MM": "asia",
        "MN": "asia",
        "MO": "asia",
        "MV": "asia",
        "MY": "asia",
        "NP": "asia",
        "OM": "asia",
        "PH": "asia",
        "PK": "asia",
        "PS": "asia",
        "QA": "asia",
        "SA": "asia",
        "SG": "asia",
        "SY": "asia",
        "TH": "asia",
        "TJ": "asia",
        "TL": "asia",
        "TM": "asia",
        "TR": "asia",
        "TW": "asia",
        "UZ": "asia",
        "VN": "asia",
        "YE": "asia",
    }
    return mapping.get(country_code.upper())
