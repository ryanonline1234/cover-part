"""The "as written" reference: what happens if a director just hands out the original parts.

Not an arranger and not a baseline to beat: it shows the problem the other planners solve. Source
parts in score order go to players sorted from highest to lowest range center; nothing is shifted,
nothing is repaired. arrange() skips every repair for this planner and marks each note a player
can't reach with an x notehead.
"""

from __future__ import annotations

from . import instruments as ins
from .roster import Player, Roster
from .score_io import Excerpt

NOBODY_LEFT = "nobody left to play it"


def range_center(player: Player) -> float:
    lo, hi = player.range_sounding
    return (lo.ps + hi.ps) / 2


def pairing(ex: Excerpt, roster: Roster) -> tuple[list[tuple], list, list[Player]]:
    """(source part, player) pairs, the source parts nobody is left for, and the players left
    without a part. Players are sorted by range center, highest first; ties keep roster order."""
    players = sorted(roster.players, key=lambda p: -range_center(p))  # sorted() is stable
    n = min(len(ex.parts), len(players))
    return list(zip(ex.parts[:n], players[:n])), ex.parts[n:], players[n:]


def _pretty(p) -> str:
    return p.name.replace("-", "♭").replace("#", "♯") + str(p.octave)


def _ordinal(k: int) -> str:
    if k == 0:
        return "highest"
    n = k + 1
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix} highest"


def _join(xs: list[str]) -> str:
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]


def plan(ex: Excerpt, roster: Roster) -> dict:
    pairs, left_out, idle = pairing(ex, roster)
    lo, hi = ex.start_measure, ex.end_measure
    assignments = []
    for k, (sp, pl) in enumerate(pairs):
        r_lo, r_hi = pl.range_sounding
        one_note = ins.get(pl.instrument).family != "strings"
        assignments.append({
            "source_part": sp.id, "start_measure": lo, "end_measure": hi, "player": pl.id,
            "octave_shift": 0, "chord_policy": "top" if one_note else "keep",
            "reason": f"as written: {sp.name} goes to {pl.label}, the {_ordinal(k)} range center "
                      f"(sounding {_pretty(r_lo)}–{_pretty(r_hi)}); no octave shift, no repair",
        })
    dropped = [{"source_part": sp.id, "start_measure": lo, "end_measure": hi, "reason": NOBODY_LEFT}
               for sp in left_out]
    names = [sp.name for sp in ex.parts]
    summary = (
        "As written (no arranging): the original parts are handed out unchanged. The source parts in score "
        f"order ({_join(names)}) are paired with the players sorted from highest to lowest range center "
        "(the midpoint of each player's sounding range): "
        + "; ".join(f"{sp.name} → {pl.label}" for sp, pl in pairs) + ". "
        "No octave shifts, no chord changes beyond what a one-note instrument requires (a wind or brass "
        "player plays the top note of a double stop or chord), and no repair: a note outside a player's range "
        "stays where it is and is marked with an x notehead."
    )
    if left_out:
        summary += (f" There are fewer players than parts, so {_join([sp.name for sp in left_out])} "
                    f"{'is' if len(left_out) == 1 else 'are'} left out: {NOBODY_LEFT}.")
    if idle:
        summary += (f" There are more players than parts, so {_join([p.label for p in idle])} "
                    f"{'has' if len(idle) == 1 else 'have'} nothing to play.")
    return {"summary": summary, "roles": [], "assignments": assignments, "dropped": dropped}
