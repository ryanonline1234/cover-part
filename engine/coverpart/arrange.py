"""The pipeline: summarize → plan → validate (→ revise) → execute → range check (→ revise) →
whole-phrase octave repair → single-note fold (last resort) → export."""

from __future__ import annotations

import copy

from . import execute as ex_mod
from . import planner_greedy
from .export import original_score, to_midi_b64, to_musicxml, with_title, written_part
from .plan import role_problems, validate
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


def bass_preserved(orig, arranged) -> float:
    """Share of sounding time in which the cover's lowest note has the same pitch class as the
    original's lowest note. Octave-agnostic, independent of any planner's labels, and it also
    catches texture inversions (a moved line ending up under the bass)."""
    def lows(s):
        out = []
        for c in s.chordify().flatten().notes:
            if c.pitches and c.duration.quarterLength > 0:
                out.append((float(c.offset), float(c.duration.quarterLength),
                            min(c.pitches, key=lambda p: p.ps).pitchClass))
        return out

    a = lows(orig)
    b = sorted(lows(arranged))
    total = kept = 0.0
    j = 0
    for o, d, pc in a:
        total += d
        while j + 1 < len(b) and b[j + 1][0] <= o + 1e-6:
            j += 1
        if b and b[j][0] <= o + 1e-6 < b[j][0] + b[j][1] and b[j][2] == pc:
            kept += d
    return round(kept / total, 3) if total else 1.0


def handoffs(plan: dict) -> int:
    """How many times a source line changes hands between players (continuity; lower is calmer)."""
    n = 0
    by_part: dict[str, list[dict]] = {}
    for a in plan["assignments"]:
        by_part.setdefault(a["source_part"], []).append(a)
    for spans in by_part.values():
        spans.sort(key=lambda a: a["start_measure"])
        for prev, cur in zip(spans, spans[1:]):
            if cur["player"] != prev["player"] and cur["start_measure"] > prev["end_measure"]:
                n += 1
    return n


def arrange(ex: Excerpt, roster: Roster, planner: str = "greedy", piece: dict | None = None,
            seg_len: int = 4, ai_backend: str | None = None, model: str | None = None,
            log=print, fixed_plan: dict | None = None) -> dict:
    piece = piece or {}
    summary = summarize(ex, seg_len)
    revisions = 0
    used_model = None
    if planner == "fixed":
        plan = copy.deepcopy(fixed_plan)
        used_model = model
    elif planner == "greedy":
        plan = planner_greedy.plan(ex, summary, roster, seg_len)
    elif planner == "ai":
        from . import planner_ai
        session = planner_ai.Session(summary, roster, ex, backend=ai_backend, model=model, log=log)
        plan = session.first_plan()
        used_model = session.model_name
        for _ in range(2):
            errors = validate(plan, ex, roster).errors + role_problems(plan, ex)
            if not errors:
                break
            log(f"  plan has {len(errors)} structural/role problem(s); asking the planner to revise")
            plan = session.revise(plan, errors, kind="structure")
            revisions += 1
    else:
        raise ValueError(planner)

    problems = validate(plan, ex, roster)
    if not problems.ok:
        log(f"  autofixing {len(problems.errors)} remaining structural problem(s)")
        plan = _autofix(plan, ex, roster, problems.errors)

    exe = ex_mod.execute(plan, ex, roster)
    before = len(exe.violations)
    revision_log: list[dict] = []

    def badness(p, e):
        v = ex_mod.voicing_issues(p, e, ex, roster)
        return {"out_of_range": len(e.violations),
                "under_bass": sum(x["events"] for x in v if x["kind"] == "below_bass"),
                "bass_missing_bars": sum(1 for x in v if x["kind"] == "bass_missing")}, v

    def try_revision(kind, problems):
        """The checker has the last word: a revision is kept only if it is structurally valid and
        makes no measured problem worse."""
        nonlocal plan, exe, revisions
        revised = session.revise(plan, problems, kind=kind)
        revisions += 1
        errs = validate(revised, ex, roster).errors + role_problems(revised, ex)
        old, _ = badness(plan, exe)
        if errs:
            revision_log.append({"kind": kind, "kept": False, "why": f"{len(errs)} structural/role problem(s)",
                                 "before": old, "after": None})
            log(f"  {kind} revision rejected: {errs[:2]}")
            return
        new_exe = ex_mod.execute(revised, ex, roster)
        new, _ = badness(revised, new_exe)
        worse = [k for k in old if new[k] > old[k]]
        kept = not worse
        revision_log.append({"kind": kind, "kept": kept, "before": old, "after": new,
                             "why": "no measured problem got worse" if kept else f"made {', '.join(worse)} worse"})
        log(f"  {kind} revision {'kept' if kept else 'rejected'}: {old} -> {new}")
        if kept:
            plan, exe = revised, new_exe

    if before and planner == "ai":
        log(f"  {before} note(s) out of range; asking the planner to revise")
        try_revision("range", [v.to_json(roster) for v in exe.violations])
    _, voicing_before = badness(plan, exe)
    if planner == "ai" and any(v["kind"] == "bass_missing" or v["max_semitones"] >= 3 for v in voicing_before):
        log(f"  {len(voicing_before)} voicing problem(s); asking the planner to revise")
        try_revision("voicing", voicing_before)
    after_ai = len(exe.violations)
    if exe.violations:
        plan, changed = ex_mod.best_octave_repair(plan, ex, roster, seg_len)
        if changed:
            exe = ex_mod.execute(plan, ex, roster)
    after_octave = len(exe.violations)
    if exe.violations:
        ex_mod.fold_out_of_range(exe, roster)
    voicing_final = ex_mod.voicing_issues(plan, exe, ex, roster)
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
        "revisions": revision_log,
        "essential_coverage": {
            "melody": melody_coverage(plan, ex, piece.get("melody_map", [])),
            "bass": bass_preserved(orig, sc),
        },
        "lines_dropped": len(plan.get("dropped", [])),
        "bass_inversions": sum(v["events"] for v in voicing_final if v["kind"] == "below_bass"),
        "bass_inversions_before_revision": sum(v["events"] for v in voicing_before if v["kind"] == "below_bass"),
        "voicing_issues": voicing_final,
        "handoffs": handoffs(plan),
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
