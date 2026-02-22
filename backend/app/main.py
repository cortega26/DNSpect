from __future__ import annotations

import csv
import io
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .models import BenchmarkRequest, ProbeRequest
from .runner import BenchmarkManager

app = FastAPI(title="dns-speed-lab API", version=__version__)
manager = BenchmarkManager()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _resolve_frontend_dist() -> Path | None:
    override = os.getenv("DNS_SPEED_LAB_FRONTEND_DIR")
    if override:
        path = Path(override).expanduser().resolve()
        return path if path.exists() else None

    if getattr(sys, "frozen", False):
        frozen_base = Path(getattr(sys, "_MEIPASS", Path.cwd()))
        candidate = frozen_base / "frontend_dist"
        return candidate if candidate.exists() else None

    candidate = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    return candidate if candidate.exists() else None


FRONTEND_DIST = _resolve_frontend_dist()
if FRONTEND_DIST and (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "backend_time_utc": datetime.now(UTC).isoformat(),
    }


@app.get("/api/providers")
def providers() -> list[dict]:
    return manager.providers_payload()


@app.get("/api/dns/system")
def system_dns() -> dict:
    return manager.system_dns_payload()


@app.post("/api/probe")
@app.post("/probe")
def probe_resolvers(request: ProbeRequest) -> dict:
    try:
        return manager.probe(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/benchmarks")
def start_benchmark(request: BenchmarkRequest) -> dict:
    try:
        benchmark_id = manager.start(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"benchmark_id": benchmark_id}


@app.get("/api/benchmarks/{benchmark_id}")
def benchmark_status(
    benchmark_id: str,
    include_samples: bool = Query(default=False, description="Incluye muestras crudas por resolver"),
) -> dict:
    state = manager.get(benchmark_id, include_samples=include_samples)
    if not state:
        raise HTTPException(status_code=404, detail="benchmark no encontrado")
    return state


@app.get("/api/benchmarks/{benchmark_id}/export.json")
def export_json(
    benchmark_id: str,
    include_samples: bool = Query(default=False, description="Incluye muestras crudas por resolver"),
) -> JSONResponse:
    state = manager.get(benchmark_id, include_samples=include_samples)
    if not state:
        raise HTTPException(status_code=404, detail="benchmark no encontrado")
    if state["status"] != "done":
        raise HTTPException(status_code=409, detail="benchmark aún en ejecución")
    payload = json.dumps(state, ensure_ascii=False, indent=2)
    headers = {"Content-Disposition": f'attachment; filename="dns-benchmark-{benchmark_id}.json"'}
    return JSONResponse(content=json.loads(payload), headers=headers)


@app.get("/api/benchmarks/{benchmark_id}/export.csv")
def export_csv(benchmark_id: str) -> StreamingResponse:
    state = manager.get(benchmark_id)
    if not state:
        raise HTTPException(status_code=404, detail="benchmark no encontrado")
    if state["status"] != "done":
        raise HTTPException(status_code=409, detail="benchmark aún en ejecución")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "resolver",
            "provider_id",
            "provider_name",
            "engine",
            "avg_ms",
            "median_ms",
            "p95_ms",
            "min_ms",
            "max_ms",
            "ok_count",
            "timeout_count",
            "success_rate",
            "timeout_rate",
            "success_count",
            "failure_count",
            "failure_rate",
            "consistency_ratio",
            "p95_minus_median_ms",
            "score_latency",
            "score_reliability",
            "score_stability",
            "score_total",
            "normalized_latency",
            "normalized_reliability",
            "normalized_stability",
            "reliability_penalty",
            "max_rel_penalty",
            "is_unreliable",
        ]
    )
    for item in state.get("results", []):
        stats = item["stats"]
        writer.writerow(
            [
                item["resolver"],
                item["provider_id"],
                item["provider_name"],
                item["engine"],
                stats["avg_ms"],
                stats["median_ms"],
                stats["p95_ms"],
                stats["min_ms"],
                stats["max_ms"],
                stats["ok_count"],
                stats["timeout_count"],
                stats["success_rate"],
                stats["timeout_rate"],
                stats.get("success_count"),
                stats.get("failure_count"),
                stats.get("failure_rate"),
                stats["consistency_ratio"],
                stats["p95_minus_median_ms"],
                stats.get("score_latency"),
                stats.get("score_reliability"),
                stats.get("score_stability"),
                stats.get("score_total"),
                stats.get("normalized_latency"),
                stats.get("normalized_reliability"),
                stats.get("normalized_stability"),
                stats.get("reliability_penalty"),
                stats.get("max_rel_penalty"),
                item.get("is_unreliable"),
            ]
        )

    output.seek(0)
    headers = {"Content-Disposition": f'attachment; filename="dns-benchmark-{benchmark_id}.csv"'}
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers=headers)


@app.get("/")
def root_ui() -> Response:
    if FRONTEND_DIST and (FRONTEND_DIST / "index.html").exists():
        return FileResponse(FRONTEND_DIST / "index.html")
    return JSONResponse({"status": "ok", "message": "UI estática no disponible. Usa frontend en modo dev."})


@app.get("/{full_path:path}")
def spa_fallback(full_path: str) -> Response:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="ruta no encontrada")

    if not FRONTEND_DIST:
        raise HTTPException(status_code=404, detail="UI estática no disponible")

    requested = (FRONTEND_DIST / full_path).resolve()
    if requested.is_file() and str(requested).startswith(str(FRONTEND_DIST)):
        return FileResponse(requested)

    index_file = FRONTEND_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="UI estática no disponible")
