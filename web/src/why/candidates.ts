// The AI's independent plans for one pair (checks.candidates[] in an AI result; engine/coverpart/arrange.py
// _candidate_summary). Best-of-N: each plan gets the same revision loop and repairs; the checker keeps the one
// with the fewest problems (ties: fewer line-bars left out, then fewer hand-offs; candidate_key). Selection
// never sees the melody maps. The kept plan's own loop is the top-level checks.first_plan / revisions / final.
import type { ArrangeResult, Badness } from "../types";
import { num } from "./metrics";

export interface Candidate {
  /** 1-based, in the order the AI wrote them (engine index + 1). */
  n: number;
  /** Problems after its own revision loop and repairs: the selection key. Null when the plan failed. */
  total: number | null;
  /** Problems in its first draft, after the octave repair. */
  totalFirst: number | null;
  /** Tie-breaks, in order. */
  dropped: number | null;
  handoffs: number | null;
  chosen: boolean;
  revisionsKept: number | null;
  revisionsRejected: number | null;
  final: Badness | null;
  /** Set when this plan could not be made (planner call failed; excluded from the choice). */
  error: string | null;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** checks.candidates plus checks.candidates_failed, in the order written; [] for single-plan results. */
export function candidatesOf(r: ArrangeResult | null | undefined): Candidate[] {
  const c = r?.checks as unknown as Raw | undefined;
  if (!c) return [];
  const done: Candidate[] = list(c.candidates).map((x) => ({
    n: (num(x.index) ?? 0) + 1,
    total: num(x.total_final),
    totalFirst: num(x.total_first),
    dropped: num(x.measures_dropped),
    handoffs: num(x.handoffs),
    chosen: x.chosen === true,
    revisionsKept: num(x.revisions_kept),
    revisionsRejected: num(x.revisions_rejected),
    final: isObj(x.final) ? (x.final as unknown as Badness) : null,
    error: null,
  }));
  const failed: Candidate[] = list(c.candidates_failed).map((x) => ({
    n: (num(x.index) ?? 0) + 1,
    total: null,
    totalFirst: null,
    dropped: null,
    handoffs: null,
    chosen: false,
    revisionsKept: null,
    revisionsRejected: null,
    final: null,
    error: typeof x.error === "string" && x.error ? x.error : "failed",
  }));
  return [...done, ...failed].sort((a, b) => a.n - b.n);
}

export function chosenOf(cands: Candidate[]): Candidate | null {
  return cands.find((c) => c.chosen) ?? null;
}

/** Demo 3's stepper needs the kept plan (whose loop is checks.revisions) to show both outcomes of the gate. */
export function qualifies(r: ArrangeResult | null | undefined): boolean {
  const revs = r?.checks.revisions ?? [];
  return !!chosenOf(candidatesOf(r)) && revs.some((v) => v.kept) && revs.some((v) => !v.kept);
}

/** "best of 3, picked by the checker" when the result carries candidates, else null (never claimed blind). */
export function pickNote(r: ArrangeResult | null | undefined): string | null {
  const n = candidatesOf(r).length;
  return n > 1 ? `best of ${n}, picked by the checker` : null;
}

/** "best of 3" (short form for labels), or null. */
export function pickShort(r: ArrangeResult | null | undefined): string | null {
  const n = candidatesOf(r).length;
  return n > 1 ? `best of ${n}` : null;
}
