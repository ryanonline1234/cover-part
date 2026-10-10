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


# --- regressions for the 2026-10-10 adversarial review -------------------------------------------
import json as _json

from music21 import note as _note

from coverpart.arrange import _autofix, arrange
from coverpart.export import original_score, to_musicxml

MANIFEST = _json.loads((Path(__file__).parents[2] / "corpus" / "manifest.json").read_text())


def _load(eid):
    e = next(x for x in MANIFEST["excerpts"] if x["id"] == eid)
    return load_excerpt(Path(__file__).parents[2] / "corpus" / e["file"], e["start_measure"], e["end_measure"], meta=e)


@pytest.mark.parametrize("eid", ["osq-haydn-op76no3-ii-m0-20", "osq-haydn-op20no2-i-m0-14", "osq-haydn-op76no3-ii-m40-60"])
def test_pickup_and_split_bars_keep_their_length(eid):
    ex = _load(eid)
    res = arrange(ex, PRESETS["winds4"], "greedy", log=lambda m: None)
    bars = lambda xml: [float(m.duration.quarterLength) for m in
                        converter.parseData(xml).parts[0].getElementsByClass(stream.Measure)]
    want = bars(res["musicxml"]["original"])
    assert bars(res["musicxml"]["arranged"]) == want
    for xml in res["musicxml"]["parts"].values():
        assert bars(xml) == want


def test_octave_shift_keeps_spelling():
    from coverpart.execute import Execution, _clean_note
    n = _clean_note(_note.Note("D-6"), "#000", -1, "top", False, Execution(stream.Score(), {}))
    assert n.pitch.nameWithOctave == "D-5"


def test_shifted_line_shows_needed_naturals():
    ex = _load("osq-hensel-eflat-iii-m1-16")
    roster = PRESETS["no_viola"]
    plan = greedy_plan(ex, summarize(ex), roster)
    exe = ex_mod.execute(plan, ex, roster)
    for m in exe.parts["vn2"].getElementsByClass(stream.Measure):
        if m.number == 5:
            bs = [n.pitch for n in m.notes if isinstance(n, _note.Note) and n.pitch.step == "B"]
            assert bs and bs[0].accidental is not None and bs[0].accidental.name == "natural"
            assert bs[0].accidental.displayStatus is True


@pytest.mark.parametrize("eid", [e["id"] for e in MANIFEST["excerpts"]])
def test_original_voicing_has_no_inversions(eid):
    ex = _load(eid)
    roster = Roster("id", "id", [Player(f"x{k}", ["violin", "violin", "viola", "cello"][k], "advanced") for k in range(4)])
    plan = {"summary": "", "roles": [], "dropped": [], "assignments": [
        {"source_part": f"P{k + 1}", "start_measure": ex.start_measure, "end_measure": ex.end_measure,
         "player": f"x{k}", "octave_shift": 0, "chord_policy": "keep", "reason": ""} for k in range(4)]}
    exe = ex_mod.execute(plan, ex, roster)
    assert sum(v["events"] for v in ex_mod.voicing_issues(plan, exe, ex, roster) if v["kind"] == "below_bass") == 0


def test_autofix_trims_only_the_clash_and_survives_unknown_ids(ex):
    roster = PRESETS["winds4"]
    plan = {"summary": "", "roles": [{"source_part": "P1", "start_measure": 1, "end_measure": 12, "role": "melody"}],
            "dropped": [{"source_part": "P9", "start_measure": 1, "end_measure": 2, "reason": "?"}],
            "assignments": [
                {"source_part": "P2", "start_measure": 1, "end_measure": 12, "player": "fl", "octave_shift": 0, "chord_policy": "top", "reason": ""},
                {"source_part": "P1", "start_measure": 5, "end_measure": 12, "player": "fl", "octave_shift": 0, "chord_policy": "top", "reason": ""},
                {"source_part": "P3", "start_measure": 1, "end_measure": 12, "player": "nobody", "octave_shift": 0, "chord_policy": "top", "reason": ""},
                {"source_part": "P9", "start_measure": 1, "end_measure": 12, "player": "cl", "octave_shift": 0, "chord_policy": "top", "reason": ""}]}
    fixed = _autofix(plan, ex, roster)
    assert validate(fixed, ex, roster).ok
    fl = sorted((a["source_part"], a["start_measure"], a["end_measure"]) for a in fixed["assignments"] if a["player"] == "fl")
    assert fl == [("P1", 5, 12), ("P2", 1, 4)]  # the melody keeps its bars; only the clash is trimmed


def test_roster_rejects_duplicates_and_narrow_overrides():
    with pytest.raises(ValueError):
        Roster.from_json({"players": [{"id": "a", "instrument": "flute"}, {"id": "a", "instrument": "oboe"}]})
    with pytest.raises(ValueError):
        Player("a", "flute", range_override=("C4", "G4"))
