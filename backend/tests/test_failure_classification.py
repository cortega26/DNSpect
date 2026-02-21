import dns.exception
import dns.resolver

from app.runner import classify_dnspython_exception, classify_failure_from_text


def test_classify_dnspython_core_exceptions() -> None:
    assert classify_dnspython_exception(dns.exception.Timeout()) == "timeout"
    assert classify_dnspython_exception(dns.resolver.NXDOMAIN()) == "nxdomain"
    assert classify_dnspython_exception(dns.resolver.NoAnswer()) == "noanswer"


def test_classify_failure_from_text_keywords() -> None:
    assert classify_failure_from_text("rcode: SERVFAIL") == "servfail"
    assert classify_failure_from_text("resolver said REFUSED") == "refused"
    assert classify_failure_from_text("operation timeout") == "timeout"
    assert classify_failure_from_text("rcode: NXDOMAIN") == "nxdomain"
