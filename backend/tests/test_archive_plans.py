"""Regression tests for scripts/archive_plans.py link rewriting."""

import importlib.util
from pathlib import Path
from types import ModuleType


def _load_archive_plans() -> ModuleType:
    script = Path(__file__).resolve().parents[2] / "scripts" / "archive_plans.py"
    spec = importlib.util.spec_from_file_location("archive_plans", script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _fake_git_mv(command: list[str], check: bool = True) -> None:
    Path(command[2]).rename(command[3])


def test_archive_rewrites_only_the_moved_rows_link(tmp_path: Path, monkeypatch) -> None:
    plans = tmp_path / "plans"
    plans.mkdir()
    (plans / "007-foo.md").write_text("plan 007", encoding="utf-8")
    (plans / "999-bar.md").write_text("plan 999", encoding="utf-8")
    index = plans / "README.md"
    index.write_text(
        "| [007-foo](007-foo.md) | P1 / M | — | **Complete** |\n| [999-bar](999-bar.md) | P3 / L | — | |\n",
        encoding="utf-8",
    )

    module = _load_archive_plans()
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "PLANS_DIR", plans)
    monkeypatch.setattr(module, "ARCHIVE_DIR", plans / "archive")
    monkeypatch.setattr(module, "INDEX", index)
    monkeypatch.setattr("subprocess.run", _fake_git_mv)

    assert module.main() == 0

    assert not (plans / "007-foo.md").exists()
    assert (plans / "archive" / "007-foo.md").is_file()
    assert (plans / "999-bar.md").is_file()

    rewritten = index.read_text(encoding="utf-8")
    assert "| [007-foo](archive/007-foo.md) | P1 / M | — | **Complete** |" in rewritten
    assert "| [999-bar](999-bar.md) | P3 / L | — | |" in rewritten


def test_archive_with_nothing_to_move_does_not_touch_the_index(tmp_path: Path, monkeypatch) -> None:
    plans = tmp_path / "plans"
    plans.mkdir()
    index = plans / "README.md"
    original = "| [007-foo](archive/007-foo.md) | P1 / M | — | **Complete** |\n"
    index.write_text(original, encoding="utf-8")

    module = _load_archive_plans()
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "PLANS_DIR", plans)
    monkeypatch.setattr(module, "ARCHIVE_DIR", plans / "archive")
    monkeypatch.setattr(module, "INDEX", index)

    assert module.main() == 0

    assert index.read_text(encoding="utf-8") == original
