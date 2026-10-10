// AI best-of-n, in words. For the precomputed AI results the AI writes several independent plans; each
// goes through the same revision loop and repairs, and the checker keeps the one with the fewest problems
// (ties: fewer line-bars left out, then fewer hand-offs, then the earlier plan). Every number here comes
// from checks.candidates in the result file. Rule-based results never have candidates.
import type { ArrangeResult, Candidate } from "./types";

export interface BestOf {
  /** Plans that came back and were compared. */
  n: number;
  /** Plans asked for (compared + failed). */
  asked: number;
  chosen: Candidate;
  /** The other compared plans, in the order they were written. */
  others: Candidate[];
  failed: number;
}

export function bestOf(r: ArrangeResult): BestOf | null {
  if (r.planner !== "ai") return null;
  const cands = Array.isArray(r.checks.candidates) ? r.checks.candidates.filter((c) => c && typeof c.total_final === "number") : [];
  if (!cands.length) return null;
  const chosen = cands.find((c) => c.chosen);
  if (!chosen) return null;
  const failed = Array.isArray(r.checks.candidates_failed) ? r.checks.candidates_failed.length : 0;
  const others = cands.filter((c) => c !== chosen).sort((a, b) => a.index - b.index);
  return { n: cands.length, asked: cands.length + failed, chosen, others, failed };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Why the kept plan won a tie on problems, from the numbers (null when it didn't need a tie-break). */
function tieBreak(b: BestOf): string | null {
  const tied = b.others.filter((c) => c.total_final === b.chosen.total_final);
  if (!tied.length) return null;
  const md0 = b.chosen.measures_dropped;
  const ho0 = b.chosen.handoffs;
  const why = tied.map((c) => {
    if (md0 === undefined || ho0 === undefined || c.measures_dropped === undefined || c.handoffs === undefined) return "rule";
    if (c.measures_dropped > md0) return "dropped";
    if (c.measures_dropped === md0 && c.handoffs > ho0) return "handoffs";
    if (c.measures_dropped === md0 && c.handoffs === ho0) return "earlier";
    return "rule";
  });
  const all = (k: string) => why.every((w) => w === k);
  if (all("dropped")) return `On the tie it kept the one that leaves out fewer line-bars (${md0} against ${tied.map((c) => c.measures_dropped).join(", ")}).`;
  if (all("handoffs")) return `On the tie it kept the one with fewer hand-offs between players (${ho0} against ${tied.map((c) => c.handoffs).join(", ")}).`;
  if (all("earlier")) {
    return tied.length === b.others.length
      ? "They also tied on line-bars left out and hand-offs, so it kept the one written first."
      : "The plan with the same count also tied on line-bars left out and hand-offs, so it kept the earlier of the two.";
  }
  return "Plans tied on problems are ranked by fewer line-bars left out, then fewer hand-offs, then the earlier plan.";
}

/** "The AI wrote 3 plans; the checker kept the one with the fewest problems: 12 (others: 19, 40)." */
export function bestOfSentence(b: BestOf): string {
  if (b.n < 2) {
    return `The AI was asked for ${plural(b.asked, "plan", "plans")}; only 1 came back (${plural(b.failed, "planner call", "planner calls")} failed), so there was nothing to choose between.`;
  }
  const parts = [
    `The AI wrote ${b.n} plans; the checker kept the one with the fewest problems: ${b.chosen.total_final} (${b.others.length === 1 ? "other" : "others"}: ${b.others.map((c) => c.total_final).join(", ")}).`,
  ];
  const tie = tieBreak(b);
  if (tie) parts.push(tie);
  if (b.failed) parts.push(`${plural(b.failed, "more plan", "more plans")} failed to come back and ${b.failed === 1 ? "was" : "were"} left out.`);
  return parts.join(" ");
}

/** Short tag for headings: "best of 3" (null when there was no choice). */
export function bestOfTag(r: ArrangeResult): string | null {
  const b = bestOf(r);
  return b && b.n >= 2 ? `best of ${b.n}` : null;
}
