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
  "planner": "ai",                       // "ai" | "greedy"
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
