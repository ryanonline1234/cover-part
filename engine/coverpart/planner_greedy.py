"""The no-AI baseline. Deliberately reasonable, not a strawman: it guesses the melody is the
highest line and the bass the lowest, ranks the rest by activity, and gives each line to the
free player whose range fits it best (with a whole-phrase octave shift if that helps)."""

from __future__ import annotations

from .roster import Roster
from .score_io import Excerpt, _events, segments


def _pitches_in(ex: Excerpt, pid: str, lo: int, hi: int) -> list[float]:
    out = []
    for _, _, n in _events(ex.part(pid).part, lo, hi):
        out.append(max(p.ps for p in n.pitches))
    return out


def plan(ex: Excerpt, summary: dict, roster: Roster, seg_len: int = 4) -> dict:
    cells = []  # (lo, hi, source, player|None, shift, role)
    for seg in summary["segments"]:
        lo, hi = seg["measures"]
        active = [c for c in seg["parts"] if c.get("notes")]
        if not active:
            continue
        by_pitch = sorted(active, key=lambda c: -c["mean_midi"])
        melody, bass = by_pitch[0], by_pitch[-1]
        rest = sorted([c for c in active if c is not melody and c is not bass],
                      key=lambda c: -c["notes_per_beat"])
        order = [(melody, "melody")] + ([(bass, "bass")] if bass is not melody else []) + \
                [(c, "inner") for c in rest]
        free = list(roster.players)
        for c, role in order:
            ps = _pitches_in(ex, c["part"], lo, hi)
            best = None
            for pl in free:
                plo, phi = (p.ps for p in pl.range_sounding)
                for shift in (0, -1, 1, -2, 2):
                    miss = sum(1 for x in ps if not plo <= x + 12 * shift <= phi)
                    center = abs((plo + phi) / 2 - (sum(ps) / len(ps) + 12 * shift))
                    key = (miss, abs(shift), center)
                    if best is None or key < best[0]:
                        best = (key, pl, shift)
            if best is None:
                cells.append((lo, hi, c["part"], None, 0, role))
            else:
                cells.append((lo, hi, c["part"], best[1].id, best[2], role))
                free.remove(best[1])

    assignments, dropped, roles = [], [], []
    for lo, hi, src, pl, shift, role in cells:
        roles.append({"source_part": src, "start_measure": lo, "end_measure": hi, "role": role})
        if pl is None:
            dropped.append({"source_part": src, "start_measure": lo, "end_measure": hi,
                            "reason": "baseline: no free player left for this line"})
            continue
        prev = assignments[-1] if assignments else None
        if prev and prev["source_part"] == src and prev["player"] == pl and prev["octave_shift"] == shift \
                and prev["end_measure"] + 1 == lo:
            prev["end_measure"] = hi
        else:
            assignments.append({"source_part": src, "start_measure": lo, "end_measure": hi, "player": pl,
                                "octave_shift": shift, "chord_policy": "bottom" if role == "bass" else "top",
                                "reason": f"baseline: {role} (by register) → best range fit"})
    # merge non-adjacent-in-list continuations too
    assignments.sort(key=lambda a: (a["source_part"], a["player"], a["start_measure"]))
    merged = []
    for a in assignments:
        if merged and merged[-1]["source_part"] == a["source_part"] and merged[-1]["player"] == a["player"] \
                and merged[-1]["octave_shift"] == a["octave_shift"] and merged[-1]["end_measure"] + 1 == a["start_measure"]:
            merged[-1]["end_measure"] = a["end_measure"]
        else:
            merged.append(a)
    return {
        "summary": "Baseline (no AI): the highest line is treated as the melody and the lowest as the bass; "
                   "the remaining lines are ranked by how busy they are; each goes to the free player whose "
                   "range fits it best.",
        "roles": roles,
        "assignments": merged,
        "dropped": dropped,
    }
