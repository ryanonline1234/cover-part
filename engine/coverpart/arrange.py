"""The pipeline: summarize → plan → validate (→ revise) → finish (execute, phrase-level octave
repair, single-note folds) → score → AI revision for leftover range / voicing problems, kept only if
the finished revision has fewer problems → export.

Planner "as_written" hands out the original parts (see planner_as_written) and skips every repair:
out-of-range notes stay where they are and get an x notehead in the score and in each part."""

from __future__ import annotations

import copy

from . import execute as ex_mod
from . import planner_as_written, planner_greedy
from .export import original_score, to_midi_b64, to_musicxml, with_title, written_part
from .plan import role_problems, validate
from .roster import Roster
from .score_io import Excerpt, summarize


def _runs(nums: list[int]) -> list[tuple[int, int]]:
    out = []
    for n in nums:
        if out and n == out[-1][1] + 1:
            out[-1] = (out[-1][0], n)
        else:
            out.append((n, n))
    return out


def _autofix(plan: dict, ex: Excerpt, roster: Roster) -> dict:
    """If a planner still leaves structural errors, make the plan valid without inventing music:
    discard entries with unknown ids, clamp spans to the excerpt, trim only the double-booked bars
    (spans the plan calls melody or bass keep their bars first), and mark unaddressed bars dropped."""
    from .plan import CHORD_POLICIES, sounding_measures
    plan = copy.deepcopy(plan)
    part_ids = {sp.id for sp in ex.parts}
    player_ids = {p.id for p in roster.players}
    lo, hi = ex.start_measure, ex.end_measure
    dropped = []
    for d in plan.get("dropped", []):
        if d.get("source_part") in part_ids:
            s0, e0 = max(lo, int(d["start_measure"])), min(hi, int(d["end_measure"]))
            if s0 <= e0:
                dropped.append(dict(d, start_measure=s0, end_measure=e0))
    roles = [r for r in plan.get("roles", []) if r.get("source_part") in part_ids]

    def essential(a):
        return any(r["source_part"] == a["source_part"] and r["role"] in ("melody", "bass")
                   and r["start_measure"] <= a["end_measure"] and r["end_measure"] >= a["start_measure"]
                   for r in roles)

    cand = []
    for a in plan.get("assignments", []):
        if a.get("source_part") not in part_ids:
            continue
        s0, e0 = max(lo, int(a["start_measure"])), min(hi, int(a["end_measure"]))
        if s0 > e0:
            continue
        if a.get("player") not in player_ids:
            dropped.append({"source_part": a["source_part"], "start_measure": s0, "end_measure": e0,
                            "reason": f"checker: unknown player {a.get('player')!r}"})
            continue
        cand.append(dict(a, start_measure=s0, end_measure=e0,
                         octave_shift=max(-3, min(3, int(a.get("octave_shift", 0)))),
                         chord_policy=a.get("chord_policy") if a.get("chord_policy") in CHORD_POLICIES else "top"))
    busy, kept = set(), []
    for a in sorted(cand, key=lambda a: 0 if essential(a) else 1):
        span = range(a["start_measure"], a["end_measure"] + 1)
        free = [m for m in span if (a["player"], m) not in busy]
        clash = [m for m in span if (a["player"], m) in busy]
        for s0, e0 in _runs(free):
            kept.append(dict(a, start_measure=s0, end_measure=e0))
            busy |= {(a["player"], m) for m in range(s0, e0 + 1)}
        for s0, e0 in _runs(clash):
            dropped.append({"source_part": a["source_part"], "start_measure": s0, "end_measure": e0,
                            "reason": "checker: this player was double-booked here"})
    kept.sort(key=lambda a: (a["source_part"], a["start_measure"]))
    plan["assignments"] = kept
    plan["dropped"] = dropped
    plan["roles"] = roles
    for sp in ex.parts:
        have = set()
        for a in plan["assignments"] + plan["dropped"]:
            if a["source_part"] == sp.id:
                have |= set(range(a["start_measure"], a["end_measure"] + 1))
        for s0, e0 in _runs(sorted(sounding_measures(ex, sp.id) - have)):
            plan["dropped"].append({"source_part": sp.id, "start_measure": s0, "end_measure": e0,
                                    "reason": "checker: planner did not address these bars"})
    return plan


def measures_dropped(plan: dict, ex: Excerpt) -> int:
    """Bars of music (part × bar with notes) that no player plays."""
    from .plan import sounding_measures
    n = 0
    for sp in ex.parts:
        have = set()
        for a in plan["assignments"]:
            if a["source_part"] == sp.id:
                have |= set(range(a["start_measure"], a["end_measure"] + 1))
        n += len(sounding_measures(ex, sp.id) - have)
    return n


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


BASS_MISSING_WEIGHT = 12  # a bar with no bass line at all counts like 12 problem notes (disclosed in DECISIONS.md)


def total_problems(b: dict) -> int:
    """Problems left after the deterministic repairs: notes that still had to be folded one by one,
    notes under the bass, and bars with no bass (weighted)."""
    return b["out_of_range"] + b["under_bass"] + BASS_MISSING_WEIGHT * b["bass_missing_bars"]


def handoffs(plan: dict) -> int:
    """How many times a source line changes hands between players (continuity; lower is calmer).
    Extra players' doublings (assignments marked role "doubling") are not the line's carrier, so
    they are left out: the line's own player is what this counts."""
    n = 0
    by_part: dict[str, list[dict]] = {}
    for a in plan["assignments"]:
        if a.get("role") == "doubling":
            continue
        by_part.setdefault(a["source_part"], []).append(a)
    for spans in by_part.values():
        spans.sort(key=lambda a: a["start_measure"])
        for prev, cur in zip(spans, spans[1:]):
            if cur["player"] != prev["player"] and cur["start_measure"] > prev["end_measure"]:
                n += 1
    return n


def player_activity(exe, ex: Excerpt, roster: Roster) -> list[dict]:
    """For each player: bars of the excerpt in which their final part has at least one note."""
    from music21 import stream
    total = len(ex.measure_numbers)
    out = []
    for p in roster.players:
        played = sum(1 for m in exe.parts[p.id].getElementsByClass(stream.Measure)
                     if len(m.recurse().notes) > 0)
        out.append({"player": p.id, "bars_played": played, "bars_total": total})
    return out


def excerpt_heading(piece: dict, ex: Excerpt) -> str:
    """'II. Poco adagio; cantabile — Theme, mm. 0–20' for file metadata."""
    bars = f"mm. {ex.start_measure}–{ex.end_measure}"
    mv = piece.get("movement")
    return f"{mv}, {bars}" if mv else bars


AI_CANDIDATES = 3  # independent AI plans per arrangement; the checker keeps one (DECISIONS.md, best-of-3)
SELECTION_RULE = ["total_problems", "measures_dropped", "handoffs"]


def _finish(p: dict, ex: Excerpt, roster: Roster, seg_len: int, repair: bool):
    """Every candidate plan gets the same deterministic repairs before it is scored: whole-
    phrase octave repair, then single-note folds as a last resort."""
    e = ex_mod.execute(p, ex, roster)
    if not repair:  # count the notes as they will be engraved, since each gets its own x
        ex_mod.split_like_engraving(e, roster)
    raw = len(e.violations)
    if e.violations and repair:
        p2, changed = ex_mod.best_octave_repair(p, ex, roster, seg_len)
        if changed:
            p, e = p2, ex_mod.execute(p2, ex, roster)
    unfit = [v.to_json(roster) for v in e.violations]
    if e.violations and repair:
        ex_mod.fold_out_of_range(e, roster)
    v, missing_bars = ex_mod.voicing_report(p, e, ex, roster)
    bad = {"out_of_range_raw": raw, "out_of_range": len(unfit), "folded": e.notes_folded,
           "under_bass": sum(x["events"] for x in v if x["kind"] == "below_bass"),
           "bass_missing_bars": missing_bars}  # distinct bars, not issue entries (one entry per bass line)
    return p, e, bad, v, unfit


def _settle(plan: dict, ex: Excerpt, roster: Roster, seg_len: int, repair: bool, log) -> dict:
    """Autofix whatever structure problems are left, then finish (repair + score) the plan."""
    try:
        problems_ok = validate(plan, ex, roster).ok
    except Exception:  # noqa: BLE001
        problems_ok = False
    if not problems_ok:
        log("  autofixing remaining structural problems")
        plan = _autofix(plan, ex, roster)
    role_left = role_problems(plan, ex)
    plan, exe, bad, voicing, unfit = _finish(plan, ex, roster, seg_len, repair)
    return {"plan": plan, "exe": exe, "bad": bad, "voicing": voicing, "unfit": unfit, "first": dict(bad),
            "role_left": role_left, "revisions": 0, "revision_log": [], "calls": 0}


def _ai_candidate(session, ex: Excerpt, roster: Roster, seg_len: int, lock, log) -> dict:
    """One independent AI attempt: first plan, structure loop (<= 2 rounds), autofix, repairs, then
    one range and one voicing revision, each kept only if the checker counts fewer problems.
    Planner calls run unlocked (they are slow and independent); every music21 step holds `lock`,
    because the candidates share one Excerpt and music21 streams are not thread-safe."""
    revisions = 0
    revision_log: list[dict] = []
    plan = session.first_plan()  # a failure here excludes the candidate (the caller logs it)
    for _ in range(2):
        with lock:
            try:
                errors = validate(plan, ex, roster).errors + role_problems(plan, ex)
            except Exception as e:  # noqa: BLE001 - a malformed plan is a problem to report, not a crash
                errors = [f"plan could not be checked: {type(e).__name__}: {e}"]
        if not errors:
            break
        log(f"  plan has {len(errors)} structural/role problem(s); asking the planner to revise")
        try:
            plan = session.revise(plan, errors, kind="structure")
            revisions += 1
        except Exception as e:  # noqa: BLE001
            revision_log.append({"kind": "structure", "kept": False, "before": None, "after": None,
                                 "why": f"planner call failed: {type(e).__name__}"})
            log(f"  structure revision failed: {e}")
            break
    with lock:
        st = _settle(plan, ex, roster, seg_len, True, log)
    st["revisions"], st["revision_log"] = revisions, revision_log

    def try_revision(kind: str, problems: list) -> None:
        """The checker has the last word: a revision is kept only if it is structurally valid and,
        after the same deterministic repairs, leaves fewer problems in total."""
        try:
            revised = session.revise(st["plan"], problems, kind=kind)
        except Exception as e:  # noqa: BLE001 - keep the valid plan we already have
            st["revision_log"].append({"kind": kind, "kept": False, "before": dict(st["bad"]), "after": None,
                                       "why": f"planner call failed: {type(e).__name__}"})
            log(f"  {kind} revision failed: {e}")
            return
        st["revisions"] += 1
        with lock:
            try:
                errs = validate(revised, ex, roster).errors + role_problems(revised, ex)
            except Exception as e:  # noqa: BLE001
                errs = [f"{type(e).__name__}: {e}"]
            if errs:
                st["revision_log"].append({"kind": kind, "kept": False, "before": dict(st["bad"]), "after": None,
                                           "why": f"{len(errs)} structural/role problem(s)"})
                log(f"  {kind} revision rejected: {errs[:2]}")
                return
            p2, e2, b2, v2, u2 = _finish(revised, ex, roster, seg_len, True)
        t_old, t_new = total_problems(st["bad"]), total_problems(b2)
        kept = t_new < t_old
        st["revision_log"].append({"kind": kind, "kept": kept, "before": dict(st["bad"]), "after": b2,
                                   "total_before": t_old, "total_after": t_new,
                                   "why": f"problems {t_old} -> {t_new}" + ("" if kept else " (not fewer)")})
        log(f"  {kind} revision {'kept' if kept else 'rejected'}: {t_old} -> {t_new}")
        if kept:
            st.update(plan=p2, exe=e2, bad=b2, voicing=v2, unfit=u2)

    if st["unfit"]:
        log(f"  {len(st['unfit'])} note(s) still out of range after octave repair; asking the planner to revise")
        try_revision("range", st["unfit"])
    if any(v["kind"] == "bass_missing" or v["max_semitones"] >= 3 for v in st["voicing"]):
        log(f"  {len(st['voicing'])} voicing problem(s); asking the planner to revise")
        try_revision("voicing", st["voicing"])
    st["calls"] = len(getattr(session, "calls", []))
    return st


def candidate_key(st: dict, ex: Excerpt) -> tuple:
    """How the checker ranks finished candidates: fewest problems (the revision gate's formula),
    then fewest line-bars left out, then fewest hand-offs, then the earlier candidate. It never
    looks at the reference melody maps."""
    return (total_problems(st["bad"]), measures_dropped(st["plan"], ex), handoffs(st["plan"]), st["index"])


def _candidate_summary(st: dict, ex: Excerpt, chosen: bool) -> dict:
    revs = st["revision_log"]
    return {
        "index": st["index"], "chosen": chosen,
        "total_first": total_problems(st["first"]), "total_final": total_problems(st["bad"]),
        "final": {k: st["bad"][k] for k in ("out_of_range_raw", "out_of_range", "folded", "under_bass",
                                            "bass_missing_bars")},
        "measures_dropped": measures_dropped(st["plan"], ex), "handoffs": handoffs(st["plan"]),
        "revisions_kept": sum(1 for r in revs if r["kept"]),
        "revisions_rejected": sum(1 for r in revs if not r["kept"]),
        "planner_calls": st["calls"],
    }


def _run_ai(ex: Excerpt, roster: Roster, summary: dict, seg_len: int, n: int, ai_backend, model, log):
    """Best-of-n: n independent AI candidates run concurrently; the checker keeps one."""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from . import planner_ai
    lock = threading.Lock()
    sessions = []
    for k in range(n):  # created here, in index order, so candidate k is always session k
        lg = (lambda m, k=k: log(f"[candidate {k}] {m.lstrip()}")) if n > 1 else log
        with lock:
            sessions.append((k, lg, planner_ai.Session(summary, roster, ex, backend=ai_backend, model=model, log=lg)))

    def run(item):
        k, lg, session = item
        st = _ai_candidate(session, ex, roster, seg_len, lock, lg)
        st["index"] = k
        return st

    done, failed = [], []
    with ThreadPoolExecutor(max_workers=n) as pool:
        futs = [(item[0], pool.submit(run, item)) for item in sessions]
        for k, f in futs:
            try:
                done.append(f.result())
            except Exception as e:  # noqa: BLE001 - a failed candidate is excluded, not fatal
                failed.append((k, e))
                log(f"[candidate {k}] excluded: planner call failed: {type(e).__name__}: {e}")
    if not done:
        raise failed[0][1]
    chosen = min(done, key=lambda st: candidate_key(st, ex))
    if n > 1:
        log(f"checker chose candidate {chosen['index']} of {len(done)} "
            f"(problems: {', '.join(str(total_problems(st['bad'])) for st in done)})")
    chosen["candidates"] = [_candidate_summary(st, ex, st is chosen) for st in done]
    chosen["candidates_failed"] = [{"index": k, "error": type(e).__name__} for k, e in failed]
    unselected = min(done, key=lambda st: st["index"])  # by index, never by quality
    chosen["first_plan_unselected"] = dict(unselected["first"])
    chosen["first_plan_unselected_index"] = unselected["index"]
    return chosen, sessions[0][2].model_name


def arrange(ex: Excerpt, roster: Roster, planner: str = "greedy", piece: dict | None = None,
            seg_len: int = 4, ai_backend: str | None = None, model: str | None = None,
            log=print, fixed_plan: dict | None = None, candidates: int = AI_CANDIDATES) -> dict:
    piece = piece or {}
    summary = summarize(ex, seg_len)
    used_model = None
    repair = planner != "as_written"  # "as written" shows the unrepaired parts: no octave repair, no folds
    if planner == "ai":
        st, used_model = _run_ai(ex, roster, summary, seg_len, max(1, int(candidates)), ai_backend, model, log)
    else:
        if planner == "fixed":
            plan = copy.deepcopy(fixed_plan)
            used_model = model
        elif planner == "greedy":
            plan = planner_greedy.plan(ex, summary, roster, seg_len)
        elif planner == "as_written":
            plan = planner_as_written.plan(ex, roster)
        else:
            raise ValueError(planner)
        st = _settle(plan, ex, roster, seg_len, repair, log)
    plan, exe, bad, voicing, unfit = st["plan"], st["exe"], st["bad"], st["voicing"], st["unfit"]
    first, revisions, revision_log, role_left = st["first"], st["revisions"], st["revision_log"], st["role_left"]

    if not repair:
        marked = ex_mod.mark_out_of_range(exe, roster)
        if marked != len(exe.violations):  # the x noteheads must be exactly the violations
            raise RuntimeError(f"marked {marked} x noteheads for {len(exe.violations)} out-of-range notes")
    sc = ex_mod.assemble(ex, exe, roster)

    title = piece.get("title", "Excerpt")
    composer = piece.get("composer")
    heading = excerpt_heading(piece, ex)
    with_title(sc, title, composer, f"{heading} — covered for {roster.label}")
    orig = with_title(original_score(ex), title, composer, heading)
    checks = {
        "notes_total": exe.notes_total,
        "notes_out_of_range": len(exe.violations),
        "first_plan": first,
        "final": bad,
        "notes_out_of_range_before_repair": first["out_of_range_raw"],
        "notes_out_of_range_after_ai_revision": bad["out_of_range_raw"],
        "notes_out_of_range_after_octave_repair": bad["out_of_range"],
        "notes_folded": exe.notes_folded,
        "chords_reduced": exe.chords_reduced,
        "repair_rounds": revisions,
        "revisions": revision_log,
        "essential_coverage": {
            "melody": melody_coverage(plan, ex, piece.get("melody_map", [])),
            "bass": bass_preserved(orig, sc),
        },
        "lines_dropped": len(plan.get("dropped", [])),
        "measures_dropped": measures_dropped(plan, ex),
        "bass_inversions": bad["under_bass"],
        "bass_inversions_before_revision": first["under_bass"],
        "voicing_issues": voicing,
        "role_problems_left": role_left,
        "handoffs": handoffs(plan),
        "player_activity": player_activity(exe, ex, roster),
        "violations": [v.to_json(roster) for v in exe.violations],
    }
    if "candidates" in st:  # AI best-of-n: first_plan / revisions / final above are the chosen candidate's
        checks["candidates"] = st["candidates"]
        checks["candidates_failed"] = st["candidates_failed"]
        checks["selection_rule"] = SELECTION_RULE
        # an unselected single draft (the first candidate's first plan), so first-draft comparisons
        # against the baseline are not flattered by the selection
        checks["first_plan_unselected"] = st["first_plan_unselected"]
        checks["first_plan_unselected_index"] = st["first_plan_unselected_index"]
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
            "parts": {p.id: to_musicxml(written_part(exe.parts[p.id], roster, p.id, title, composer, heading))
                      for p in roster.players},
        },
        "midi": {"original": to_midi_b64(orig), "arranged": to_midi_b64(sc)},
    }
