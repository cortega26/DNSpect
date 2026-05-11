from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_probe_returns_median_and_failure_rate(monkeypatch) -> None:
    scripted = {
        "1.1.1.1": [
            {"ok": True, "ms": 18.0, "query": "example.com", "error": None, "failure_kind": None},
            {"ok": True, "ms": 22.0, "query": "cloudflare.com", "error": None, "failure_kind": None},
            {"ok": True, "ms": 20.0, "query": "example.com", "error": None, "failure_kind": None},
            {"ok": True, "ms": 24.0, "query": "cloudflare.com", "error": None, "failure_kind": None},
        ],
        "8.8.8.8": [
            {"ok": True, "ms": 30.0, "query": "example.com", "error": None, "failure_kind": None},
            {
                "ok": False,
                "ms": None,
                "query": "cloudflare.com",
                "error": "timeout",
                "failure_kind": "timeout",
            },
            {"ok": True, "ms": 32.0, "query": "example.com", "error": None, "failure_kind": None},
            {
                "ok": False,
                "ms": None,
                "query": "cloudflare.com",
                "error": "timeout",
                "failure_kind": "timeout",
            },
        ],
    }
    cursor = {resolver: 0 for resolver in scripted}

    def fake_measure_query(*, resolver: str, domain: str, timeout_sec: float, engine: str):
        del domain, timeout_sec, engine
        idx = cursor[resolver]
        cursor[resolver] = idx + 1
        sample = dict(scripted[resolver][idx])
        sample["resolver"] = resolver
        return sample

    monkeypatch.setattr("app.runner.measure_query", fake_measure_query)

    response = client.post(
        "/api/probe",
        json={
            "resolvers": ["1.1.1.1", "8.8.8.8"],
            "queries": ["example.com", "cloudflare.com"],
            "runs_per_resolver": 4,
            "timeout_sec": 1.5,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["runs_per_resolver"] == 4
    assert payload["timeout_sec"] == 1.5
    assert len(payload["results"]) == 2

    by_resolver = {item["resolver"]: item for item in payload["results"]}
    assert by_resolver["1.1.1.1"]["stats"]["median_ms"] == 21.0
    assert by_resolver["1.1.1.1"]["stats"]["failure_rate"] == 0.0
    assert by_resolver["8.8.8.8"]["stats"]["median_ms"] == 31.0
    assert by_resolver["8.8.8.8"]["stats"]["failure_rate"] == 0.5


def test_probe_missing_resolver_returns_422() -> None:
    response = client.post("/api/probe", json={})
    assert response.status_code == 422
