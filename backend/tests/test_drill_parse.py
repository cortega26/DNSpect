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
