"""Local live mode: POST /api/arrange and POST /api/inspect.

  cd engine && ../.venv/bin/uvicorn coverpart.api:app --port 8000

POST /api/arrange { piece_id | upload: {filename, data_base64, movement_index, start_measure, end_measure},
                    roster: {id?, label?, players[]}, planner } -> ArrangeResult
POST /api/inspect { upload: {filename, data_base64} }  (or the two fields at the top level)
                  -> {title, composer, movements[], parts[], limits, notes[]}

Library pieces run the AI planner through whichever backend is available (API key or local `claude -p`).
Uploaded scores get the rule-based planner only ("ai" -> 403), and nothing about them is stored.
"""

from __future__ import annotations

import json
import traceback
import warnings
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import upload as up
from .arrange import arrange
from .cli import piece_meta
from .roster import Roster
from .score_io import load_excerpt

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "corpus" / "manifest.json"
PLANNERS = ("ai", "greedy", "as_written")
AI_DISABLED = ("AI plans for custom bands and uploaded scores need an API key, which isn't enabled. "
               "The 4 preset bands have precomputed AI plans.")
app = FastAPI(title="Cover Part")


class UploadFile(BaseModel):
    filename: str
    data_base64: str


class UploadSelection(UploadFile):
    movement_index: int = 0
    start_measure: int
    end_measure: int


class ArrangeRequest(BaseModel):
    piece_id: str | None = None
    upload: UploadSelection | None = None
    roster: dict
    planner: str = "ai"


class InspectRequest(BaseModel):
    upload: UploadFile | None = None
    filename: str | None = None
    data_base64: str | None = None


def _upload_error(e: up.UploadError) -> HTTPException:
    return HTTPException(e.status, str(e))


@app.post("/api/arrange")
def api_arrange(req: ArrangeRequest) -> dict:
    if (req.piece_id is None) == (req.upload is None):
        raise HTTPException(400, "send either piece_id (a library piece) or upload (your own score), not both")
    if req.planner not in PLANNERS:
        raise HTTPException(400, "planner must be ai, greedy or as_written")
    if req.upload is not None and req.planner == "ai":
        raise HTTPException(403, AI_DISABLED)
    entry = None
    if req.piece_id is not None:
        manifest = json.loads(MANIFEST.read_text())
        entry = next((e for e in manifest["excerpts"] if e["id"] == req.piece_id), None)
        if entry is None:
            raise HTTPException(404, f"unknown piece {req.piece_id}")
    try:
        roster = Roster.from_json(req.roster)
    except (KeyError, ValueError, TypeError, AttributeError) as e:
        raise HTTPException(400, f"bad roster: {e}") from e
    if not 1 <= len(roster.players) <= 8:
        raise HTTPException(400, "roster must have 1-8 players")
    logs: list[str] = []
    if entry is not None:
        ex = load_excerpt(MANIFEST.parent / entry["file"], entry["start_measure"], entry["end_measure"], meta=entry)
        piece, rid = piece_meta(entry), entry["id"]
    else:
        u = req.upload
        try:
            raw = up.decode(u.filename, u.data_base64)
            ex, piece = up.load_upload_excerpt(u.filename, raw, u.movement_index, u.start_measure, u.end_measure)
        except up.UploadError as e:
            raise _upload_error(e) from e
        rid = "upload"
    if entry is not None:
        res = arrange(ex, roster, req.planner, piece=piece, log=logs.append)
    else:
        try:
            res = arrange(ex, roster, req.planner, piece=piece, log=logs.append)
        except Exception as e:  # noqa: BLE001 - an uploaded file can hold notation the engine doesn't handle
            traceback.print_exc()
            raise HTTPException(400, f"Cover Part couldn't arrange bars {ex.start_measure}–{ex.end_measure} of this "
                                     f"file ({type(e).__name__}). Some notation isn't supported yet; try other "
                                     "bars or a simpler export.") from e
    res["result_id"] = f"{rid}__{roster.id}__{req.planner}__live"
    res["log"] = logs
    return res


@app.post("/api/inspect")
def api_inspect(req: InspectRequest) -> dict:
    u = req.upload or (UploadFile(filename=req.filename, data_base64=req.data_base64)
                       if req.filename is not None and req.data_base64 is not None else None)
    if u is None:
        raise HTTPException(400, "send upload: {filename, data_base64}")
    try:
        return up.inspect(u.filename, up.decode(u.filename, u.data_base64))
    except up.UploadError as e:
        raise _upload_error(e) from e


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}
