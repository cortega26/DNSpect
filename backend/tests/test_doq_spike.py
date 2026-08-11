"""Plan 022 spike tests: mocked DoQ transport, no network, no aioquic."""

import dns.exception
import dns.message
import dns.rrset
import doq_query_spike


def _response_with_a_record() -> dns.message.Message:
    q = dns.message.make_query("example.com", "A")
    response = dns.message.make_response(q)
    response.answer.append(dns.rrset.from_text("example.com.", 300, "IN", "A", "1.2.3.4"))
    return response


def test_query_quic_success_returns_sample():
    def fake_transport(q, server, timeout=None, port=853, server_hostname=None):
        return _response_with_a_record()

    sample = doq_query_spike.query_quic("example.com", "1.2.3.4", 2.0, transport=fake_transport)
    assert sample["ok"] is True
    assert sample["failure_kind"] is None
    assert sample["ms"] is not None
    assert sample["answer_ips"] == ["1.2.3.4"]


def test_query_quic_timeout_maps_failure_kind():
    def fake_transport(q, server, timeout=None, port=853, server_hostname=None):
        raise dns.exception.Timeout()

    sample = doq_query_spike.query_quic("example.com", "1.2.3.4", 2.0, transport=fake_transport)
    assert sample["ok"] is False
    assert sample["ms"] is None
    assert sample["failure_kind"] == "timeout"


def test_query_quic_have_quic_false_reports_doq_unavailable(monkeypatch):
    monkeypatch.setattr(doq_query_spike, "_have_quic", lambda: False)
    sample = doq_query_spike.query_quic("example.com", "1.2.3.4", 2.0)
    assert sample["ok"] is False
    assert sample["failure_kind"] == "doq_unavailable"


def test_query_quic_server_name_passed_to_transport():
    received = {}

    def fake_transport(q, server, timeout=None, port=853, server_hostname=None):
        received["server_hostname"] = server_hostname
        return _response_with_a_record()

    doq_query_spike.query_quic(
        "example.com", "1.2.3.4", 2.0, server_hostname="dns.quad9.net", transport=fake_transport
    )
    assert received["server_hostname"] == "dns.quad9.net"


def test_eligibility_doq_branch():
    assert doq_query_spike.doq_endpoint_eligibility({"doq": "yes", "doq_hostname": "dns.quad9.net"}) == (
        "dns.quad9.net",
        None,
    )
    assert doq_query_spike.doq_endpoint_eligibility({"doq": "yes"}) == (None, "doq_hostname_missing")
    assert doq_query_spike.doq_endpoint_eligibility({"doq": "yes", "doq_hostname": "-not-a-hostname"}) == (
        None,
        "doq_hostname_invalid",
    )
    assert doq_query_spike.doq_endpoint_eligibility({}) == (None, "doq_hostname_missing")
