"""Generate MOCK ArrangeResult files for the web UI (web/public/demos/mock-*.json).

Throwaway: delete this script and public/demos/mock-*.json once the engine
writes real results. Does NOT import engine code; mirrors the JSON contract in
docs/01-architecture.md so the UI can be built before the engine lands.

Run: /Users/ryantseng/cover-part/.venv/bin/python web/scripts/make_mock.py
"""

from __future__ import annotations

import base64
import copy
import json
from pathlib import Path

from music21 import (
    chord,
    clef,
    instrument,
    key,
    metadata,
    meter,
    midi,
    note,
    pitch,
    stream,
    tempo,
)
from music21.musicxml.m21ToXml import GeneralObjectExporter

OUT = Path(__file__).resolve().parent.parent / "public" / "demos"

PIECE = {
    "id": "dminor-sketch",
    "title": "Quartet sketch in D minor (mock)",
    "composer": "Mock data, not a real piece",
    "movement": "I",
    "measures": [1, 4],
    "source": "Hand-written mock for UI development",
    "source_url": "https://github.com/OpenScore/StringQuartets",
}

# Source parts: measure -> list of (pitches | None for rest, quarterLength)
SRC = {
    "P1": {
        "name": "Violin I", "instrument": "violin", "color": "#B3261E", "clef": "treble", "program": 40,
        "m": [
            [(["D5"], 1), (["F5"], 1), (["A5"], 2)],
            [(["G5"], 1), (["F5"], 0.5), (["E5"], 0.5), (["D5"], 2)],
            [(["B-4"], 1), (["A4"], 1), (["G4"], 1), (["F4"], 1)],
            [(["E4"], 1), (["C#4"], 1), (["D4"], 2)],
        ],
    },
    "P2": {
        "name": "Violin II", "instrument": "violin", "color": "#1F5E9C", "clef": "treble", "program": 40,
        "m": [
            [(["A4"], 2), (["A4"], 2)],
            [(["B-4"], 2), (["A4"], 2)],
            [(["G4"], 2), (["F4"], 2)],
            [(["E4"], 1), (["G4"], 1), (["F4", "A4"], 2)],
        ],
    },
    "P3": {
        "name": "Viola", "instrument": "viola", "color": "#2F7A4A", "clef": "alto", "program": 41,
        "m": [
            [(["F4"], 2), (["F4"], 2)],
            [(["D4"], 2), (["C#4"], 2)],
            [(["D4"], 2), (["D4"], 2)],
            [(["C#4"], 2), (["A3"], 2)],
        ],
    },
    "P4": {
        "name": "Cello", "instrument": "cello", "color": "#9A6A12", "clef": "bass", "program": 42,
        "m": [
            [(["D3"], 4)],
            [(["G2"], 2), (["A2"], 2)],
            [(["G2"], 2), (["B-2"], 2)],
            [(["A2"], 2), (["D2"], 2)],
        ],
    },
}

ROLES = [
    {"source_part": "P1", "start_measure": 1, "end_measure": 4, "role": "melody"},
    {"source_part": "P2", "start_measure": 1, "end_measure": 4, "role": "inner"},
    {"source_part": "P3", "start_measure": 1, "end_measure": 4, "role": "inner"},
    {"source_part": "P4", "start_measure": 1, "end_measure": 4, "role": "bass"},
]

# players: id -> (label, instrument, clef, GM program, transposition semitones written-above-sounding,
#                 written range, sounding range)
PLAYERS = {
    "fl": ("Flute", "flute", "treble", 73, 0, ["D4", "G6"], ["D4", "G6"]),
    "cl": ("Clarinet in B♭", "clarinet", "treble", 71, 2, ["E3", "C6"], ["D3", "B-5"]),
    "asx": ("Alto Sax", "alto_sax", "treble", 65, 9, ["C4", "E6"], ["E-3", "G5"]),
    "bsn": ("Bassoon", "bassoon", "bass", 70, 0, ["B-1", "D5"], ["B-1", "D5"]),
    "vn1": ("Violin 1", "violin", "treble", 40, 0, ["G3", "A6"], ["G3", "A6"]),
    "vn2": ("Violin 2", "violin", "treble", 40, 0, ["G3", "E6"], ["G3", "E6"]),
    "vc": ("Cello", "cello", "bass", 42, 0, ["C2", "E5"], ["C2", "E5"]),
}

ROSTERS = [
    {"id": "winds4", "label": "Flute, clarinet, alto sax, bassoon", "players": ["fl", "cl", "asx", "bsn"]},
    {"id": "noviola", "label": "Two violins and cello (no viola)", "players": ["vn1", "vn2", "vc"]},
]

PLANS = {
    ("winds4", "ai"): {
        "summary": (
            "Keep the tune in one clear voice at a time: flute opens it, then hands it to alto sax "
            "when it falls below the flute's low D. Clarinet and sax trade the inner harmony, bassoon "
            "takes the cello line throughout. Violin II's last two bars only double the viola, so they "
            "are left out to keep the texture light under the sax."
        ),
        "assignments": [
            ("P1", 1, 2, "fl", 0, "top", "Sits in the flute's singing middle register; carries the opening clearly."),
            ("P1", 3, 4, "asx", 0, "top", "The tune dips to C♯4, under the flute's range; alto sax plays it in its warm middle."),
            ("P2", 1, 2, "cl", 0, "top", "Clarinet blends under the flute and keeps the inner pulse."),
            ("P3", 1, 2, "asx", 0, "top", "Sax holds the viola's thirds until it takes over the tune."),
            ("P3", 3, 4, "cl", 0, "top", "Clarinet picks up the viola harmony when the sax moves to the melody."),
            ("P4", 1, 4, "bsn", 0, "top", "Bassoon is the only player with the cello's low register."),
        ],
        "dropped": [
            ("P2", 3, 4, "Doubles the viola a third above; with sax on the tune, a fourth line would crowd it."),
        ],
        "repair": True,
    },
    ("winds4", "greedy"): {
        "summary": "Baseline: top source voice to the highest player, next voice to the next player, no musical judgment.",
        "assignments": [
            ("P1", 1, 4, "fl", 0, "top", "Top voice to highest-ranged player."),
            ("P2", 1, 4, "cl", 0, "top", "Second voice to second-highest player."),
            ("P3", 1, 4, "asx", 0, "top", "Third voice to third-highest player."),
            ("P4", 1, 4, "bsn", 0, "top", "Bottom voice to lowest player."),
        ],
        "dropped": [],
        "repair": False,
    },
    ("noviola", "ai"): {
        "summary": (
            "Without a viola, Violin II covers the viola's harmony from bar 3, where Violin II's own "
            "line only doubles it. The tune and the cello line stay where they were."
        ),
        "assignments": [
            ("P1", 1, 4, "vn1", 0, "top", "Melody stays with the first violin."),
            ("P2", 1, 2, "vn2", 0, "top", "Violin II keeps its own line while it has independent harmony."),
            ("P3", 3, 4, "vn2", 0, "top", "Viola harmony fits Violin II's range; A3 is above the G string."),
            ("P4", 1, 4, "vc", 0, "top", "Cello unchanged."),
        ],
        "dropped": [
            ("P3", 1, 2, "Viola thirds double Violin II here; nothing essential is lost."),
            ("P2", 3, 4, "Violin II moves to the viola line; its own line only doubled it."),
        ],
        "repair": True,
    },
}


def midi_of(name: str) -> int:
    return pitch.Pitch(name).midi


def make_note(pitches, ql, color=None, shift=0, chord_policy="top"):
    if pitches is None:
        return note.Rest(quarterLength=ql), 0
    reduced = 0
    if len(pitches) > 1 and chord_policy == "top":
        pitches = [max(pitches, key=midi_of)]
        reduced = 1
    if len(pitches) == 1:
        n = note.Note(pitches[0], quarterLength=ql)
    else:
        n = chord.Chord(pitches, quarterLength=ql)
    if shift:
        n.transpose(12 * shift, inPlace=True)
    if color:
        n.style.color = color
    return n, reduced


def clef_obj(name):
    return {"treble": clef.TrebleClef(), "alto": clef.AltoClef(), "bass": clef.BassClef()}[name]


def instrument_obj(label, program):
    inst = instrument.Instrument()
    inst.partName = label
    inst.instrumentName = label
    inst.midiProgram = program
    return inst


def to_xml(s) -> str:
    return GeneralObjectExporter(s).parse().decode("utf-8")


def to_midi_b64(s) -> str:
    mf = midi.translate.music21ObjectToMidiFile(s)
    return base64.b64encode(mf.writestr()).decode("ascii")


def build_original():
    sc = stream.Score()
    sc.metadata = metadata.Metadata(title=PIECE["title"], composer=PIECE["composer"])
    for pid, spec in SRC.items():
        p = stream.Part(id=pid)
        p.partName = spec["name"]
        p.insert(0, instrument_obj(spec["name"], spec["program"]))
        for i, meas in enumerate(spec["m"], start=1):
            m = stream.Measure(number=i)
            if i == 1:
                m.insert(0, clef_obj(spec["clef"]))
                m.insert(0, key.Key("d"))
                m.insert(0, meter.TimeSignature("4/4"))
                if pid == "P1":
                    m.insert(0, tempo.MetronomeMark(number=84))
            for pitches, ql in meas:
                n, _ = make_note(pitches, ql)
                m.append(n)
            p.append(m)
        sc.insert(0, p)
    return sc


def build_arranged(roster, plan):
    """Returns (score, per-player concert parts, checks, coverage)."""
    players = roster["players"]
    nmeas = len(SRC["P1"]["m"])
    # cell[(player, measure)] = (source_part, shift, policy)
    cell = {}
    for sp, a, b, pl, shift, pol, _ in plan["assignments"]:
        for mm in range(a, b + 1):
            cell[(pl, mm)] = (sp, shift, pol)

    sc = stream.Score()
    sc.metadata = metadata.Metadata(title=PIECE["title"] + " (cover)", composer=PIECE["composer"])
    parts = {}
    total = oor_before = oor_after = folded = reduced = 0
    violations = []
    for pl in players:
        label, _inst, cl, prog, _tr, _rw, rs = PLAYERS[pl]
        lo, hi = midi_of(rs[0]), midi_of(rs[1])
        p = stream.Part(id=pl)
        p.partName = label
        p.insert(0, instrument_obj(label, prog))
        for mm in range(1, nmeas + 1):
            m = stream.Measure(number=mm)
            if mm == 1:
                m.insert(0, clef_obj(cl))
                m.insert(0, key.Key("d"))
                m.insert(0, meter.TimeSignature("4/4"))
                if pl == players[0]:
                    m.insert(0, tempo.MetronomeMark(number=84))
            if (pl, mm) in cell:
                sp, shift, pol = cell[(pl, mm)]
                for pitches, ql in SRC[sp]["m"][mm - 1]:
                    n, r = make_note(pitches, ql, SRC[sp]["color"], shift, pol)
                    reduced += r
                    if isinstance(n, note.Note):
                        total += 1
                        if not (lo <= n.pitch.midi <= hi):
                            oor_before += 1
                            if plan["repair"]:
                                while n.pitch.midi < lo:
                                    n.transpose(12, inPlace=True)
                                while n.pitch.midi > hi:
                                    n.transpose(-12, inPlace=True)
                                folded += 1
                            else:
                                oor_after += 1
                                violations.append({
                                    "player": pl, "measure": mm,
                                    "pitch": n.pitch.nameWithOctave.replace("-", "b"),
                                    "range_sounding": [x.replace("-", "b") for x in rs],
                                })
                    m.append(n)
            else:
                m.append(note.Rest(quarterLength=4))
            p.append(m)
        sc.insert(0, p)
        parts[pl] = p

    coverage = []
    for sp in SRC:
        segs = []
        for role in ROLES:
            if role["source_part"] != sp:
                continue
        # one segment per contiguous run with identical covered_by
        runs = []
        for mm in range(1, nmeas + 1):
            by = tuple(pl for pl in players if cell.get((pl, mm), (None,))[0] == sp)
            if runs and runs[-1][2] == by:
                runs[-1][1] = mm
            else:
                runs.append([mm, mm, by])
        role_name = next(r["role"] for r in ROLES if r["source_part"] == sp)
        for a, b, by in runs:
            segs.append({"start_measure": a, "end_measure": b, "role": role_name,
                         "covered_by": list(by), "dropped": len(by) == 0})
        coverage.append({"source_part": sp, "segments": segs})

    def ess(role):
        meas = [(r["source_part"], mm) for r in ROLES if r["role"] == role
                for mm in range(r["start_measure"], r["end_measure"] + 1)]
        hit = sum(1 for sp, mm in meas if any(cell.get((pl, mm), (None,))[0] == sp for pl in players))
        return round(hit / len(meas), 3) if meas else 1.0

    checks = {
        "notes_total": total,
        "notes_out_of_range": oor_after,
        "notes_out_of_range_before_repair": oor_before,
        "notes_folded": folded,
        "chords_reduced": reduced,
        "repair_rounds": 1 if plan["repair"] and oor_before else 0,
        "essential_coverage": {"melody": ess("melody"), "bass": ess("bass")},
        "violations": violations,
    }
    return sc, parts, checks, coverage


def written_part(pl, concert_part):
    label, _inst, cl, prog, tr, _rw, _rs = PLAYERS[pl]
    p = copy.deepcopy(concert_part)
    if tr:
        p = p.transpose(tr)
    s = stream.Score()
    s.metadata = metadata.Metadata(title=f"{PIECE['title']}: {label}", composer=PIECE["composer"])
    s.insert(0, p)
    return s


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    original = build_original()
    orig_xml, orig_midi = to_xml(original), to_midi_b64(original)
    source_parts = [{"id": k, "name": v["name"], "instrument": v["instrument"], "color": v["color"]}
                    for k, v in SRC.items()]
    rosters_out = []
    for r in ROSTERS:
        rosters_out.append({
            "id": r["id"], "label": r["label"],
            "players": [{"id": pl, "label": PLAYERS[pl][0], "instrument": PLAYERS[pl][1],
                         "level": "intermediate",
                         "range_written": [x.replace("-", "b") for x in PLAYERS[pl][5]],
                         "range_sounding": [x.replace("-", "b") for x in PLAYERS[pl][6]]}
                        for pl in r["players"]],
        })
    results_index = []
    for (rid, planner), plan in PLANS.items():
        roster = next(r for r in ROSTERS if r["id"] == rid)
        roster_out = next(r for r in rosters_out if r["id"] == rid)
        sc, parts, checks, coverage = build_arranged(roster, plan)
        result_id = f"mock-{PIECE['id']}__{rid}__{planner}"
        res = {
            "result_id": result_id,
            "piece": PIECE,
            "source_parts": source_parts,
            "roster": roster_out,
            "planner": planner,
            "model": "claude-opus-5-5" if planner == "ai" else None,
            "plan": {
                "summary": plan["summary"],
                "roles": ROLES,
                "assignments": [
                    {"source_part": sp, "start_measure": a, "end_measure": b, "player": pl,
                     "octave_shift": sh, "chord_policy": pol, "reason": why}
                    for sp, a, b, pl, sh, pol, why in plan["assignments"]
                ],
                "dropped": [{"source_part": sp, "start_measure": a, "end_measure": b, "reason": why}
                            for sp, a, b, why in plan["dropped"]],
            },
            "checks": checks,
            "coverage": coverage,
            "musicxml": {
                "original": orig_xml,
                "arranged": to_xml(sc),
                "parts": {pl: to_xml(written_part(pl, p)) for pl, p in parts.items()},
            },
            "midi": {"original": orig_midi, "arranged": to_midi_b64(sc)},
        }
        (OUT / f"{result_id}.json").write_text(json.dumps(res, ensure_ascii=False))
        results_index.append({"result_id": result_id, "roster_id": rid,
                              "roster_label": roster["label"], "planner": planner})
        print(result_id, checks["notes_total"], "oor", checks["notes_out_of_range_before_repair"],
              "->", checks["notes_out_of_range"])
    index = {"pieces": [{**PIECE, "results": results_index}], "rosters": rosters_out}
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
