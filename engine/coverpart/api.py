"""Local live mode: POST /api/arrange.

  cd engine && ../.venv/bin/uvicorn coverpart.api:app --port 8000

Runs the AI planner through whichever backend is available (API key or local `claude -p`).
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .arrange import arrange
from .cli import piece_meta
from .roster import Roster
from .score_io import load_excerpt

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "corpus" / "manifest.json"
app = FastAPI(title="Cover Part")


class ArrangeRequest(BaseModel):
    piece_id: str
    roster: dict
    planner: str = "ai"


@app.post("/api/arrange")
def api_arrange(req: ArrangeRequest) -> dict:
    manifest = json.loads(MANIFEST.read_text())
    entry = next((e for e in manifest["excerpts"] if e["id"] == req.piece_id), None)
    if entry is None:
        raise HTTPException(404, f"unknown piece {req.piece_id}")
    if req.planner not in ("ai", "greedy"):
        raise HTTPException(400, "planner must be ai or greedy")
    try:
        roster = Roster.from_json(req.roster)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, f"bad roster: {e}") from e
    if not 1 <= len(roster.players) <= 8:
        raise HTTPException(400, "roster must have 1-8 players")
    logs: list[str] = []
    ex = load_excerpt(MANIFEST.parent / entry["file"], entry["start_measure"], entry["end_measure"], meta=entry)
    res = arrange(ex, roster, req.planner, piece=piece_meta(entry), log=logs.append)
    res["result_id"] = f"{entry['id']}__{roster.id}__{req.planner}__live"
    res["log"] = logs
    return res


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}
