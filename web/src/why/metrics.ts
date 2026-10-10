// Numbers the why page shows, computed from the result / comparison JSON (never typed in).
import type { ArrangeResult, Badness, Comparison, ComparisonRow } from "../types";
import type { MelodySpan } from "./melodyMaps";

/** Manifest part names -> result source_part ids (same alias table as engine/coverpart/report.py). */
export const PART_ALIAS: Record<string, string> = {
  "Violin I": "P1",
  "Violin II": "P2",
  Viola: "P3",
  Violoncello: "P4",
  Cello: "P4",
};

/** Same weight as engine/coverpart/arrange.py BASS_MISSING_WEIGHT. */
export const BASS_MISSING_WEIGHT = 12;

/** out_of_range + under_bass + 12 x bars with no bass (engine/coverpart/arrange.py total_problems). */
export function totalProblems(b: Badness): number {
  return b.out_of_range + b.under_bass + BASS_MISSING_WEIGHT * b.bass_missing_bars;
}

/** Bars (part x bar) of the reference melody, as "P1:3" keys. */
export function referenceBars(map: MelodySpan[]): Set<string> {
  const out = new Set<string>();
  for (const s of map) {
    const p = PART_ALIAS[s.part];
    if (!p) continue;
    for (let b = s.start_measure; b <= s.end_measure; b++) out.add(`${p}:${b}`);
  }
  return out;
}

/** Bars the planner itself labeled "melody". */
export function labeledMelodyBars(result: ArrangeResult): Set<string> {
  const out = new Set<string>();
  for (const r of result.plan.roles) {
    if (r.role !== "melody") continue;
    for (let b = r.start_measure; b <= r.end_measure; b++) out.add(`${r.source_part}:${b}`);
  }
  return out;
}

/** engine/coverpart/report.py melody_identified: share of reference bars the planner labeled melody. */
export function melodyIdentified(result: ArrangeResult, map: MelodySpan[]): { hit: number; of: number; share: number | null } {
  const ref = referenceBars(map);
  const lab = labeledMelodyBars(result);
  let hit = 0;
  for (const k of ref) if (lab.has(k)) hit++;
  return { hit, of: ref.size, share: ref.size ? Math.round((hit / ref.size) * 1000) / 1000 : null };
}

/** For each bar m0..m1: which source part the reference says carries the tune (first entry wins), or null. */
export function tuneByBar(map: MelodySpan[], m0: number, m1: number): (string | null)[] {
  const out: (string | null)[] = [];
  for (let b = m0; b <= m1; b++) {
    const s = map.find((x) => x.start_measure <= b && b <= x.end_measure);
    out.push(s ? PART_ALIAS[s.part] ?? null : null);
  }
  return out;
}

/** For each bar m0..m1: the source part(s) the plan labels melody. */
export function labeledByBar(result: ArrangeResult, m0: number, m1: number): string[][] {
  const out: string[][] = [];
  for (let b = m0; b <= m1; b++) {
    const parts = result.plan.roles
      .filter((r) => r.role === "melody" && r.start_measure <= b && b <= r.end_measure)
      .map((r) => r.source_part);
    out.push([...new Set(parts)]);
  }
  return out;
}

/** First bar where the reference tune changes part (e.g. Violin I -> cello), or null. */
export function firstHandoff(map: MelodySpan[]): { bar: number; from: string; to: string } | null {
  const sorted = [...map].sort((a, b) => a.start_measure - b.start_measure);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].part !== sorted[i - 1].part && sorted[i].start_measure > sorted[i - 1].start_measure) {
      return { bar: sorted[i].start_measure, from: sorted[i - 1].part, to: sorted[i].part };
    }
  }
  return null;
}

export function pct(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "n/a";
  return `${Math.round(x * 100)}%`;
}

export function mean1(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "n/a";
  return x.toFixed(1);
}

export function rowFor(c: Comparison, piece: string, roster: string): ComparisonRow | undefined {
  return c.rows.find((r) => r.piece === piece && r.roster === roster);
}

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Pitch helpers (ranges in the result JSON are music21 names: "B-3", "F#4", "A-3").
// ---------------------------------------------------------------------------

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function nameToMidi(name: string): number | null {
  const m = /^([A-Ga-g])([#\-b]*)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  let alter = 0;
  for (const ch of m[2]) alter += ch === "#" ? 1 : -1;
  return (Number(m[3]) + 1) * 12 + STEP[m[1].toUpperCase()] + alter;
}

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export function midiToName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Lowest/highest sounding pitch per <part>, in document order, from a concert-pitch MusicXML string. */
export function partRanges(xml: string): Array<{ lo: number; hi: number } | null> {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return Array.from(doc.querySelectorAll("part")).map((part) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of Array.from(part.querySelectorAll("note > pitch"))) {
        const step = p.querySelector("step")?.textContent ?? "";
        const oct = Number(p.querySelector("octave")?.textContent ?? "NaN");
        const alter = Number(p.querySelector("alter")?.textContent ?? "0");
        if (!(step in STEP) || !Number.isFinite(oct)) continue;
        const midi = (oct + 1) * 12 + STEP[step] + alter;
        lo = Math.min(lo, midi);
        hi = Math.max(hi, midi);
      }
      return Number.isFinite(lo) ? { lo, hi } : null;
    });
  } catch {
    return [];
  }
}

/** Short excerpt label from a result's piece: "Haydn, Op. 76 No. 3, II, mm. 0–20". */
export function shortPiece(r: ArrangeResult | null | undefined): string {
  if (!r) return "";
  const p = r.piece;
  const surname = p.composer.replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(-1)[0];
  const opus = /Op\.\s?\d+(?:\s?No\.\s?\d+)?/.exec(p.title)?.[0]?.replace(/Op\.(\d)/, "Op. $1").replace(/No\.(\d)/, "No. $1");
  const nick = /“([^”]+)”/.exec(p.title)?.[1];
  const mv = p.movement ?? "";
  const bars = p.measures[0] === p.measures[1] ? `m. ${p.measures[0]}` : `mm. ${p.measures[0]}–${p.measures[1]}`;
  return [surname + (opus ? ` ${opus}` : "") + (nick ? ` “${nick}”` : ""), mv, bars].filter(Boolean).join(", ");
}
