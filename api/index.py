"""Vercel Python function: the engine behind the live site.

  POST /api/arrange   { piece_id | upload, roster: {id?, label?, players[]}, planner: "greedy" | "ai" } -> ArrangeResult
                      upload = {filename, data_base64, movement_index, start_measure, end_measure}: a director's
                      own MusicXML, arranged live with the rule-based planner (never AI), not stored
  POST /api/inspect   { upload: {filename, data_base64} } -> {title, composer, movements[], parts[], limits, notes[]}
  GET  /api/health    { ok: true, ai: false, upload: true }   (ai: whether this deploy can run the AI planner)

vercel.json rewrites /api/(.*) to this file; FastAPI routes on the original path. Validation, the
rule-based ("greedy") planner, the checker and the export are the engine's own code
(engine/coverpart/api.py), unchanged. The one difference from local dev is the AI planner: here it
needs ANTHROPIC_API_KEY (and the anthropic SDK, which requirements.txt leaves out), so without them an
"ai" request gets 403 instead of trying a `claude -p` binary that does not exist on Vercel. The 4 preset
bands' AI plans are precomputed files the site serves statically.

Local dev does not use this file: cd engine && ../.venv/bin/uvicorn coverpart.api:app --port 8000
"""

from __future__ import annotations

import importlib.util
import os
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from coverpart import api as core  # noqa: E402

AI_DISABLED = core.AI_DISABLED  # one message: custom bands and uploaded scores get no live AI


def ai_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY")) and importlib.util.find_spec("anthropic") is not None


app = FastAPI(title="Cover Part", docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(Exception)
def engine_error(_: Request, exc: Exception) -> JSONResponse:
    traceback.print_exc()
    return JSONResponse({"detail": f"The engine failed on this request ({type(exc).__name__})."}, status_code=500)


@app.post("/api/arrange")
def arrange(req: core.ArrangeRequest) -> dict:
    if req.planner == "ai" and (req.upload is not None or not ai_available()):
        raise HTTPException(403, AI_DISABLED)
    return core.api_arrange(req)


@app.post("/api/inspect")
def inspect(req: core.InspectRequest) -> dict:
    return core.api_inspect(req)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "ai": ai_available(), "upload": True}
