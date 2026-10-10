"""Execute a plan: build the arranged score, check every note against every player, repair.

Everything here is deterministic. The planner proposes; this module disposes.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field

from music21 import (articulations, chord, clef, dynamics, expressions, instrument, interval, note,
                     stream, tempo)

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
    """Return the (offset, element) content of a measure as ONE line."""
    voices = [v for v in m.voices if v.notes]
    if len(voices) <= 1:
        src = voices[0] if voices else m
        return [(e.getOffsetBySite(src), e) for e in src.notesAndRests]

    def mean(v):
        ps = [p.ps for n in v.notes for p in n.pitches]
        return sum(ps) / len(ps)

    v = max(voices, key=mean) if policy != "bottom" else min(voices, key=mean)
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
    if not n.isRest:
        n.articulations = [a for a in n.articulations if not isinstance(a, articulations.TechnicalIndication)]
        if shift:
            n.transpose(interval.Interval(12 * shift), inPlace=True)
        n.style.color = color
    return n


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
        r = note.Rest(quarterLength=tm.highestTime or tm.barDuration.quarterLength)
        r.fullMeasure = True
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
            owner[(player.id, num)] = idx
    for pid, part in parts.items():
        _fix_ties(part)
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
    exe.violations = []
    for pid, part in exe.parts.items():
        player = roster.player(pid)
        for n in part.recurse().notes:
            for p in n.pitches:
                if not player.fits(p):
                    exe.violations.append(Violation(pid, n.getContextByClass(stream.Measure).number,
                                                    p.nameWithOctave, -1))


def best_octave_repair(plan: dict, ex: Excerpt, roster: Roster) -> tuple[dict, int]:
    """For each assignment with out-of-range notes, try whole-phrase octave shifts. Returns the
    repaired plan and how many assignments changed."""
    plan = copy.deepcopy(plan)
    changed = 0
    for i, a in enumerate(plan["assignments"]):
        player = roster.player(a["player"])
        lo, hi = player.range_sounding
        pitches = []
        for num in range(a["start_measure"], a["end_measure"] + 1):
            src = _src_measure(ex, a["source_part"], num)
            if src is None:
                continue
            for n in src.recurse().notes:
                ps = sorted(p.ps for p in n.pitches)
                if a.get("chord_policy") == "bottom":
                    ps = ps[:1]
                elif a.get("chord_policy") != "keep":
                    ps = ps[-1:]
                pitches.extend(ps)
        if not pitches:
            continue

        def misses(shift: int) -> int:
            return sum(1 for ps in pitches if not lo.ps <= ps + 12 * shift <= hi.ps)

        cur = int(a.get("octave_shift", 0))
        if misses(cur) == 0:
            continue
        best = min(range(-3, 4), key=lambda s: (misses(s), abs(s - cur)))
        if misses(best) < misses(cur):
            a["octave_shift"] = best
            a["reason"] = a.get("reason", "") + f" [checker moved this phrase {best - cur:+d} octave(s) to fit the range]"
            changed += 1
    return plan, changed


def _measure_notes(part: stream.Part, number: int) -> list[tuple[float, float, float]]:
    for m in part.getElementsByClass(stream.Measure):
        if m.number == number:
            out = []
            for n in m.notes:
                s = float(n.getOffsetBySite(m))
                e = s + float(n.duration.quarterLength)
                if e > s:
                    out.append((s, e, min(p.ps for p in n.pitches)))
            return out
    return []


def voicing_issues(plan: dict, exe: Execution, ex: Excerpt, roster: Roster) -> list[dict]:
    """Texture inversions: moments where some player sounds BELOW the player carrying the original
    bass line (the source line with the lowest note in that bar), or the bass line is missing."""
    by_player: dict[str, dict] = {}
    for num in ex.measure_numbers:
        lows = {}
        for sp in ex.parts:
            notes = _measure_notes(sp.part, num)
            if notes:
                lows[sp.id] = min(ps for _, _, ps in notes)
        if not lows:
            continue
        bass_src = min(lows, key=lows.get)
        carriers = [a["player"] for a in plan["assignments"]
                    if a["source_part"] == bass_src and a["start_measure"] <= num <= a["end_measure"]]
        if not carriers:
            k = ("(none)", bass_src)
            d = by_player.setdefault(k, {"player": None, "bass_line": bass_src, "kind": "bass_missing",
                                         "measures": [], "events": 0, "max_semitones": 0})
            d["measures"].append(num)
            continue
        bass_notes = [x for c in carriers for x in _measure_notes(exe.parts[c], num)]
        for p in roster.players:
            if p.id in carriers:
                continue
            for s, e, ps in _measure_notes(exe.parts[p.id], num):
                under = [b_ps - ps for bs, be, b_ps in bass_notes if bs < e and s < be and b_ps > ps]
                if under:
                    k = (p.id, bass_src)
                    d = by_player.setdefault(k, {"player": p.id, "bass_line": f"{bass_src} on {'/'.join(carriers)}",
                                                 "kind": "below_bass", "measures": [], "events": 0,
                                                 "max_semitones": 0})
                    if num not in d["measures"]:
                        d["measures"].append(num)
                    d["events"] += 1
                    d["max_semitones"] = max(d["max_semitones"], max(under))
    from .plan import _ranges
    out = []
    for d in by_player.values():
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
