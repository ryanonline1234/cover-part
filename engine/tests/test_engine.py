import warnings
from pathlib import Path

import pytest
from music21 import converter, pitch, stream

from coverpart import execute as ex_mod
from coverpart import instruments as ins
from coverpart.export import written_part
from coverpart.plan import validate
from coverpart.planner_greedy import plan as greedy_plan
from coverpart.roster import PRESETS, Player, Roster
from coverpart.score_io import load_excerpt, summarize

warnings.filterwarnings("ignore")
FIX = Path(__file__).parent / "fixtures" / "arriaga1.mxl"


@pytest.fixture(scope="module")
def ex():
    return load_excerpt(FIX, 1, 12)


def test_transposition_table():
    assert ins.written_to_sounding("D5", "clarinet").nameWithOctave == "C5"
    assert ins.written_to_sounding("A4", "alto_sax").nameWithOctave == "C4"
    assert ins.written_to_sounding("D5", "tenor_sax").nameWithOctave == "C4"
    assert ins.written_to_sounding("A4", "bari_sax").nameWithOctave == "C3"
    assert ins.written_to_sounding("G4", "horn").nameWithOctave == "C4"
    assert ins.written_to_sounding("C3", "double_bass").nameWithOctave == "C2"
    assert ins.written_to_sounding("C4", "flute").nameWithOctave == "C4"


def test_player_range_sounding():
    p = Player("cl", "clarinet")  # intermediate written E3–C6
    lo, hi = p.range_sounding
    assert (lo.nameWithOctave, hi.nameWithOctave) == ("D3", "B-5")
    assert p.fits(pitch.Pitch("B-5")) and not p.fits(pitch.Pitch("B5"))


def test_excerpt_is_one_movement(ex):
    assert ex.measure_numbers == list(range(1, 13))
    assert len(ex.parts) == 4


def test_validator_catches_overlap_and_gaps(ex):
    roster = PRESETS["winds4"]
    bad = {"summary": "", "roles": [], "dropped": [], "assignments": [
        {"source_part": "P1", "start_measure": 1, "end_measure": 12, "player": "fl", "octave_shift": 0,
         "chord_policy": "top", "reason": ""},
        {"source_part": "P2", "start_measure": 5, "end_measure": 12, "player": "fl", "octave_shift": 0,
         "chord_policy": "top", "reason": ""},
    ]}
    errs = validate(bad, ex, roster).errors
    assert any("two lines at once" in e for e in errs)
    assert any("P3 is neither assigned nor dropped" in e for e in errs)
    assert any("P2 is neither assigned nor dropped in measures 1-4" in e for e in errs)


def test_greedy_plan_is_valid_and_in_range(ex):
    for rid, roster in PRESETS.items():
        s = summarize(ex)
        p = greedy_plan(ex, s, roster)
        assert validate(p, ex, roster).ok, rid
        exe = ex_mod.execute(p, ex, roster)
        if exe.violations:
            ex_mod.fold_out_of_range(exe, roster)
        assert exe.violations == [], rid


def test_every_assigned_note_is_executed(ex):
    roster = PRESETS["winds4"]
    p = greedy_plan(ex, summarize(ex), roster)
    exe = ex_mod.execute(p, ex, roster)
    expected = 0
    for a in p["assignments"]:
        for m in ex.part(a["source_part"]).part.getElementsByClass(stream.Measure):
            if a["start_measure"] <= m.number <= a["end_measure"]:
                voices = [v for v in m.voices if v.notes]
                src = voices if len(voices) <= 1 else voices[:1]
                expected += len((src[0] if src else m).notes)
    got = sum(len(part.recurse().notes) for part in exe.parts.values())
    assert got == expected


def test_written_part_transposes_up_for_clarinet(ex):
    roster = Roster("t", "t", [Player("cl", "clarinet")])
    p = {"summary": "", "roles": [], "dropped": [
        {"source_part": s, "start_measure": 1, "end_measure": 12, "reason": "test"} for s in ("P2", "P3", "P4")],
        "assignments": [{"source_part": "P1", "start_measure": 1, "end_measure": 12, "player": "cl",
                         "octave_shift": 0, "chord_policy": "top", "reason": ""}]}
    exe = ex_mod.execute(p, ex, roster)
    concert = [n.pitch.ps for n in exe.parts["cl"].recurse().notes]
    sc = written_part(exe.parts["cl"], roster, "cl", "t")
    xml_back = converter.parseData(__import__("coverpart.export", fromlist=["to_musicxml"]).to_musicxml(sc))
    written = [n.pitch.ps for n in xml_back.parts[0].recurse().notes]
    assert len(written) == len(concert)
    assert all(w - c == 2 for w, c in zip(written, concert))
    ks = xml_back.parts[0].recurse().getElementsByClass("KeySignature")[0]
    assert ks.sharps == 1  # D minor concert (1 flat) -> E minor written (1 sharp)


def test_role_problems_flags_dropped_melody(ex):
    from coverpart.plan import role_problems
    plan = {"summary": "", "assignments": [], "roles": [
        {"source_part": "P1", "start_measure": 1, "end_measure": 12, "role": "melody"}],
        "dropped": [{"source_part": "P1", "start_measure": 5, "end_measure": 8, "reason": "x"}]}
    errs = role_problems(plan, ex)
    assert len(errs) == 1 and "m.5-8" in errs[0] and "melody" in errs[0]


def test_voicing_detects_line_moved_under_bass(ex):
    roster = Roster("t", "t", [Player("a", "cello", "advanced"), Player("b", "cello", "advanced")])
    base = {"summary": "", "roles": [], "dropped": [
        {"source_part": s, "start_measure": 1, "end_measure": 12, "reason": "t"} for s in ("P1", "P2")]}
    ok = base | {"assignments": [
        {"source_part": "P4", "start_measure": 1, "end_measure": 12, "player": "a", "octave_shift": 0, "chord_policy": "bottom", "reason": ""},
        {"source_part": "P3", "start_measure": 1, "end_measure": 12, "player": "b", "octave_shift": 0, "chord_policy": "top", "reason": ""}]}
    bad = base | {"assignments": [ok["assignments"][0], dict(ok["assignments"][1], octave_shift=-2)]}
    def events(p):
        exe = ex_mod.execute(p, ex, roster)
        return sum(v["events"] for v in ex_mod.voicing_issues(p, exe, ex, roster) if v["kind"] == "below_bass")
    assert events(bad) > events(ok)
    assert events(bad) > 10
