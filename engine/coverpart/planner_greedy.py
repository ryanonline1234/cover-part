"""The no-AI baseline. Deliberately reasonable, not a strawman: it guesses the melody is the
highest line and the bass the lowest, ranks the rest by activity, and works phrase by phrase:

- a line stays with the player who had it in the previous phrase while that player is free and
  fits it no worse than any other free player (no more out-of-range notes at their best octave,
  and no larger octave shift); otherwise it goes to the free
  player whose range fits it best, with a whole-phrase octave shift if that helps (ties go to the
  line's own instrument, then to the player whose range centre is closest);
- a last phrase shorter than MIN_LAST_PHRASE bars joins the phrase before it;
- a player left without a line doubles the melody or the bass (whichever they can play with fewer
  out-of-range notes at their best whole-octave shift), never at a pitch that would sound under
  the bass. Such an assignment is marked role "doubling"; it is still that player's only line.
"""

from __future__ import annotations

from music21 import stream

from .execute import _measure_notes, _pick_voice
from .roster import Player, Roster
from .score_io import Excerpt, summarize_cell

SHIFTS = (0, -1, 1, -2, 2)
MIN_LAST_PHRASE = 2  # bars


def summary_text(seg_len: int) -> str:
    return ("Rule-based plan (no AI): the highest line is treated as the melody and the lowest as the bass; "
            "the remaining lines are ranked by how busy they are. Working "
            f"{seg_len} bars at a time, a line stays with the player who had it while that player still "
            "fits it as well as anyone free; otherwise it goes to the free player whose range fits it best. "
            f"A last phrase shorter than {MIN_LAST_PHRASE} bars joins the one before. A player left "
            "without a line doubles the melody or the bass, whichever fits their range better, at an "
            "octave that doesn't sound under the bass.")


def _phrases(ex: Excerpt, summary: dict) -> list[tuple[tuple[int, int], list[dict]]]:
    """The summary's phrases, with a too-short last phrase merged into the one before."""
    segs = [(tuple(s["measures"]), s["parts"]) for s in summary["segments"]]
    if len(segs) > 1:
        (lo, hi), _ = segs[-1]
        n_bars = sum(1 for m in ex.measure_numbers if lo <= m <= hi)
        if n_bars < MIN_LAST_PHRASE:
            plo = segs[-2][0][0]
            cells = [summarize_cell(ex, sp, plo, hi, ex.parts) for sp in ex.parts]
            segs = segs[:-2] + [((plo, hi), cells)]
    return segs


def _line(ex: Excerpt, pid: str, lo: int, hi: int, policy: str) -> list[tuple[int, float, float, float]]:
    """(bar, start, end, sounding ps) of a source line as one player plays it: the same voice
    choice and chord reduction as execute()."""
    out = []
    for m in ex.part(pid).part.getElementsByClass(stream.Measure):
        if m.number is None or not lo <= m.number <= hi:
            continue
        for off, e in _pick_voice(m, policy):
            if e.isRest or not e.pitches:
                continue
            d = float(e.duration.quarterLength)
            if d <= 0:
                continue
            ps = sorted(p.ps for p in e.pitches)
            out.append((m.number, float(off), float(off) + d, ps[0] if policy == "bottom" else ps[-1]))
    return out


def _bounds(pl: Player) -> tuple[float, float]:
    lo, hi = pl.range_sounding
    return lo.ps, hi.ps


def _misses(notes, pl: Player, shift: int) -> int:
    lo, hi = _bounds(pl)
    return sum(1 for *_, ps in notes if not lo <= ps + 12 * shift <= hi)


def _center(notes, pl: Player, shift: int) -> float:
    lo, hi = _bounds(pl)
    return abs((lo + hi) / 2 - (sum(n[3] for n in notes) / len(notes) + 12 * shift))


def _fold(ps: float, lo: float, hi: float) -> float:
    """Where execute.fold_out_of_range puts a note."""
    while ps > hi and ps - 12 >= lo:
        ps -= 12
    while ps < lo and ps + 12 <= hi:
        ps += 12
    return ps


def _best_shift(notes, pl: Player, prefer: int | None = None) -> tuple[tuple, int]:
    """((misses, |shift|, not the preferred shift, distance from the range center), shift) of the
    best whole-phrase octave shift for this player."""
    best = None
    for s in SHIFTS:
        key = (_misses(notes, pl, s), abs(s), 0 if s == prefer else 1, _center(notes, pl, s))
        if best is None or key < best[0]:
            best = (key, s)
    return best


def _floors(ex: Excerpt, lo: int, hi: int, carried: dict[str, list[tuple]]) -> dict[int, list[tuple]]:
    """Per bar: (t0, t1, floor) — at each moment, the lowest note sounded by the players carrying
    the line that is the bass in the ORIGINAL at that moment (as execute.voicing_issues defines it).
    carried: source part -> notes (bar, start, end, ps) its players sound, after folds."""
    order = {sp.id: i for i, sp in enumerate(ex.parts)}
    out: dict[int, list[tuple]] = {}
    for num in ex.measure_numbers:
        if not lo <= num <= hi:
            continue
        orig = {sp.id: _measure_notes(sp.part, num) for sp in ex.parts}
        cover = {src: [(s, e, ps) for b, s, e, ps in notes if b == num] for src, notes in carried.items()}
        cuts = sorted({t for notes in list(orig.values()) + list(cover.values()) for s0, e0, _ in notes
                       for t in (s0, e0)})
        rows = []
        for t0, t1 in zip(cuts, cuts[1:]):
            if t1 - t0 < 1e-6:
                continue
            sounding = [(ps, -order[pid], pid) for pid, notes in orig.items() for s0, e0, ps in notes if s0 <= t0 < e0]
            if not sounding:
                continue
            bass_src = min(sounding)[2]
            now = [ps for s0, e0, ps in cover.get(bass_src, []) if s0 <= t0 < e0]
            if now:
                rows.append((t0, t1, min(now)))
        out[num] = rows
    return out


def _under(notes_folded, floors: dict[int, list[tuple]]) -> bool:
    for b, s, e, ps in notes_folded:
        for t0, t1, floor in floors.get(b, []):
            if t0 < e and s < t1 and ps < floor:
                return True
    return False


def plan(ex: Excerpt, summary: dict, roster: Roster, seg_len: int = 4) -> dict:
    by_id = {p.id: p for p in roster.players}
    names = {sp.id: sp.name for sp in ex.parts}
    inst = {sp.id: sp.instrument for sp in ex.parts}
    cells = []  # (lo, hi, source, player|None, shift, role, doubles|None, how)
    prev_holder: dict[str, tuple[str, int]] = {}  # source -> (player, shift) in the previous phrase
    prev_double: dict[str, tuple[str, int]] = {}  # player -> (source, shift) of their previous doubling
    for (lo, hi), seg_cells in _phrases(ex, summary):
        active = [c for c in seg_cells if c.get("notes")]
        if not active:
            prev_holder, prev_double = {}, {}
            continue
        by_pitch = sorted(active, key=lambda c: -c["mean_midi"])
        melody, bass = by_pitch[0], by_pitch[-1]
        rest = sorted([c for c in active if c is not melody and c is not bass],
                      key=lambda c: -c["notes_per_beat"])
        order = [(melody, "melody")] + ([(bass, "bass")] if bass is not melody else []) + \
                [(c, "inner") for c in rest]
        lines = {c["part"]: _line(ex, c["part"], lo, hi, "bottom" if role == "bass" else "top")
                 for c, role in order}
        free = list(roster.players)
        got: dict[str, tuple[Player, int]] = {}
        kept: set[str] = set()
        # Lines in order (melody, bass, then the busiest): a line stays with the player who had it
        # while that player is still free and fits it no worse than the best other free player;
        # otherwise it goes to the free player whose range fits it best.
        for c, _role in order:
            src = c["part"]
            if not free:
                break
            notes = lines[src]
            options = []
            for pl in free:
                key, s = _best_shift(notes, pl) if notes else ((0, 0, 1, 0.0), 0)
                # misses, |shift|, the line's own instrument first (Violin 2 plays Violin 2's line
                # when it fits as well as anyone), distance from the range center
                options.append(((key[0], key[1], 0 if pl.instrument == inst[src] else 1, key[3]), pl, s))
            best_key, best_pl, best_s = min(options, key=lambda o: o[0])
            holder = by_id[prev_holder[src][0]] if src in prev_holder else None
            if holder is not None and holder in free and notes:
                (m_keep, *_), s_keep = _best_shift(notes, holder, prefer=prev_holder[src][1])
                others = [o[0][:2] for o in options if o[1] is not holder]
                # "fits no worse": no more out-of-range notes than the best other free player, and no
                # further from the line's own octave (an extra octave shift moves the line across
                # the other lines and puts notes under the bass)
                if not others or (m_keep, abs(s_keep)) <= min(others):
                    best_pl, best_s = holder, s_keep
                    kept.add(src)
            got[src] = (best_pl, best_s)
            free.remove(best_pl)
        for c, role in order:
            src = c["part"]
            if src in got:
                how = "stays with the player who had it" if src in kept else "best range fit among the free players"
                cells.append((lo, hi, src, got[src][0].id, got[src][1], role, None, how))
            else:
                cells.append((lo, hi, src, None, 0, role, None, ""))
        # 3) players with no line double the melody or the bass, never under the bass
        doubles_now: dict[str, tuple[str, int]] = {}
        if free:
            carried = {}
            for src, (pl, s) in got.items():
                plo, phi = _bounds(pl)
                carried[src] = [(b, t0, t1, _fold(ps + 12 * s, plo, phi)) for b, t0, t1, ps in lines[src]]
            floors = _floors(ex, lo, hi, carried)
            options = [("melody", melody["part"])]
            if bass is not melody:
                options.append(("bass", bass["part"]))
            for pl in free:
                plo, phi = _bounds(pl)
                best = None
                for kind, src in options:
                    if src not in got:
                        continue
                    notes = lines[src]  # melody read top-down, bass bottom-up, as in step 1
                    if not notes:
                        continue
                    for s in SHIFTS:
                        folded = [(b, t0, t1, _fold(ps + 12 * s, plo, phi)) for b, t0, t1, ps in notes]
                        if _under(folded, floors):
                            continue
                        sticky = 0 if prev_double.get(pl.id) == (src, s) else 1
                        key = (_misses(notes, pl, s), sticky, abs(s), 0 if kind == "melody" else 1,
                               _center(notes, pl, s))
                        if best is None or key < best[0]:
                            best = (key, kind, src, s)
                if best is not None:
                    _, kind, src, s = best
                    cells.append((lo, hi, src, pl.id, s, "doubling", kind, ""))
                    doubles_now[pl.id] = (src, s)
        prev_holder = {src: (pl.id, s) for src, (pl, s) in got.items()}
        prev_double = doubles_now

    assignments, dropped, roles = [], [], []
    for lo, hi, src, pl, shift, role, doubles, how in cells:
        if doubles is None:
            roles.append({"source_part": src, "start_measure": lo, "end_measure": hi, "role": role})
        if pl is None:
            dropped.append({"source_part": src, "start_measure": lo, "end_measure": hi,
                            "reason": "rule-based: no free player left for this line"})
            continue
        if doubles is None:
            a = {"source_part": src, "start_measure": lo, "end_measure": hi, "player": pl,
                 "octave_shift": shift, "chord_policy": "bottom" if role == "bass" else "top",
                 "reason": f"rule-based: {role} (by register); {how}"}
        else:
            a = {"source_part": src, "start_measure": lo, "end_measure": hi, "player": pl,
                 "octave_shift": shift, "chord_policy": "bottom" if doubles == "bass" else "top",
                 "role": "doubling", "doubles": doubles,
                 "reason": f"rule-based: no line left for this player, so it doubles the {doubles} "
                           f"({names.get(src, src)}) at an octave that fits and stays above the bass"}
        assignments.append(a)
    # merge continuations: same line, same player, same octave, same kind (line or doubling)
    assignments.sort(key=lambda a: (a["source_part"], a["player"], a.get("role", ""), a["start_measure"]))
    merged = []
    for a in assignments:
        m = merged[-1] if merged else None
        if m and m["source_part"] == a["source_part"] and m["player"] == a["player"] \
                and m["octave_shift"] == a["octave_shift"] and m.get("role") == a.get("role") \
                and m["end_measure"] + 1 == a["start_measure"]:
            m["end_measure"] = a["end_measure"]
        else:
            merged.append(a)
    return {
        "summary": summary_text(seg_len),
        "roles": roles,
        "assignments": merged,
        "dropped": dropped,
    }
