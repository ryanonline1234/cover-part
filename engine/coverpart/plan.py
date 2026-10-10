"""Plan schema and validation.

A plan says, for every stretch of every source line, which player covers it (with an octave
shift and a chord policy) or why it is dropped. Validation is plain code: the planner's
output is never trusted, only checked.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .roster import Roster
from .score_io import Excerpt, _events

ROLES = ("melody", "bass", "countermelody", "inner", "doubling", "accompaniment")
CHORD_POLICIES = ("top", "bottom", "keep")

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "2-4 sentences: the musical idea of this cover"},
        "roles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source_part": {"type": "string"},
                    "start_measure": {"type": "integer"},
                    "end_measure": {"type": "integer"},
                    "role": {"type": "string", "enum": list(ROLES)},
                },
                "required": ["source_part", "start_measure", "end_measure", "role"],
            },
        },
        "assignments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source_part": {"type": "string"},
                    "start_measure": {"type": "integer"},
                    "end_measure": {"type": "integer"},
                    "player": {"type": "string"},
                    "octave_shift": {"type": "integer", "minimum": -3, "maximum": 3},
                    "chord_policy": {"type": "string", "enum": list(CHORD_POLICIES)},
                    "reason": {"type": "string"},
                },
                "required": ["source_part", "start_measure", "end_measure", "player", "octave_shift",
                             "chord_policy", "reason"],
            },
        },
        "dropped": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source_part": {"type": "string"},
                    "start_measure": {"type": "integer"},
                    "end_measure": {"type": "integer"},
                    "reason": {"type": "string"},
                },
                "required": ["source_part", "start_measure", "end_measure", "reason"],
            },
        },
    },
    "required": ["summary", "roles", "assignments", "dropped"],
}


@dataclass
class PlanProblems:
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def sounding_measures(ex: Excerpt, pid: str) -> set[int]:
    return {mnum for _, mnum, _ in _events(ex.part(pid).part, ex.start_measure, ex.end_measure)}


def validate(plan: dict, ex: Excerpt, roster: Roster) -> PlanProblems:
    """Structural checks. Range fit is checked later, on the executed notes."""
    pr = PlanProblems()
    part_ids = {sp.id for sp in ex.parts}
    player_ids = {p.id for p in roster.players}
    lo, hi = ex.start_measure, ex.end_measure

    def check_span(kind: str, i: int, a: dict) -> bool:
        if a["source_part"] not in part_ids:
            pr.errors.append(f"{kind}[{i}]: unknown source_part {a['source_part']!r}")
            return False
        if not (lo <= a["start_measure"] <= a["end_measure"] <= hi):
            pr.errors.append(f"{kind}[{i}]: measures {a['start_measure']}-{a['end_measure']} outside {lo}-{hi}")
            return False
        return True

    busy: dict[tuple[str, int], int] = {}
    for i, a in enumerate(plan.get("assignments", [])):
        if not check_span("assignments", i, a):
            continue
        if a["player"] not in player_ids:
            pr.errors.append(f"assignments[{i}]: unknown player {a['player']!r}")
            continue
        if a.get("chord_policy", "top") not in CHORD_POLICIES:
            pr.errors.append(f"assignments[{i}]: bad chord_policy")
        if not -3 <= int(a.get("octave_shift", 0)) <= 3:
            pr.errors.append(f"assignments[{i}]: octave_shift out of -3..3")
        for m in range(a["start_measure"], a["end_measure"] + 1):
            k = (a["player"], m)
            if k in busy:
                pr.errors.append(
                    f"player {a['player']} has two lines at once in m.{m} "
                    f"(assignments[{busy[k]}] and assignments[{i}])")
            else:
                busy[k] = i
    for i, d in enumerate(plan.get("dropped", [])):
        check_span("dropped", i, d)

    for sp in ex.parts:
        need = sounding_measures(ex, sp.id)
        have = set()
        for a in plan.get("assignments", []):
            if a["source_part"] == sp.id:
                have |= set(range(a["start_measure"], a["end_measure"] + 1))
        for d in plan.get("dropped", []):
            if d["source_part"] == sp.id:
                have |= set(range(d["start_measure"], d["end_measure"] + 1))
        missing = sorted(need - have)
        if missing:
            pr.errors.append(f"{sp.id} is neither assigned nor dropped in measures {_ranges(missing)}")
    return pr


def role_problems(plan: dict, ex: Excerpt) -> list[str]:
    """The planner's own labels, held against it: a span it calls melody or bass may not be dropped."""
    errs = []
    for d in plan.get("dropped", []):
        sounding = sounding_measures(ex, d["source_part"])
        for r in plan.get("roles", []):
            if r["source_part"] != d["source_part"] or r["role"] not in ("melody", "bass"):
                continue
            lo, hi = max(d["start_measure"], r["start_measure"]), min(d["end_measure"], r["end_measure"])
            hit = [m for m in range(lo, hi + 1) if m in sounding]
            if hit:
                errs.append(
                    f"You dropped {d['source_part']} in m.{_ranges(hit)}, which you labeled {r['role']}. "
                    f"Never drop the {r['role']}: split it between players at a phrase point, or keep it and "
                    f"let the checker move a few single notes by an octave.")
    return errs


def _ranges(nums: list[int]) -> str:
    out, start, prev = [], None, None
    for n in nums:
        if start is None:
            start = prev = n
        elif n == prev + 1:
            prev = n
        else:
            out.append(f"{start}-{prev}" if start != prev else f"{start}")
            start = prev = n
    if start is not None:
        out.append(f"{start}-{prev}" if start != prev else f"{start}")
    return ", ".join(out)
