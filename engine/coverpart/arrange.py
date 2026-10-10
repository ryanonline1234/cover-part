"""The pipeline: summarize → plan → validate (→ revise) → execute → range check (→ revise) →
whole-phrase octave repair → single-note fold (last resort) → export."""

from __future__ import annotations

import copy

from . import execute as ex_mod
from . import planner_greedy
from .export import original_score, to_midi_b64, to_musicxml, with_title, written_part
from .plan import validate
from .roster import Roster
from .score_io import Excerpt, summarize


def _autofix(plan: dict, ex: Excerpt, roster: Roster, errors: list[str]) -> dict:
    """If a planner still leaves structural errors, make the plan valid without inventing music:
    drop later overlapping assignments and mark unaddressed measures as dropped."""
    plan = copy.deepcopy(plan)
    busy, kept = set(), []
    for a in plan["assignments"]:
        span = {(a["player"], m) for m in range(a["start_measure"], a["end_measure"] + 1)}
        if span & busy:
            plan.setdefault("dropped", []).append({
                "source_part": a["source_part"], "start_measure": a["start_measure"],
                "end_measure": a["end_measure"], "reason": "checker: planner double-booked a player here"})
            continue
        busy |= span
        kept.append(a)
    plan["assignments"] = kept
    from .plan import sounding_measures
    for sp in ex.parts:
        have = set()
        for a in plan["assignments"] + plan.get("dropped", []):
            if a["source_part"] == sp.id:
                have |= set(range(a["start_measure"], a["end_measure"] + 1))
        for m in sorted(sounding_measures(ex, sp.id) - have):
            plan["dropped"].append({"source_part": sp.id, "start_measure": m, "end_measure": m,
                                    "reason": "checker: planner did not address this measure"})
    return plan


def melody_coverage(plan: dict, ex: Excerpt, melody_map: list[dict]) -> float | None:
    """Share of reference-melody measures (from the corpus manifest, curated independently of
    any planner) that some player actually plays."""
    if not melody_map:
        return None
    name_to_id = {sp.name.lower(): sp.id for sp in ex.parts}
    alias = {"violin i": "violin 1", "violin ii": "violin 2", "cello": "violoncello"}
    need = set()
    from .plan import sounding_measures
    for span in melody_map:
        nm = span["part"].lower()
        pid = name_to_id.get(nm) or name_to_id.get(alias.get(nm, nm))
        if pid is None:
            continue
        sounding = sounding_measures(ex, pid)
        need |= {(pid, m) for m in range(span["start_measure"], span["end_measure"] + 1) if m in sounding}
    if not need:
        return None
    have = {(a["source_part"], m) for a in plan["assignments"]
            for m in range(a["start_measure"], a["end_measure"] + 1)}
    return round(len(need & have) / len(need), 3)


def bass_coverage(plan: dict, ex: Excerpt, summary: dict) -> float:
    need = set()
    for seg in summary["segments"]:
        for c in seg["parts"]:
            if c.get("lowest_part_here"):
                lo, hi = seg["measures"]
                need |= {(c["part"], m) for m in range(lo, hi + 1)}
    from .plan import sounding_measures
    need = {(p, m) for p, m in need if m in sounding_measures(ex, p)}
    have = {(a["source_part"], m) for a in plan["assignments"]
            for m in range(a["start_measure"], a["end_measure"] + 1)}
    return round(len(need & have) / len(need), 3) if need else 1.0


def arrange(ex: Excerpt, roster: Roster, planner: str = "greedy", piece: dict | None = None,
            seg_len: int = 4, ai_backend: str | None = None, model: str | None = None,
            log=print) -> dict:
    piece = piece or {}
    summary = summarize(ex, seg_len)
    revisions = 0
    used_model = None
    if planner == "greedy":
        plan = planner_greedy.plan(ex, summary, roster, seg_len)
    elif planner == "ai":
        from . import planner_ai
        session = planner_ai.Session(summary, roster, ex, backend=ai_backend, model=model, log=log)
        plan = session.first_plan()
        used_model = session.model_name
        for _ in range(2):
            problems = validate(plan, ex, roster)
            if problems.ok:
                break
            log(f"  plan has {len(problems.errors)} structural problem(s); asking the planner to revise")
            plan = session.revise(plan, problems.errors, kind="structure")
            revisions += 1
    else:
        raise ValueError(planner)

    problems = validate(plan, ex, roster)
    if not problems.ok:
        log(f"  autofixing {len(problems.errors)} remaining structural problem(s)")
        plan = _autofix(plan, ex, roster, problems.errors)

    exe = ex_mod.execute(plan, ex, roster)
    before = len(exe.violations)
    if before and planner == "ai":
        log(f"  {before} note(s) out of range; asking the planner to revise")
        viol = [v.to_json(roster) for v in exe.violations]
        revised = session.revise(plan, viol, kind="range")
        revisions += 1
        if validate(revised, ex, roster).ok:
            plan = revised
            exe = ex_mod.execute(plan, ex, roster)
    after_ai = len(exe.violations)
    if exe.violations:
        plan, changed = ex_mod.best_octave_repair(plan, ex, roster)
        if changed:
            exe = ex_mod.execute(plan, ex, roster)
    after_octave = len(exe.violations)
    if exe.violations:
        ex_mod.fold_out_of_range(exe, roster)
    sc = ex_mod.assemble(ex, exe, roster)

    title = piece.get("title", "Excerpt")
    composer = piece.get("composer")
    with_title(sc, f"{title} — covered for {roster.label}", composer)
    orig = with_title(original_score(ex), title, composer)
    checks = {
        "notes_total": exe.notes_total,
        "notes_out_of_range": len(exe.violations),
        "notes_out_of_range_before_repair": before,
        "notes_out_of_range_after_ai_revision": after_ai,
        "notes_out_of_range_after_octave_repair": after_octave,
        "notes_folded": exe.notes_folded,
        "chords_reduced": exe.chords_reduced,
        "repair_rounds": revisions,
        "essential_coverage": {
            "melody": melody_coverage(plan, ex, piece.get("melody_map", [])),
            "bass": bass_coverage(plan, ex, summary),
        },
        "lines_dropped": len(plan.get("dropped", [])),
        "violations": [v.to_json(roster) for v in exe.violations],
    }
    return {
        "piece": {k: v for k, v in piece.items() if k != "melody_map"} | {"measures": [ex.start_measure, ex.end_measure]},
        "source_parts": [sp.to_json() for sp in ex.parts],
        "roster": roster.to_json(),
        "planner": planner,
        "model": used_model,
        "plan": plan,
        "checks": checks,
        "coverage": ex_mod.coverage(plan, ex, seg_len),
        "summary_for_planner": summary,
        "musicxml": {
            "original": to_musicxml(orig),
            "arranged": to_musicxml(sc),
            "parts": {p.id: to_musicxml(written_part(exe.parts[p.id], roster, p.id, title)) for p in roster.players},
        },
        "midi": {"original": to_midi_b64(orig), "arranged": to_midi_b64(sc)},
    }
