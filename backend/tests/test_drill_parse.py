from app.runner import run_drill_query
from app.stats import parse_drill_query_time


def test_parse_drill_output_ok():
    output = """
;; ->>HEADER<<- opcode: QUERY, rcode: NOERROR, id: 30498
;; Query time: 37 msec
;; SERVER: 1.1.1.1
"""
    assert parse_drill_query_time(output) == 37.0


def test_parse_drill_output_missing_time():
    output = ";; some drill output without timing"
    assert parse_drill_query_time(output) is None


def test_drill_timed_nxdomain_is_failure(monkeypatch) -> None:
    output = """\
;; ->>HEADER<<- opcode: QUERY, rcode: NXDOMAIN, id: 123
;; Query time: 12 msec
;; ANSWER:
test.example.com.    60    IN    A    1.2.3.4
"""

    class FakeProc:
        stdout = output
        stderr = ""

    monkeypatch.setattr("subprocess.run", lambda *args, **kwargs: FakeProc())
    result = run_drill_query("8.8.8.8", "test.example.com", 2.0)
    assert result["ok"] is False
    assert result["ms"] is None
    assert result["failure_kind"] == "nxdomain"


def test_drill_timed_servfail_is_failure(monkeypatch) -> None:
    output = """\
;; ->>HEADER<<- opcode: QUERY, rcode: SERVFAIL, id: 456
;; Query time: 8 msec
;; ANSWER:
"""

    class FakeProc:
        stdout = output
        stderr = ""

    monkeypatch.setattr("subprocess.run", lambda *args, **kwargs: FakeProc())
    result = run_drill_query("8.8.8.8", "test.example.com", 2.0)
    assert result["ok"] is False
    assert result["ms"] is None
    assert result["failure_kind"] == "servfail"


def test_drill_timed_refused_is_failure(monkeypatch) -> None:
    output = """\
;; ->>HEADER<<- opcode: QUERY, rcode: REFUSED, id: 789
;; Query time: 5 msec
;; ANSWER:
"""

    class FakeProc:
        stdout = output
        stderr = ""

    monkeypatch.setattr("subprocess.run", lambda *args, **kwargs: FakeProc())
    result = run_drill_query("8.8.8.8", "test.example.com", 2.0)
    assert result["ok"] is False
    assert result["ms"] is None
    assert result["failure_kind"] == "refused"


def test_drill_timed_unknown_rcode_is_other(monkeypatch) -> None:
    output = """\
;; ->>HEADER<<- opcode: QUERY, rcode: FORMERR, id: 999
;; Query time: 3 msec
;; ANSWER:
"""

    class FakeProc:
        stdout = output
        stderr = ""

    monkeypatch.setattr("subprocess.run", lambda *args, **kwargs: FakeProc())
    result = run_drill_query("8.8.8.8", "test.example.com", 2.0)
    assert result["ok"] is False
    assert result["ms"] is None
    assert result["failure_kind"] == "other"


def test_drill_timed_noerror_is_success(monkeypatch) -> None:
    output = """\
;; ->>HEADER<<- opcode: QUERY, rcode: NOERROR, id: 555
;; Query time: 10 msec
;; ANSWER:
example.com.    60    IN    A    93.184.216.34
"""

    class FakeProc:
        stdout = output
        stderr = ""

    monkeypatch.setattr("subprocess.run", lambda *args, **kwargs: FakeProc())
    result = run_drill_query("1.1.1.1", "example.com", 2.0)
    assert result["ok"] is True
    assert result["ms"] is not None
    assert result["failure_kind"] is None
