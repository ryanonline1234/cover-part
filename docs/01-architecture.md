# 01 — Architecture and the engine ↔ web contract

Cover Part takes a score (MusicXML) and a roster of the players a group actually has, and produces playable parts for that roster. An AI decides which lines matter and who covers them; plain code transposes, executes the plan and checks every note against every player's range.

## Layout

```
engine/coverpart/     Python package (music21). Pure functions + a CLI + a FastAPI app.
  instruments.py      instrument table: transposition, clef, GM program, written ranges per level
  score_io.py         load MusicXML, cut an excerpt, segment into phrases, summarize each part/segment
  plan.py             plan schema + validation (completeness, overlaps, essential coverage)
  planner_ai.py       prompt + LLM call (Anthropic SDK if ANTHROPIC_API_KEY, else local `claude -p`)
  planner_greedy.py   no-AI baseline: top voice = melody, bottom = bass, best range fit
  execute.py          apply a plan → arranged score; range check; repair; coverage report
  export.py           MusicXML (score + per-player written-pitch parts) and MIDI (base64)
  cli.py              `python -m coverpart.cli <piece> --roster <preset> --planner ai|greedy --out web/public/demos/`
  api.py              FastAPI: POST /api/arrange
corpus/               CC0 excerpts (OpenScore String Quartets) + manifest.json
web/                  Vite + React + TS frontend; reads web/public/demos/*.json, or POSTs /api/arrange
```

## Pitch conventions

- Internally everything is **concert (sounding) pitch**.
- Ranges are authored in **written pitch** per instrument (how directors think) and converted to sounding pitch with the instrument's transposition.
- Per-player part exports are in **written pitch** with the instrument's usual clef. The full arranged score export is in concert pitch.

## ArrangeResult JSON (what the engine emits, what the web renders)

One file per (piece, roster, planner) at `web/public/demos/<result_id>.json`, plus `web/public/demos/index.json`.

```jsonc
{
  "result_id": "osq-arriaga1-m1-17__winds4__ai",
  "piece": {
    "id": "osq-arriaga1-m1-17",
    "title": "String Quartet No. 1 in D minor", "composer": "Juan Crisóstomo de Arriaga",
    "movement": "I", "measures": [1, 17],
    "source": "OpenScore String Quartets (CC0)", "source_url": "https://github.com/OpenScore/StringQuartets"
  },
  "source_parts": [
    { "id": "P1", "name": "Violin I", "instrument": "violin", "color": "#B3261E" }
  ],
  "roster": {
    "id": "winds4", "label": "Flute, clarinet, alto sax, bassoon",
    "players": [
      { "id": "fl", "label": "Flute", "instrument": "flute", "level": "intermediate",
        "range_written": ["D4", "G6"], "range_sounding": ["D4", "G6"] }
    ]
  },
  "planner": "ai",                       // "ai" | "greedy" | "as_written" (why-page demo data only)
  "model": "claude-opus-5-5",            // null for greedy
  "plan": {
    "summary": "One paragraph: the musical idea of the cover.",
    "roles": [ { "source_part": "P1", "start_measure": 1, "end_measure": 8, "role": "melody" } ],
    "assignments": [
      { "source_part": "P1", "start_measure": 1, "end_measure": 8, "player": "fl",
        "octave_shift": 0, "chord_policy": "top", "reason": "…" }
    ],
    "dropped": [ { "source_part": "P2", "start_measure": 9, "end_measure": 12, "reason": "…" } ]
  },
  "checks": {
    "notes_total": 412,
    "notes_out_of_range": 0,             // after repair; the headline number
    "notes_out_of_range_before_repair": 7,
    "notes_out_of_range_after_ai_revision": 2,
    "notes_out_of_range_after_octave_repair": 0,
    "notes_folded": 0,                   // single notes octave-displaced as a last resort
    "chords_reduced": 3,
    "repair_rounds": 1,                  // planner revision calls
    "lines_dropped": 1,
    "handoffs": 2,                       // times a source line changes player (continuity)
    "essential_coverage": { "melody": 1.0, "bass": 1.0 },  // melody vs the manifest's reference melody map (null if none)
    "violations": [ { "player": "cl", "measure": 5, "pitch": "C7", "range_sounding": ["D3", "Bb5"] } ]
  },
  "coverage": [
    { "source_part": "P1", "segments": [
      { "start_measure": 1, "end_measure": 4, "role": "melody", "covered_by": ["fl"], "dropped": false } ] }
  ],
  "musicxml": {
    "original": "<?xml …",               // excerpt, concert pitch
    "arranged": "<?xml …",               // concert-pitch full score; notes colored by source part
    "parts": { "fl": "<?xml …" }         // written pitch, one per player
  },
  "midi": { "original": "<base64>", "arranged": "<base64>" }
}
```

`index.json`: `{ "pieces": [ {piece…, "results": [ {result_id, roster_id, roster_label, planner} ] } ], "rosters": [ {id, label, players[]} ] }`.

## API

`POST /api/arrange` body `{ "piece_id": "...", "roster": {players[]}, "planner": "ai"|"greedy" }` → ArrangeResult. A demo-only deploy can omit the API; the web falls back to precomputed results.

## Live API (production)

`POST /api/arrange` is served by a Vercel Python function (`api/index.py`, trimmed music21 wheel in `api/_wheels/`). Body: `{piece_id, roster: {id?, label?, players: [{id, instrument, level?, label?}]}, planner}`. Always send `planner`: `"greedy"` and `"as_written"` work; `"ai"` returns 403 unless `ANTHROPIC_API_KEY` is set. Errors: 400 bad roster/planner, 404 unknown piece, 422 malformed body (detail is an array), 500 engine failure. `GET /api/health` → `{ok, ai}`. Live results have `result_id` ending in `__live`, no `elapsed_s`, `model: null`.

## MIDI layout

Format 1. Track 0 = tempo only; tracks 1..N = players in roster order (same order as `musicxml.parts`), present even when silent. Same-instrument players can share a channel, so solo/mute by track index, not channel. The original MIDI has tracks 1–4 = Violin 1, Violin 2, Viola, Violoncello.

## Web routes

`#/?piece=<id>&band=<preset id | custom list like flute:i,trumpet:b:Sam>&planner=ai|greedy` (tool) and `#/why` (why page). Custom bands always use `planner=greedy`.

## Uploads and best-of-3 (2026-10-10, pre-recording)

- `POST /api/inspect` with `{filename, data_base64}` (or `{upload:{…}}`) returns `{title, composer, movements:[{index, first_bar, last_bar, bars, label}], parts:[names], limits:{max_bars}, notes:[]}`. The file is read with ElementTree; music21 parses only the chosen bars.
- `POST /api/arrange` with `upload:{filename, data_base64, movement_index, start_measure, end_measure}` in place of `piece_id`. Planners: greedy and as_written (ai returns 403). Limits: 3 MB, 32 bars, ≤ 8 parts with notes. Results: `result_id` = `upload__<band>__greedy__live`, and `piece` gains `uploaded`, `filename`, `notes`, source "Uploaded by you; not stored". The tool's link carries only the band for uploads.
- AI results carry `checks.candidates` = `[{index, chosen, total_first, total_final, final{…}, revisions_kept, revisions_rejected, planner_calls}]`, plus `checks.candidates_failed`, `checks.selection_rule` and `checks.first_plan_unselected(_index)`. `first_plan`, `revisions` and `final` describe the chosen candidate. report.py's `first_unfit` uses `first_plan_unselected`. comparison.json adds `selection` and per-row `candidates` / `chosen_index`.
