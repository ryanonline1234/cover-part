// What the checker's numbers mean for a director: when a number deserves a warning, who is left with
// little to play, and which lines were left out where. Every value comes from the result file; the
// thresholds below are the UI's judgment calls about when to flag a number, not results.
import { mm, pct } from "../music";
import type { ArrangeResult } from "../types";

/** Melody kept below this is flagged. */
export const MELODY_WARN = 0.9;
/** Bass at the bottom below this is flagged. */
export const BASS_WARN = 0.8;
/** A player with a line in fewer than this share of the excerpt's bars is "sitting out". */
export const SITTING_OUT = 0.25;

export interface Activity {
  player: string;
  /** Typed name if any, else the result's label. */
  label: string;
  played: number;
  total: number;
}

/**
 * Bars each player has something to play. Uses checks.player_activity when the engine wrote it; older
 * results don't have it, so the bars are counted from plan.assignments instead.
 */
export function activityOf(r: ArrangeResult, names?: Map<string, string>): Activity[] {
  const [m0, m1] = r.piece.measures;
  const total = Math.max(1, m1 - m0 + 1);
  const fromEngine = Array.isArray(r.checks.player_activity) ? r.checks.player_activity : [];
  return r.roster.players.map((p) => {
    const label = names?.get(p.id) || p.label;
    const e = fromEngine.find((x) => x.player === p.id);
    if (e && Number.isFinite(e.bars_played) && Number.isFinite(e.bars_total) && e.bars_total > 0) {
      return { player: p.id, label, played: e.bars_played, total: e.bars_total };
    }
    const bars = new Set<number>();
    for (const a of r.plan.assignments) {
      if (a.player !== p.id) continue;
      for (let m = Math.max(m0, a.start_measure); m <= Math.min(m1, a.end_measure); m++) bars.add(m);
    }
    return { player: p.id, label, played: bars.size, total };
  });
}

export function sittingOut(r: ArrangeResult, names?: Map<string, string>): Activity[] {
  return activityOf(r, names).filter((a) => a.played / a.total < SITTING_OUT);
}

/** "Trumpet in B♭: 1 of 21 bars" */
export function activityText(a: Activity): string {
  return `${a.label}: ${a.played} of ${a.total} ${a.total === 1 ? "bar" : "bars"}`;
}

/** Notes sounding under the line that carries the original bass, after repairs (null if not measured). */
export function underBass(r: ArrangeResult): number | null {
  const v = r.checks.final?.under_bass ?? r.checks.bass_inversions;
  return typeof v === "number" ? v : null;
}

/** Where each source line was left out, spans merged: [["Viola", "mm. 0–7, 12–20"], ...]. */
export function leftOutSpans(r: ArrangeResult): Array<{ line: string; where: string }> {
  const [m0, m1] = r.piece.measures;
  const names = new Map(r.source_parts.map((s) => [s.id, s.name]));
  const byPart = new Map<string, Array<[number, number]>>();
  for (const d of r.plan.dropped) {
    const a = Math.max(m0, d.start_measure);
    const b = Math.min(m1, d.end_measure);
    if (b < a) continue;
    const list = byPart.get(d.source_part) ?? [];
    list.push([a, b]);
    byPart.set(d.source_part, list);
  }
  const order = r.source_parts.map((s) => s.id).filter((id) => byPart.has(id));
  for (const id of byPart.keys()) if (!order.includes(id)) order.push(id);
  return order.map((id) => {
    const spans = (byPart.get(id) ?? []).sort((x, y) => x[0] - y[0]);
    const merged: Array<[number, number]> = [];
    for (const [a, b] of spans) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    const whole = merged.length === 1 && merged[0][0] <= m0 && merged[0][1] >= m1;
    const where = whole
      ? "all bars"
      : merged.length === 1
        ? mm(merged[0][0], merged[0][1])
        : `mm. ${merged.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ")}`;
    return { line: names.get(id) ?? id, where };
  });
}

export interface Flag {
  key: "playable" | "melody" | "bass" | "under" | "sitting";
  text: string;
}

/** The checker's warnings, in plain words, for the status line. Empty when nothing is flagged. */
export function flagsOf(r: ArrangeResult, names?: Map<string, string>): Flag[] {
  const c = r.checks;
  const out: Flag[] = [];
  if (c.notes_out_of_range > 0) out.push({ key: "playable", text: `${c.notes_out_of_range} ${c.notes_out_of_range === 1 ? "note" : "notes"} out of range` });
  const melody = c.essential_coverage.melody;
  if (melody !== null && melody < MELODY_WARN) out.push({ key: "melody", text: `melody kept ${pct(melody)}` });
  const bass = c.essential_coverage.bass;
  if (bass !== null && bass < BASS_WARN) out.push({ key: "bass", text: `bass at the bottom ${pct(bass)} of the time` });
  const under = underBass(r);
  if (under !== null && under > 0) out.push({ key: "under", text: `${under} ${under === 1 ? "note sounds" : "notes sound"} under the bass` });
  const idle = sittingOut(r, names);
  if (idle.length) {
    out.push({
      key: "sitting",
      text: idle.map((a) => (a.played === 0 ? `${a.label} has nothing to play` : `${a.label} plays ${a.played} of ${a.total} bars`)).join(", "),
    });
  }
  return out;
}
