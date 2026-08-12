from __future__ import annotations

from types import SimpleNamespace

from app.cli import _start_watch_scheduler_if_enabled


def test_watch_scheduler_gate_on(monkeypatch) -> None:
    started: list[str] = []
    scheduler = SimpleNamespace(start=lambda: started.append("start"))
    monkeypatch.setattr("app.main.manager", SimpleNamespace(_watch_scheduler=scheduler))
    monkeypatch.delenv("DNS_SPEED_LAB_WATCH_ENABLED", raising=False)
    _start_watch_scheduler_if_enabled()
    assert started == ["start"]


def test_watch_scheduler_gate_off(monkeypatch) -> None:
    started: list[str] = []
    scheduler = SimpleNamespace(start=lambda: started.append("start"))
    monkeypatch.setattr("app.main.manager", SimpleNamespace(_watch_scheduler=scheduler))
    monkeypatch.setenv("DNS_SPEED_LAB_WATCH_ENABLED", "0")
    _start_watch_scheduler_if_enabled()
    assert started == []
