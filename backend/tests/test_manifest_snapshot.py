from __future__ import annotations

import json
import uuid

from app.models import BenchmarkProtocol, BenchmarkRequest, SelectionSource, TargetSnapshot
from app.runner import BenchmarkManager, ComparisonReasonCode, _build_run_manifest


def _make_manager(tmp_path) -> BenchmarkManager:
    return BenchmarkManager(
        max_concurrent_jobs=1,
        max_queued_jobs=1,
        terminal_ttl_sec=600,
        data_runs_dir=tmp_path / "runs",
    )


def _request(**overrides) -> BenchmarkRequest:
    defaults: dict = {"mode": "quick", "goal": "speed"}
    defaults.update(overrides)
    return BenchmarkRequest(**defaults)


def test_config_synthesis_manual_resolvers(tmp_path) -> None:
    manager = _make_manager(tmp_path)
    cfg = manager._build_config(_request(resolvers=["1.1.1.1", "8.8.8.8"]))
    assert cfg.target_snapshot is not None
    assert cfg.target_snapshot["resolver_ips"] == ["1.1.1.1", "8.8.8.8"]
    assert cfg.target_snapshot["selection_source"] == "manual"
    assert cfg.target_snapshot["provider_ids"] == {"1.1.1.1": "cloudflare", "8.8.8.8": "google"}


def test_config_synthesis_default_resolvers(tmp_path) -> None:
    manager = _make_manager(tmp_path)
    cfg = manager._build_config(_request())
    assert cfg.target_snapshot is not None
    assert cfg.target_snapshot["resolver_ips"] == cfg.resolvers
    assert cfg.target_snapshot["selection_source"] == "catalog"
    provider_ids = cfg.target_snapshot["provider_ids"] or {}
    assert provider_ids
    assert set(provider_ids).issubset(set(cfg.target_snapshot["resolver_ips"]))


def test_config_synthesis_respects_protocol_filter(tmp_path) -> None:
    manager = _make_manager(tmp_path)
    req = _request(
        resolvers=["1.1.1.1", "192.168.1.1"],
        protocol=BenchmarkProtocol.dot,
    )
    cfg = manager._build_config(req)
    assert cfg.resolvers == ["1.1.1.1"]
    assert cfg.target_snapshot is not None
    assert cfg.target_snapshot["resolver_ips"] == cfg.resolvers
    assert "192.168.1.1" not in cfg.target_snapshot["resolver_ips"]


def test_request_snapshot_passthrough_unchanged(tmp_path) -> None:
    manager = _make_manager(tmp_path)
    snap = TargetSnapshot(resolver_ips=["9.9.9.9"], selection_source=SelectionSource.manual)
    cfg = manager._build_config(_request(resolvers=["9.9.9.9"], target_snapshot=snap))
    assert cfg.target_snapshot == snap.model_dump()


def test_manifest_contains_synthesized_snapshot(tmp_path) -> None:
    manager = _make_manager(tmp_path)
    cfg = manager._build_config(_request(resolvers=["1.1.1.1"]))
    manifest = _build_run_manifest(cfg, manager.provider_index, manager.blocking_test_queries)
    assert manifest.target_snapshot == cfg.target_snapshot


def _write_done_run(tmp_path, run_id: str, manifest: dict) -> None:
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    (runs_dir / f"{run_id}.json").write_text(
        json.dumps({"id": run_id, "status": "done", "manifest": manifest}), encoding="utf-8"
    )


def test_different_resolver_sets_are_not_comparable(tmp_path) -> None:
    manager = _make_manager(tmp_path)
    baseline_cfg = manager._build_config(_request(resolvers=["1.1.1.1"]))
    candidate_cfg = manager._build_config(_request(resolvers=["8.8.8.8"]))
    baseline_manifest = _build_run_manifest(
        baseline_cfg, manager.provider_index, manager.blocking_test_queries
    )
    candidate_manifest = _build_run_manifest(
        candidate_cfg, manager.provider_index, manager.blocking_test_queries
    )
    baseline_id = uuid.uuid4().hex
    candidate_id = uuid.uuid4().hex
    _write_done_run(tmp_path, baseline_id, baseline_manifest.model_dump())
    _write_done_run(tmp_path, candidate_id, candidate_manifest.model_dump())

    response = manager.compare_runs(baseline_id, candidate_id)
    assert response is not None
    assert response.comparable is False
    assert ComparisonReasonCode.target_snapshot_mismatch in response.reason_codes
