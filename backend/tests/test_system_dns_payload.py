from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_system_dns_endpoint_includes_error_detail_field(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.runner.detect_system_dns",
        lambda: {
            "resolvers": [],
            "method": "error:RuntimeError",
            "platform": "macos",
            "error_detail": "simulated failure",
        },
    )

    response = client.get("/api/dns/system")
    assert response.status_code == 200
    payload = response.json()
    assert payload["error_detail"] == "simulated failure"
    assert payload["detected_provider_id"] == "isp-detectado"
