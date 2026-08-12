"""SPA fallback containment tests (plan 035, SEC-02)."""

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.main import spa_fallback

TRAVERSAL_PATHS = [
    "../secret.txt",
    "assets/../../secret.txt",
    "dist-backup/leak.txt",
    "assets/../dist-backup/leak.txt",
    "%2e%2e/secret.txt",
]


def _make_fixture(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "assets" / "app.js").write_text("APPJS", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("SECRET-PARENT", encoding="utf-8")
    sibling = tmp_path / "dist-backup"
    sibling.mkdir()
    (sibling / "leak.txt").write_text("LEAK-SIBLING", encoding="utf-8")
    return dist.resolve()


def test_spa_fallback_rejects_traversal_with_404(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    dist = _make_fixture(tmp_path)
    monkeypatch.setattr("app.main.FRONTEND_DIST", dist)

    for crafted in TRAVERSAL_PATHS:
        with pytest.raises(HTTPException) as exc:
            spa_fallback(crafted)
        assert exc.value.status_code == 404, crafted


def test_spa_fallback_never_serves_files_outside_dist(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    dist = _make_fixture(tmp_path)
    (dist / "index.html").write_text("INDEX", encoding="utf-8")
    monkeypatch.setattr("app.main.FRONTEND_DIST", dist)

    assert Path(spa_fallback("assets/app.js").path) == dist / "assets" / "app.js"
    assert Path(spa_fallback("nope.js").path) == dist / "index.html"

    leaked = {tmp_path.resolve() / "secret.txt", tmp_path.resolve() / "dist-backup" / "leak.txt"}
    for crafted in TRAVERSAL_PATHS:
        try:
            resp = spa_fallback(crafted)
        except HTTPException:
            continue
        assert Path(resp.path) not in leaked, crafted
