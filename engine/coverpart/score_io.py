"""Load a score, cut an excerpt, and summarize each part phrase by phrase.

The planner (AI or baseline) never reads raw notation. It reads these summaries.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from pathlib import Path

from music21 import chord, converter, note, stream, tempo

PART_COLORS = ["#B3261E", "#1F5FA8", "#2E7D4F", "#B26A00", "#6B3FA0", "#00838F"]

_NAME_TO_KEY = [
    ("violoncello", "cello"), ("cello", "cello"), ("viola", "viola"), ("violin", "violin"),
    ("contrabass", "double_bass"), ("double bass", "double_bass"),
]


def guess_instrument_key(name: str) -> str:
    n = (name or "").lower()
    for needle, key in _NAME_TO_KEY:
        if needle in n:
            return key
    return "violin"


@dataclass
class SourcePart:
    id: str
    name: str
    instrument: str
    color: str
    part: stream.Part

    def to_json(self) -> dict:
        return {"id": self.id, "name": self.name, "instrument": self.instrument, "color": self.color}


@dataclass
class Excerpt:
    score: stream.Score
    parts: list[SourcePart]
    start_measure: int
    end_measure: int
    qpm: float
    meta: dict = field(default_factory=dict)

    @property
    def measure_numbers(self) -> list[int]:
        return [m.number for m in self.parts[0].part.getElementsByClass(stream.Measure)]

    def part(self, pid: str) -> SourcePart:
        for p in self.parts:
            if p.id == pid:
                return p
        raise KeyError(pid)


def _movement_measures(part: stream.Part, movement_index: int) -> list[stream.Measure]:
    """OpenScore files hold every movement in one stream, with measure numbers restarting at
    each movement. Split on the resets and return the measures of one movement."""
    mov, prev, out = 0, None, []
    for m in part.getElementsByClass(stream.Measure):
        if prev is not None and m.number is not None and m.number <= prev and m.number <= 1:
            mov += 1
        if m.number is not None:
            prev = m.number
        if mov == movement_index:
            out.append(m)
    return out


def load_excerpt(path: str | Path, start: int, end: int, meta: dict | None = None,
                 default_qpm: float = 96.0) -> Excerpt:
    meta = meta or {}
    full = converter.parse(str(path))
    if isinstance(full, stream.Opus):
        full = full.scores[meta.get("movement_index", 0)]
    mov_idx = meta.get("movement_index", 0)
    ex = stream.Score()
    qpm = None
    for src in full.parts:
        mov = _movement_measures(src, mov_idx)
        sel = [m for m in mov if m.number is not None and start <= m.number <= end]
        if not sel:
            raise ValueError(f"no measures {start}-{end} in movement {mov_idx} of {path}")
        if qpm is None:
            for m in mov:
                if m.number is not None and m.number > end:
                    break
                mm = list(m.recurse().getElementsByClass(tempo.MetronomeMark))
                if mm and (mm[-1].number or mm[-1].getQuarterBPM()):
                    qpm = float(mm[-1].getQuarterBPM() or mm[-1].number)
        p = stream.Part()
        p.partName = src.partName
        p.id = src.id
        inst = src.getInstrument()
        if inst is not None:
            p.insert(0, copy.deepcopy(inst))
        first = sel[0]
        for i, m in enumerate(sel):
            mc = copy.deepcopy(m)
            if i == 0:
                for cls in ("Clef", "KeySignature", "TimeSignature"):
                    if not mc.getElementsByClass(cls):
                        ctx = first.getContextByClass(cls)
                        if ctx is not None:
                            mc.insert(0, copy.deepcopy(ctx))
            p.append(mc)
        ex.insert(0, p)
    qpm = qpm or default_qpm
    parts = []
    for i, p in enumerate(ex.parts):
        name = p.partName or (p.getInstrument().partName if p.getInstrument() else None) or f"Part {i + 1}"
        parts.append(SourcePart(f"P{i + 1}", name, guess_instrument_key(name), PART_COLORS[i % len(PART_COLORS)], p))
    return Excerpt(ex, parts, start, end, qpm, meta)


# --- summaries -----------------------------------------------------------------------------------

def _events(part: stream.Part, m_lo: int, m_hi: int):
    """Sounding events (Note/Chord) in measures m_lo..m_hi with absolute offsets."""
    out = []
    for m in part.getElementsByClass(stream.Measure):
        if m.number is None or not (m_lo <= m.number <= m_hi):
            continue
        for n in m.recurse().notes:
            if isinstance(n, (note.Note, chord.Chord)):
                out.append((m.getOffsetBySite(part) + n.getOffsetInHierarchy(m), m.number, n))
    out.sort(key=lambda t: t[0])
    return out


def _span(part: stream.Part, m_lo: int, m_hi: int) -> float:
    total = 0.0
    for m in part.getElementsByClass(stream.Measure):
        if m.number is not None and m_lo <= m.number <= m_hi:
            total += m.duration.quarterLength
    return total


def segments(ex: Excerpt, seg_len: int = 4) -> list[tuple[int, int]]:
    nums = ex.measure_numbers
    out = []
    for i in range(0, len(nums), seg_len):
        chunk = nums[i:i + seg_len]
        out.append((chunk[0], chunk[-1]))
    return out


def _pitches(n) -> list:
    return list(n.pitches) if isinstance(n, chord.Chord) else [n.pitch]


def summarize_cell(ex: Excerpt, sp: SourcePart, m_lo: int, m_hi: int, others: list[SourcePart]) -> dict:
    ev = _events(sp.part, m_lo, m_hi)
    span = _span(sp.part, m_lo, m_hi) or 1.0
    if not ev:
        return {"part": sp.id, "measures": [m_lo, m_hi], "active": 0.0, "notes": 0}
    sounding = sum(n.duration.quarterLength for _, _, n in ev)
    tops = [max(_pitches(n), key=lambda p: p.ps) for _, _, n in ev]
    lo = min((p for _, _, n in ev for p in _pitches(n)), key=lambda p: p.ps)
    hi = max((p for _, _, n in ev for p in _pitches(n)), key=lambda p: p.ps)
    steps = [abs(b.ps - a.ps) for a, b in zip(tops, tops[1:])]
    stepwise = sum(1 for s in steps if 0 < s <= 2) / max(1, len(steps))
    repeated = sum(1 for s in steps if s == 0) / max(1, len(steps))
    longest = max(n.duration.quarterLength for _, _, n in ev)
    chords_n = sum(1 for _, _, n in ev if isinstance(n, chord.Chord))
    # doubling: share of this part's onsets where another part sounds the same pitch class at the same time
    doubling = {}
    my_on = {(round(off, 3), p.pitchClass) for off, _, n in ev for p in _pitches(n)}
    for o in others:
        if o.id == sp.id:
            continue
        oev = _events(o.part, m_lo, m_hi)
        o_on = {(round(off, 3), p.pitchClass) for off, _, n in oev for p in _pitches(n)}
        if my_on:
            share = len(my_on & o_on) / len(my_on)
            if share >= 0.5:
                doubling[o.id] = round(share, 2)
    sketch = " ".join(
        f"{t.nameWithOctave}/{_dur(n.duration.quarterLength)}" for t, (_, _, n) in zip(tops[:14], ev[:14])
    )
    return {
        "part": sp.id,
        "measures": [m_lo, m_hi],
        "active": round(min(1.0, sounding / span), 2),
        "notes": len(ev),
        "notes_per_beat": round(len(ev) / span, 2),
        "low": lo.nameWithOctave,
        "high": hi.nameWithOctave,
        "mean_midi": round(sum(t.ps for t in tops) / len(tops), 1),
        "stepwise": round(stepwise, 2),
        "repeated_notes": round(repeated, 2),
        "longest_note_beats": longest,
        "chords": chords_n,
        "doubles": doubling,
        "opening_notes": sketch,
    }


def _dur(q: float) -> str:
    table = {4.0: "w", 3.0: "h.", 2.0: "h", 1.5: "q.", 1.0: "q", 0.75: "e.", 0.5: "e", 0.25: "s", 0.125: "t"}
    return table.get(float(q), f"{float(q):g}")


def summarize(ex: Excerpt, seg_len: int = 4) -> dict:
    segs = segments(ex, seg_len)
    cells = []
    for lo, hi in segs:
        row = [summarize_cell(ex, sp, lo, hi, ex.parts) for sp in ex.parts]
        active = [c for c in row if c.get("notes")]
        if active:
            top = max(active, key=lambda c: c["mean_midi"])
            bottom = min(active, key=lambda c: c["mean_midi"])
            for c in row:
                c["highest_part_here"] = c is top
                c["lowest_part_here"] = c is bottom
        cells.append({"measures": [lo, hi], "parts": row})
    first = ex.score.parts[0]
    ts = first.recurse().getElementsByClass("TimeSignature")
    ks = first.recurse().getElementsByClass("KeySignature")
    key_name = None
    try:
        key_name = ex.score.analyze("key").name
    except Exception:  # noqa: BLE001 - key analysis is a hint only
        pass
    return {
        "measures": [ex.start_measure, ex.end_measure],
        "time_signature": ts[0].ratioString if ts else None,
        "key_signature_sharps": ks[0].sharps if ks else None,
        "estimated_key": key_name,
        "tempo_qpm": ex.qpm,
        "source_parts": [{"id": sp.id, "name": sp.name} for sp in ex.parts],
        "segments": cells,
    }
