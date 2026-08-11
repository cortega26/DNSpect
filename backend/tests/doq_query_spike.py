"""Plan 022 spike: prototype of the DNS-over-QUIC query path.

This module is a design spike, not production code. It produces the same
sample-dict shape as ``app.runner.run_dnspython_query`` (fields ``ok``,
``ms``, ``answer_ips``, ``failure_kind``, ``error``, ``query``) so the DoQ
integration can be judged without landing anything in ``app/``.

The real network path (``dns.query.quic``) is gated on ``dns.quic.have_quic``
which is False unless the optional ``aioquic`` package is installed. The
transport is injectable so tests mock it; the real path is only exercised by
the manual validation commands documented in ``docs/DOQ_SUPPORT.md``.
"""

from __future__ import annotations

from time import perf_counter

import dns.exception
import dns.message
import dns.query
import dns.quic
import dns.rcode
import dns.rdatatype

from app.providers import is_valid_dns_hostname

DEFAULT_DOQ_PORT = 853

QUIC_UNAVAILABLE_MESSAGE = "DoQ unavailable: aioquic extra not installed"


def _rcode_to_failure_kind(rcode_str: str) -> str | None:
    """Spike-local copy of ``app.runner._rcode_to_failure_kind`` (runner.py:585)."""
    upper = rcode_str.upper()
    if upper == "NOERROR":
        return None
    if upper == "NXDOMAIN":
        return "nxdomain"
    if upper == "SERVFAIL":
        return "servfail"
    if upper == "REFUSED":
        return "refused"
    return "other"


def _failure_sample(domain: str, failure_kind: str, error: str) -> dict:
    return {
        "ok": False,
        "ms": None,
        "query": domain,
        "error": error,
        "failure_kind": failure_kind,
    }


def _have_quic() -> bool:
    """Gate mirroring dnspython 2.7.0's capability flag (dns.quic.have_quic)."""
    return dns.quic.have_quic


def query_quic(
    domain: str,
    server: str,
    timeout_sec: float,
    port: int = DEFAULT_DOQ_PORT,
    server_hostname: str | None = None,
    transport: object | None = None,
) -> dict:
    """Run a single A query over DoQ, returning a sample dict.

    ``transport`` is injectable for tests; when None the real
    ``dns.query.quic`` path is used, gated on ``dns.quic.have_quic``
    (degradation path returns ``failure_kind="doq_unavailable"``).
    """
    if transport is None:
        if not _have_quic():
            return _failure_sample(domain, "doq_unavailable", QUIC_UNAVAILABLE_MESSAGE)
        transport = dns.query.quic
    q = dns.message.make_query(domain, "A")
    start = perf_counter()
    try:
        response = transport(
            q,
            server,
            timeout=timeout_sec,
            port=port,
            server_hostname=server_hostname,
        )
        elapsed_ms = (perf_counter() - start) * 1000.0
    except dns.exception.Timeout:
        return _failure_sample(domain, "timeout", "QUIC timeout")
    except dns.query.NoDOQ:
        return _failure_sample(domain, "doq_unavailable", QUIC_UNAVAILABLE_MESSAGE)
    except Exception as exc:  # noqa: BLE001 - connection errors map to "other"
        return _failure_sample(domain, "other", str(exc))
    rcode = dns.rcode.to_text(response.rcode())
    failure_kind = _rcode_to_failure_kind(rcode)
    if failure_kind is not None:
        return {
            "ok": False,
            "ms": None,
            "query": domain,
            "error": f"DNS RCODE: {rcode}",
            "failure_kind": failure_kind,
        }
    answer_ips = [
        str(rr.address)
        for ans in response.answer
        for rr in ans
        if rr.rdtype in (dns.rdatatype.A, dns.rdatatype.AAAA)
    ]
    return {
        "ok": True,
        "ms": round(elapsed_ms, 3),
        "query": domain,
        "error": None,
        "failure_kind": None,
        "answer_ips": answer_ips,
    }


def doq_endpoint_eligibility(features: dict) -> tuple[str | None, str | None]:
    """Spike-local port of the runner.py:315-339 doq branch.

    Returns ``(endpoint, exclusion_code)``: hostname present and syntactically
    valid -> ``(hostname, None)``; missing -> ``doq_hostname_missing``;
    invalid -> ``doq_hostname_invalid``.
    """
    if features.get("doq") != "yes":
        return None, "doq_hostname_missing"
    hostname = features.get("doq_hostname")
    if not isinstance(hostname, str) or not hostname.strip():
        return None, "doq_hostname_missing"
    if not is_valid_dns_hostname(hostname):
        return None, "doq_hostname_invalid"
    return hostname, None
