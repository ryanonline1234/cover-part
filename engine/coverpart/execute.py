"""Execute a plan: build the arranged score, check every note against every player, repair.

Everything here is deterministic. The planner proposes; this module disposes.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field

from music21 import (articulations, chord, clef, dynamics, expressions, instrument, interval, note,
                     stream, tempo)
from music21.stream import makeNotation

from . import instruments as ins
from .roster import Player, Roster
from .score_io import Excerpt, segments

_STRING_TEXT = ("pizz", "arco", "col legno", "sul ", "con sord", "senza sord", "spicc", "tremolo")


@dataclass
class Violation:
    player: str
    measure: int
    pitch: str
    assignment: int

    def to_json(self, roster: Roster) -> dict:
        lo, hi = roster.player(self.player).range_sounding
        return {"player": self.player, "measure": self.measure, "pitch": self.pitch,
                "range_sounding": [lo.nameWithOctave, hi.nameWithOctave]}


@dataclass
class Execution:
    score: stream.Score
    parts: dict[str, stream.Part]
    violations: list[Violation] = field(default_factory=list)
    notes_total: int = 0
    chords_reduced: int = 0
    notes_folded: int = 0


def _make_instrument(player: Player, with_transposition: bool) -> instrument.Instrument:
    spec = ins.get(player.instrument)
    inst = instrument.Instrument()
    inst.partName = player.label
    inst.partAbbreviation = player.label
    inst.instrumentName = spec.label
    inst.partId = player.id
    inst.midiProgram = spec.gm_program
    if with_transposition and spec.transpose_to_sounding != "P1":
        inst.transposition = interval.Interval(spec.transpose_to_sounding)
    return inst


def _template(ex: Excerpt) -> list[stream.Measure]:
    return list(ex.parts[0].part.getElementsByClass(stream.Measure))


def _src_measure(ex: Excerpt, pid: str, number: int) -> stream.Measure | None:
    for m in ex.part(pid).part.getElementsByClass(stream.Measure):
        if m.number == number:
            return m
    return None


def _pick_voice(m: stream.Measure, policy: str) -> list:
    """Return the (offset, element) content of a measure as ONE line. With several voices, take the
    one that sounds for most of the bar (a one-note fragment padded with hidden rests is not the
    line); the chord policy breaks ties by register."""
    voices = [v for v in m.voices if v.notes]
    if len(voices) <= 1:
        src = voices[0] if voices else m
        return [(e.getOffsetBySite(src), e) for e in src.notesAndRests]

    def sounding(v):
        return sum(float(n.duration.quarterLength) for n in v.notes)

    def mean(v):
        ps = [p.ps for n in v.notes for p in n.pitches]
        return sum(ps) / len(ps)

    sign = -1 if policy == "bottom" else 1
    v = max(voices, key=lambda v: (round(sounding(v), 3), sign * mean(v)))
    return [(e.getOffsetBySite(v), e) for e in v.notesAndRests]


def _clean_note(n, color: str, shift: int, policy: str, keep_chords: bool, stats: Execution):
    n = copy.deepcopy(n)
    if isinstance(n, chord.Chord) and not keep_chords:
        ps = sorted(n.pitches, key=lambda p: p.ps)
        keep = ps[0] if policy == "bottom" else ps[-1]
        nn = note.Note(keep)
        nn.duration = copy.deepcopy(n.duration)
        nn.tie = copy.deepcopy(n.tie)
        nn.articulations = list(n.articulations)
        nn.expressions = list(n.expressions)
        n = nn
        stats.chords_reduced += 1
    if n.isRest:
        n.style.hideObjectOnPrint = False
    else:
        n.articulations = [a for a in n.articulations if not isinstance(a, articulations.TechnicalIndication)]
        if shift:
            for p in n.pitches:  # change the octave number: keeps the spelling (D-flat stays D-flat)
                p.octave += shift
        n.style.color = color
    return n


def respell(part: stream.Part) -> None:
    """Recompute which accidentals are shown, bar by bar against the key signature. Copied notes
    carry their source bar's display decisions, which are wrong in a new bar or octave."""
    for n in part.recurse().notes:
        for p in n.pitches:
            if p.accidental is not None:
                p.accidental.displayStatus = None
    makeNotation.makeAccidentalsInMeasureStream(part, useKeySignature=True, overrideStatus=True)


def _fill(ex: Excerpt, player_measure: stream.Measure, src: stream.Measure, color: str, shift: int,
          policy: str, keep_chords: bool, stats: Execution) -> None:
    for e in list(player_measure.notesAndRests):
        player_measure.remove(e)
    for off, e in _pick_voice(src, policy):
        player_measure.insert(off, _clean_note(e, color, shift, policy, keep_chords, stats))
    for d in src.getElementsByClass(dynamics.Dynamic):
        player_measure.insert(d.getOffsetBySite(src), copy.deepcopy(d))
    for t in src.getElementsByClass(expressions.TextExpression):
        if not any(s in (t.content or "").lower() for s in _STRING_TEXT):
            player_measure.insert(t.getOffsetBySite(src), copy.deepcopy(t))


def _empty_part(ex: Excerpt, player: Player) -> stream.Part:
    part = stream.Part()
    part.id = player.id
    part.partName = player.label
    part.insert(0, _make_instrument(player, with_transposition=False))
    for i, tm in enumerate(_template(ex)):
        m = stream.Measure(number=tm.number)
        m.paddingLeft = tm.paddingLeft
        m.paddingRight = tm.paddingRight
        if tm.numberSuffix:
            m.numberSuffix = tm.numberSuffix
        for cls in ("KeySignature", "TimeSignature"):
            for el in tm.getElementsByClass(cls):
                m.insert(el.getOffsetBySite(tm), copy.deepcopy(el))
        if i == 0:
            if not m.getElementsByClass("KeySignature"):
                ks = tm.getContextByClass("KeySignature")
                if ks:
                    m.insert(0, copy.deepcopy(ks))
            if not m.getElementsByClass("TimeSignature"):
                ts = tm.getContextByClass("TimeSignature")
                if ts:
                    m.insert(0, copy.deepcopy(ts))
        length = tm.highestTime or tm.barDuration.quarterLength
        r = note.Rest(quarterLength=length)
        r.fullMeasure = abs(length - tm.barDuration.quarterLength) < 1e-6
        m.insert(0, r)
        part.append(m)
    return part


def _fix_ties(part: stream.Part) -> None:
    ns = [n for n in part.recurse().notes if isinstance(n, note.Note)]
    for prev, cur in zip(ns, ns[1:]):
        prev_starts = prev.tie is not None and prev.tie.type in ("start", "continue")
        cur_stops = cur.tie is not None and cur.tie.type in ("stop", "continue")
        same = prev.pitch.ps == cur.pitch.ps
        if prev_starts and not (cur_stops and same):
            prev.tie = None if prev.tie.type == "start" else type(prev.tie)("stop")
        if cur_stops and not (prev_starts and same):
            cur.tie = None if cur.tie.type == "stop" else type(cur.tie)("start")
    for c in part.recurse().getElementsByClass(chord.Chord):
        c.tie = None
    if ns and ns[-1].tie is not None and ns[-1].tie.type in ("start", "continue"):
        ns[-1].tie = None


def _active_dynamic(ex: Excerpt, pid: str, number: int):
    last = None
    for m in ex.part(pid).part.getElementsByClass(stream.Measure):
        if m.number == number:
            break
        ds = list(m.getElementsByClass(dynamics.Dynamic))
        if ds:
            last = ds[-1]
    return last


def execute(plan: dict, ex: Excerpt, roster: Roster) -> Execution:
    colors = {sp.id: sp.color for sp in ex.parts}
    parts = {p.id: _empty_part(ex, p) for p in roster.players}
    out = Execution(score=stream.Score(), parts=parts)
    owner: dict[tuple[str, int], int] = {}
    for idx, a in enumerate(plan["assignments"]):
        player = roster.player(a["player"])
        keep = a.get("chord_policy") == "keep" and ins.get(player.instrument).family == "strings"
        pm = {m.number: m for m in parts[player.id].getElementsByClass(stream.Measure)}
        for num in range(a["start_measure"], a["end_measure"] + 1):
            src = _src_measure(ex, a["source_part"], num)
            if src is None or num not in pm:
                continue
            _fill(ex, pm[num], src, colors[a["source_part"]], int(a.get("octave_shift", 0)),
                  a.get("chord_policy", "top"), keep, out)
            if num == a["start_measure"]:
                first_note = min((float(n.getOffsetBySite(pm[num])) for n in pm[num].notes), default=None)
                has_dyn = any(float(d.getOffsetBySite(pm[num])) <= (first_note or 0)
                              for d in pm[num].getElementsByClass(dynamics.Dynamic))
                if first_note is not None and not has_dyn:
                    d = _active_dynamic(ex, a["source_part"], num)
                    if d is not None:
                        pm[num].insert(0, copy.deepcopy(d))
            owner[(player.id, num)] = idx
    for pid, part in parts.items():
        _fix_ties(part)
        respell(part)
        player = roster.player(pid)
        for n in part.recurse().notes:
            mnum = n.getContextByClass(stream.Measure).number
            for p in n.pitches:
                out.notes_total += 1
                if not player.fits(p):
                    out.violations.append(Violation(pid, mnum, p.nameWithOctave, owner.get((pid, mnum), -1)))
    return out


def fold_out_of_range(exe: Execution, roster: Roster) -> None:
    """Last resort: move single out-of-range notes by octaves until they fit. Counted, never hidden."""
    for pid, part in exe.parts.items():
        player = roster.player(pid)
        lo, hi = player.range_sounding
        for n in part.recurse().notes:
            for p in n.pitches:
                moved = False
                while p.ps > hi.ps and p.ps - 12 >= lo.ps:
                    p.octave -= 1
                    moved = True
                while p.ps < lo.ps and p.ps + 12 <= hi.ps:
                    p.octave += 1
                    moved = True
                if moved:
                    exe.notes_folded += 1
        respell(part)
    exe.violations = []
    for pid, part in exe.parts.items():
        player = roster.player(pid)
        for n in part.recurse().notes:
            for p in n.pitches:
                if not player.fits(p):
                    exe.violations.append(Violation(pid, n.getContextByClass(stream.Measure).number,
                                                    p.nameWithOctave, -1))


def split_like_engraving(exe: Execution, roster: Roster) -> None:
    """MusicXML export completes tuplets by splitting a note into tied notes (the fingered
    tremolo in Dvořák op. 96/I, bar 1). Make that split before counting, so that the notes the
    checker counts are the notes the engraving shows; then recount notes and violations."""
    owner = {(v.player, v.measure): v.assignment for v in exe.violations}
    for part in exe.parts.values():
        makeNotation.splitElementsToCompleteTuplets(part, recurse=True, addTies=True)
        respell(part)
    exe.notes_total = 0
    exe.violations = []
    for pid, part in exe.parts.items():
        player = roster.player(pid)
        for n in part.recurse().notes:
            mnum = n.getContextByClass(stream.Measure).number
            for p in n.pitches:
                exe.notes_total += 1
                if not player.fits(p):
                    exe.violations.append(Violation(pid, mnum, p.nameWithOctave, owner.get((pid, mnum), -1)))


def mark_out_of_range(exe: Execution, roster: Roster) -> int:
    """Give every note a player can't reach an x notehead (only the out-of-range pitches of a
    kept chord). The note keeps its line color. Used when no repair is applied ("as written"), so
    the engraving shows exactly which notes are unplayable. Returns how many notes were marked."""
    marked = 0
    for pid, part in exe.parts.items():
        player = roster.player(pid)
        for n in part.recurse().notes:
            if isinstance(n, chord.Chord):
                for comp in n.notes:
                    if not player.fits(comp.pitch):
                        comp.notehead = "x"
                        marked += 1
            elif not player.fits(n.pitch):
                n.notehead = "x"
                marked += 1
    return marked


def _assignment_pitches(a: dict, ex: Excerpt, lo: int, hi: int) -> list[float]:
    out = []
    for num in range(lo, hi + 1):
        src = _src_measure(ex, a["source_part"], num)
        if src is None:
            continue
        for n in src.recurse().notes:
            ps = sorted(p.ps for p in n.pitches)
            if a.get("chord_policy") == "bottom":
                ps = ps[:1]
            elif a.get("chord_policy") != "keep":
                ps = ps[-1:]
            out.extend(ps)
    return out


def best_octave_repair(plan: dict, ex: Excerpt, roster: Roster, seg_len: int = 4) -> tuple[dict, int]:
    """For each assignment with out-of-range notes, try whole-octave shifts: first for the whole
    assignment, then phrase by phrase (seg_len bars), which is what an arranger does for a player with a
    narrow range. Returns the repaired plan and how many assignments changed."""
    plan = copy.deepcopy(plan)
    changed = 0
    bounds = segments(ex, seg_len)
    out_assignments = []
    for a in plan["assignments"]:
        player = roster.player(a["player"])
        lo_ps, hi_ps = (p.ps for p in player.range_sounding)

        def misses(pitches, shift):
            return sum(1 for ps in pitches if not lo_ps <= ps + 12 * shift <= hi_ps)

        cur = int(a.get("octave_shift", 0))
        allp = _assignment_pitches(a, ex, a["start_measure"], a["end_measure"])
        if not allp or misses(allp, cur) == 0:
            out_assignments.append(a)
            continue
        best = min(range(-3, 4), key=lambda s: (misses(allp, s), abs(s - cur)))
        if misses(allp, best) == 0:
            a = dict(a, octave_shift=best,
                     reason=a.get("reason", "") + f" [checker moved this line {best - cur:+d} octave(s) to fit the range]")
            out_assignments.append(a)
            changed += 1
            continue
        # phrase by phrase
        chunks = []
        for blo, bhi in bounds:
            lo, hi = max(blo, a["start_measure"]), min(bhi, a["end_measure"])
            if lo > hi:
                continue
            ps = _assignment_pitches(a, ex, lo, hi)
            prev = chunks[-1][2] if chunks else best
            s_best = min(range(-3, 4), key=lambda s: (misses(ps, s), abs(s - prev), abs(s - cur))) if ps else prev
            chunks.append([lo, hi, s_best])
        merged = []
        for lo, hi, sh in chunks:
            if merged and merged[-1][2] == sh and merged[-1][1] + 1 == lo:
                merged[-1][1] = hi
            else:
                merged.append([lo, hi, sh])
        if sum(misses(_assignment_pitches(a, ex, lo, hi), sh) for lo, hi, sh in merged) < misses(allp, best):
            for lo, hi, sh in merged:
                out_assignments.append(dict(a, start_measure=lo, end_measure=hi, octave_shift=sh,
                                            reason=a.get("reason", "") + f" [checker: mm. {lo}-{hi} at {sh:+d} octave(s) to fit the range]"))
        else:
            out_assignments.append(dict(a, octave_shift=best))
        changed += 1
    plan["assignments"] = out_assignments
    return plan, changed


def _measure_notes(part: stream.Part, number: int) -> list[tuple[float, float, float]]:
    for m in part.getElementsByClass(stream.Measure):
        if m.number == number:
            out = []
            for n in m.recurse().notes:  # include notes inside Voice objects
                s = float(n.getOffsetInHierarchy(m))
                e = s + float(n.duration.quarterLength)
                if e > s:
                    out.append((s, e, min(p.ps for p in n.pitches)))
            return out
    return []


def voicing_issues(plan: dict, exe: Execution, ex: Excerpt, roster: Roster) -> list[dict]:
    """Texture inversions, measured against the original moment by moment: at each instant, the
    source line sounding the lowest note in the ORIGINAL is the bass. A cover note is "under the
    bass" if it sounds below every player carrying that line at that instant. The original rendered
    one line per player therefore scores 0 by construction. "bass_missing" bars are bars where the
    original's bass line is not assigned to anyone."""
    order = {sp.id: i for i, sp in enumerate(ex.parts)}
    by_key: dict = {}

    def entry(key, base):
        return by_key.setdefault(key, base | {"measures": [], "events": 0, "max_semitones": 0, "_seen": set()})

    for num in ex.measure_numbers:
        orig = {sp.id: _measure_notes(sp.part, num) for sp in ex.parts}
        cover = {p.id: _measure_notes(exe.parts[p.id], num) for p in roster.players}
        cuts = sorted({t for notes in list(orig.values()) + list(cover.values()) for s0, e0, _ in notes for t in (s0, e0)})
        for t0, t1 in zip(cuts, cuts[1:]):
            if t1 - t0 < 1e-6:
                continue
            sounding = [(ps, -order[pid], pid) for pid, notes in orig.items()
                        for s0, e0, ps in notes if s0 <= t0 < e0]
            if not sounding:
                continue
            bass_src = min(sounding)[2]  # lowest pitch; ties go to the lower-sounding (later) part
            carriers = [a["player"] for a in plan["assignments"]
                        if a["source_part"] == bass_src and a["start_measure"] <= num <= a["end_measure"]]
            if not carriers:
                d = entry(("bass_missing", bass_src), {"player": None, "bass_line": bass_src, "kind": "bass_missing"})
                if num not in d["measures"]:
                    d["measures"].append(num)
                continue
            bass_now = [ps for c in carriers for s0, e0, ps in cover[c] if s0 <= t0 < e0]
            if not bass_now:
                continue
            floor = min(bass_now)
            for p in roster.players:
                if p.id in carriers:
                    continue
                for s0, e0, ps in cover[p.id]:
                    if s0 <= t0 < e0 and ps < floor:
                        d = entry(("below_bass", p.id), {"player": p.id, "kind": "below_bass",
                                                         "bass_line": f"{bass_src} on {'/'.join(carriers)}"})
                        if (num, s0, ps) not in d["_seen"]:
                            d["_seen"].add((num, s0, ps))
                            d["events"] += 1
                        if num not in d["measures"]:
                            d["measures"].append(num)
                        d["max_semitones"] = max(d["max_semitones"], floor - ps)
    from .plan import _ranges
    out = []
    for d in by_key.values():
        d.pop("_seen")
        d["measures"] = _ranges(sorted(d["measures"]))
        out.append(d)
    return out


def assemble(ex: Excerpt, exe: Execution, roster: Roster) -> stream.Score:
    sc = stream.Score()
    mm = tempo.MetronomeMark(number=ex.qpm)
    for i, p in enumerate(roster.players):
        part = exe.parts[p.id]
        first = part.getElementsByClass(stream.Measure)[0]
        for c in first.getElementsByClass(clef.Clef):
            first.remove(c)
        spec = ins.get(p.instrument)
        if spec.clef == "bass":
            cl = clef.BassClef()
        elif spec.clef == "alto":
            cl = clef.AltoClef()
        else:
            cl = clef.bestClef(part, recurse=True)
        first.insert(0, cl)
        if i == 0:
            first.insert(0, copy.deepcopy(mm))
        sc.insert(0, part)
    exe.score = sc
    return sc


def coverage(plan: dict, ex: Excerpt, seg_len: int = 4) -> list[dict]:
    out = []
    for sp in ex.parts:
        segs = []
        for lo, hi in segments(ex, seg_len):
            mid = (lo + hi) / 2
            role = next((r["role"] for r in plan.get("roles", [])
                         if r["source_part"] == sp.id and r["start_measure"] <= mid <= r["end_measure"] + 0.99),
                        None)
            by = sorted({a["player"] for a in plan["assignments"]
                         if a["source_part"] == sp.id and a["start_measure"] <= hi and a["end_measure"] >= lo})
            dropped = any(d["source_part"] == sp.id and d["start_measure"] <= hi and d["end_measure"] >= lo
                          for d in plan.get("dropped", []))
            segs.append({"start_measure": lo, "end_measure": hi, "role": role, "covered_by": by,
                         "dropped": dropped and not by})
        out.append({"source_part": sp.id, "segments": segs})
    return out
