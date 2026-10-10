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
    # Hensel's viola line moved up an octave into a violin part, mm. 5-8 (what the rule-based plan
    # did before it kept lines with their players): the B natural in m. 5 must still be printed.
    ex = _load("osq-hensel-eflat-iii-m1-16")
    roster = PRESETS["no_viola"]
    plan = {"summary": "", "roles": [], "dropped": [], "assignments": [
        {"source_part": "P3", "start_measure": 5, "end_measure": 8, "player": "vn2", "octave_shift": 1,
         "chord_policy": "top", "reason": ""}]}
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


def test_playback_midi_matches_score_length():
    import base64 as _b64
    from music21 import midi as _midi
    ex = _load("osq-haydn-op76no3-ii-m40-60")
    res = arrange(ex, PRESETS["winds4"], "greedy", log=lambda m: None)
    for key in ("original", "arranged"):
        mf = _midi.MidiFile()
        mf.readstr(_b64.b64decode(res["midi"][key]))
        assert float(_midi.translate.midiFileToStream(mf).highestTime) == 80.0


# --- planner "as_written": the original parts handed out, nothing repaired -------------------------
import re as _re

from coverpart.planner_as_written import NOBODY_LEFT


def _x_noteheads(xml: str) -> int:
    return len(_re.findall(r"<notehead[^>]*>x</notehead>", xml))


@pytest.fixture(scope="module")
def as_written_results(ex):
    return {rid: arrange(ex, PRESETS[rid], "as_written", log=lambda m: None) for rid in ("church_brass", "sax_trio")}


def test_as_written_pairs_by_range_center_and_drops_leftover_parts(as_written_results):
    res = as_written_results["sax_trio"]
    pairs = [(a["source_part"], a["player"], a["octave_shift"]) for a in res["plan"]["assignments"]]
    assert pairs == [("P1", "asx", 0), ("P2", "tsx", 0), ("P3", "bsx", 0)]  # alto > tenor > bari
    assert [(d["source_part"], d["reason"]) for d in res["plan"]["dropped"]] == [("P4", NOBODY_LEFT)]
    assert res["checks"]["measures_dropped"] > 0
    brass = as_written_results["church_brass"]["plan"]["assignments"]
    assert [a["player"] for a in brass] == ["tp1", "tp2", "hn", "euph"]


def test_as_written_leaves_violations_unfolded(as_written_results):
    for rid, res in as_written_results.items():
        c = res["checks"]
        assert c["notes_folded"] == 0, rid
        assert c["notes_out_of_range"] == c["notes_out_of_range_before_repair"] == len(c["violations"]), rid
        assert all(a["octave_shift"] == 0 for a in res["plan"]["assignments"]), rid
    assert as_written_results["church_brass"]["checks"]["notes_out_of_range"] > 0


def test_as_written_x_noteheads_are_exactly_the_out_of_range_notes(as_written_results):
    for rid, res in as_written_results.items():
        roster = PRESETS[rid]
        n_oor = res["checks"]["notes_out_of_range"]
        assert _x_noteheads(res["musicxml"]["arranged"]) == n_oor, rid
        per_player = {p.id: 0 for p in roster.players}
        for v in res["checks"]["violations"]:
            per_player[v["player"]] += 1
        for pid, xml in res["musicxml"]["parts"].items():
            assert _x_noteheads(xml) == per_player[pid], (rid, pid)
        # note by note in the concert score: x iff the player can't reach it, and the line color stays
        sc = converter.parseData(res["musicxml"]["arranged"])
        for player, part in zip(roster.players, sc.parts):
            for n in part.recurse().notes:
                for comp in (n.notes if n.isChord else [n]):
                    assert (comp.notehead == "x") == (not player.fits(comp.pitch)), (rid, player.id, comp.pitch)
                    assert (n.style.color or "").upper() in {"#B3261E", "#1F5FA8", "#2E7D4F", "#B26A00"}


def test_ai_and_greedy_get_no_x_noteheads(ex):
    res = arrange(ex, PRESETS["church_brass"], "greedy", log=lambda m: None)
    assert _x_noteheads(res["musicxml"]["arranged"]) == 0
    assert all(_x_noteheads(x) == 0 for x in res["musicxml"]["parts"].values())
    assert res["checks"]["notes_out_of_range"] == 0


def test_mark_out_of_range_marks_only_the_unreachable_chord_note():
    from music21 import chord as _chord
    from coverpart.execute import Execution, mark_out_of_range
    roster = Roster("t", "t", [Player("v", "violin", "beginner")])  # sounding G3-B5
    part = stream.Part()
    m = stream.Measure(number=1)
    c = _chord.Chord(["C3", "G3"])
    c.style.color = "#2E7D4F"
    m.append([c, _note.Note("C6")])
    part.append(m)
    assert mark_out_of_range(Execution(stream.Score(), {"v": part}), roster) == 2
    assert [x.notehead for x in c.notes] == ["x", "normal"]
    xml = to_musicxml(stream.Score([part]))
    assert _x_noteheads(xml) == 2 and 'color="#2E7D4F"' in xml


def test_as_written_counts_notes_as_engraved():
    # Dvořák op. 96/I bar 1: export splits a fingered-tremolo note into two tied notes to complete
    # its tuplet. Both get an x, so the count must be taken after that split.
    ex = _load("osq-dvorak-op96-i-m1-20")
    res = arrange(ex, PRESETS["sax_trio"], "as_written", log=lambda m: None)
    n = res["checks"]["notes_out_of_range"]
    assert n > 0 and _x_noteheads(res["musicxml"]["arranged"]) == n
    assert sum(_x_noteheads(x) for x in res["musicxml"]["parts"].values()) == n


# --- regressions for the 2026-10-10 site review (H1, F1, F2, F4) ----------------------------------
from coverpart import planner_ai as _planner_ai
from coverpart.arrange import handoffs, total_problems
from coverpart.cli import piece_meta
from coverpart.planner_greedy import _phrases

re = _re


def _bars(ranges: str) -> set[int]:
    out = set()
    for chunk in ranges.split(", "):
        lo, _, hi = chunk.partition("-")
        out |= set(range(int(lo), int(hi or lo) + 1))
    return out


def _asg(src, player, shift, policy="top", lo=1, hi=12):
    return {"source_part": src, "start_measure": lo, "end_measure": hi, "player": player,
            "octave_shift": shift, "chord_policy": policy, "reason": ""}


def _drop(*srcs, lo=1, hi=12):
    return [{"source_part": s, "start_measure": lo, "end_measure": hi, "reason": "t"} for s in srcs]


def test_bass_missing_counts_bars_not_lines(ex):
    # Both lower lines dropped: the bass is missing in bars where the cello is lowest AND in bars
    # where the viola is lowest. The old count was the number of issue entries (one per bass line).
    roster = Roster("t", "t", [Player("a", "violin", "advanced"), Player("b", "violin", "advanced")])
    plan = {"summary": "", "roles": [], "dropped": _drop("P3", "P4"),
            "assignments": [_asg("P1", "a", 0), _asg("P2", "b", 0)]}
    res = arrange(ex, roster, "fixed", fixed_plan=plan, log=lambda m: None)
    entries = [v for v in res["checks"]["voicing_issues"] if v["kind"] == "bass_missing"]
    union = set().union(*(_bars(v["measures"]) for v in entries))
    final = res["checks"]["final"]
    assert final["bass_missing_bars"] == len(union) > len(entries)  # bars, not entries
    assert sum(v["bars"] for v in entries) >= len(union)  # a bar missing two bass lines counts once
    assert total_problems(final) == final["out_of_range"] + final["under_bass"] + 12 * len(union)


class _FakeSession:
    """Stands in for the AI planner: a first plan, then one scripted revision."""
    plans: list = []

    def __init__(self, *a, **k):
        self.model_name = "fake"
        self._plans = list(self.plans)

    def first_plan(self):
        return self._plans.pop(0)

    def revise(self, plan, problems, kind):
        return self._plans.pop(0)


def test_revision_gate_weighs_every_bar_with_no_bass(ex, monkeypatch):
    # First plan: bass kept, inner lines an octave down -> 13 notes under the bass (problems 13).
    # "Revision": drop the bass line for all 12 bars -> 0 under, 12 bars with no bass. Counted per
    # line it scored 12 < 13 and was kept; counted per bar it is 144 and must be rejected.
    roster = Roster("t", "t", [Player(x, "cello", "advanced") for x in "abc"])
    first = {"summary": "", "roles": [], "dropped": _drop("P1"),
             "assignments": [_asg("P4", "a", 0, "bottom"), _asg("P3", "b", -1), _asg("P2", "c", -1)]}
    no_bass = {"summary": "", "roles": [], "dropped": _drop("P1", "P4"),
               "assignments": [_asg("P3", "b", 0), _asg("P2", "c", 0)]}
    monkeypatch.setattr(_FakeSession, "plans", [first, no_bass])
    monkeypatch.setattr(_planner_ai, "Session", _FakeSession)
    res = arrange(ex, roster, "ai", log=lambda m: None)
    rev = res["checks"]["revisions"][-1]
    assert rev["kind"] == "voicing" and rev["total_before"] == 13
    assert rev["after"]["bass_missing_bars"] == 12 and rev["total_after"] == 144
    assert rev["kept"] is False
    assert any(a["source_part"] == "P4" for a in res["plan"]["assignments"])


def _band(spec: str) -> Roster:
    lv = {"i": "intermediate", "b": "beginner", "a": "advanced"}
    return Roster.from_json({"players": [{"id": f"p{k}", "instrument": s.split(":")[0], "level": lv[s.split(":")[1]]}
                                         for k, s in enumerate(spec.split(","))]})


def _doubling_bars(plan: dict, pid: str) -> set[int]:
    return {m for a in plan["assignments"] if a["player"] == pid and a.get("role") == "doubling"
            for m in range(a["start_measure"], a["end_measure"] + 1)}


@pytest.mark.parametrize("eid,band", [
    ("osq-haydn-op76no3-ii-m0-20", "violin:i,violin:i,flute:i,cello:i,trumpet:b"),
    ("osq-haydn-op76no3-ii-m0-20", "violin:i,violin:i,viola:i,cello:i,flute:i,clarinet:i,trumpet:i,horn:i"),
    ("osq-hensel-eflat-iii-m1-16", "violin:i,violin:i,flute:i,cello:i,trumpet:b"),
])
def test_extra_players_double_and_never_sound_under_the_bass(eid, band):
    ex = _load(eid)
    roster = _band(band)
    res = arrange(ex, roster, "greedy", log=lambda m: None)
    plan, c = res["plan"], res["checks"]
    assert validate(plan, ex, roster).ok  # still one line per player at a time
    doublings = [a for a in plan["assignments"] if a.get("role") == "doubling"]
    assert doublings and all(a["doubles"] in ("melody", "bass") for a in doublings)
    act = {x["player"]: x for x in c["player_activity"]}
    assert set(act) == {p.id for p in roster.players}
    assert all(x["bars_total"] == len(ex.measure_numbers) for x in act.values())
    # before: the 5th player of a 4-line piece got 1 bar (Emperor) or none (Hensel)
    assert min(x["bars_played"] for x in act.values()) >= len(ex.measure_numbers) // 2
    for v in c["voicing_issues"]:  # a player has one line per bar, so an event there is the doubling's
        if v["kind"] == "below_bass":
            assert not (_bars(v["measures"]) & _doubling_bars(plan, v["player"])), v


def test_rule_based_plan_keeps_lines_with_their_players():
    # 8 players on the Emperor theme: before, Violin 1 handed the tune's last bar to the clarinet,
    # the real Violin 2 sat out while winds played its line, and the line map showed 5 handoffs.
    ex = _load("osq-haydn-op76no3-ii-m0-20")
    roster = _band("violin:i,violin:i,viola:i,cello:i,flute:i,clarinet:i,trumpet:i,horn:i")
    res = arrange(ex, roster, "greedy", log=lambda m: None)
    lines = {(a["source_part"], a["player"], a["start_measure"], a["end_measure"])
             for a in res["plan"]["assignments"] if a.get("role") != "doubling"}
    assert lines == {("P1", "p0", 0, 20), ("P2", "p1", 0, 20), ("P3", "p2", 0, 20), ("P4", "p3", 0, 20)}
    assert res["checks"]["handoffs"] == 0
    # the preset bands keep their lines too (the old rule-based plan had 6-7 handoffs here)
    for rid in ("winds4", "no_viola"):
        assert arrange(ex, PRESETS[rid], "greedy", log=lambda m: None)["checks"]["handoffs"] <= 2, rid


def test_short_last_phrase_joins_the_one_before():
    ex = _load("osq-haydn-op76no3-ii-m0-20")  # bars 0-20: 4-bar phrases leave bar 20 alone
    assert [b for b, _ in _phrases(ex, summarize(ex))][-2:] == [(12, 15), (16, 20)]
    plan = greedy_plan(ex, summarize(ex), PRESETS["winds4"])
    assert not any(r["start_measure"] == 20 for r in plan["roles"])
    assert not any(a["start_measure"] == 20 for a in plan["assignments"])


def test_handoffs_ignore_doublings():
    plan = {"assignments": [_asg("P1", "a", 0, lo=1, hi=8), _asg("P1", "b", 0, lo=9, hi=12),
                            dict(_asg("P1", "c", 0, lo=1, hi=4), role="doubling"),
                            dict(_asg("P1", "c", 0, lo=9, hi=12), role="doubling")]}
    assert handoffs(plan) == 1


def test_player_activity_counts_bars_with_notes(ex):
    roster = PRESETS["winds4"]
    plan = {"summary": "", "roles": [], "dropped": _drop("P2", "P3", "P4") + _drop("P1", lo=5, hi=12),
            "assignments": [_asg("P1", "fl", 0, lo=1, hi=4)]}
    res = arrange(ex, roster, "fixed", fixed_plan=plan, log=lambda m: None)
    act = {x["player"]: (x["bars_played"], x["bars_total"]) for x in res["checks"]["player_activity"]}
    assert act == {"fl": (4, 12), "cl": (0, 12), "asx": (0, 12), "bsn": (0, 12)}


def test_parts_carry_composer_work_movement_and_bars():
    e = next(x for x in MANIFEST["excerpts"] if x["id"] == "osq-haydn-op76no3-ii-m0-20")
    ex = _load(e["id"])
    res = arrange(ex, PRESETS["no_viola"], "greedy", piece=piece_meta(e), log=lambda m: None)
    titles = set()
    for pid, xml in res["musicxml"]["parts"].items():
        label = PRESETS["no_viola"].player(pid).label
        assert '<creator type="composer">Joseph Haydn</creator>' in xml and "Music21" not in xml
        assert re.search(r"<work-title>String Quartet in C major, Hob\.III:77", xml)
        mt = re.search(r"<movement-title>(.*?)</movement-title>", xml).group(1)
        assert mt == f"{e['movement']}, mm. 0–20 — {label}"
        titles.add(mt)
    assert len(titles) == 4
    for xml in (res["musicxml"]["original"], res["musicxml"]["arranged"]):
        assert '<creator type="composer">Joseph Haydn</creator>' in xml and "mm. 0–20" in xml


def test_preset_labels_are_distinct():
    for rid, roster in PRESETS.items():
        labels = [p.label for p in roster.players]
        assert len(set(labels)) == len(labels), rid
    assert [p.label for p in PRESETS["no_viola"].players][:2] == ["Violin 1 (advanced)", "Violin 2"]
    assert [p.label for p in PRESETS["church_brass"].players][:2] == ["Trumpet 1", "Trumpet 2 (beginner)"]
