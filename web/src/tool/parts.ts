// Per-player facts derived from a result: what each player covers, where, and which MIDI track is theirs.
import { useRef, useSyncExternalStore } from "react";
import type { ABPlayer, Track } from "../audio";
import { mm, octaveNote } from "../music";
import type { ArrangeResult, Assignment, SourcePart } from "../types";

/** Re-render on every player event (play, pause, load progress, solo change). */
export function usePlayerVersion(player: ABPlayer | null): number {
  const ref = useRef(0);
  return useSyncExternalStore(
    (cb) => {
      if (!player) return () => {};
      return player.subscribe(() => {
        ref.current++;
        cb();
      });
    },
    () => ref.current,
  );
}

/**
 * Which MIDI track of the arranged file is each player's. The engine writes one track per player in
 * roster order (checked on all 48 precomputed results); a leading empty conductor track is tolerated,
 * then matching by track name. Returns null when the file can't be mapped (solo is then unavailable).
 */
export function playerTracks(result: ArrangeResult, arranged: Track): Map<string, number> | null {
  const players = result.roster.players;
  const info = arranged.trackInfo;
  const out = new Map<string, number>();
  if (info.length === players.length) {
    players.forEach((p, i) => out.set(p.id, i));
    return out;
  }
  if (info.length === players.length + 1 && info[0].notes === 0) {
    players.forEach((p, i) => out.set(p.id, i + 1));
    return out;
  }
  // music21 writes track names as UTF-8; @tonejs/midi reads them as Latin-1 ("B♭" -> "Bâ\u0099\u00ad").
  const fix = (s: string) => {
    try {
      return decodeURIComponent(escape(s)).normalize();
    } catch {
      return s.normalize();
    }
  };
  const used = new Set<number>();
  for (const p of players) {
    const i = info.findIndex((t, k) => !used.has(k) && fix(t.name) === p.label.normalize());
    if (i < 0) return null;
    used.add(i);
    out.set(p.id, i);
  }
  return out;
}

/**
 * A single player's part for engraving: no staff label (music21 writes the instrument name as both
 * name and abbreviation, so Verovio repeats it on every line). The card and print header carry the
 * name instead; downloads keep the file as the engine wrote it.
 */
export function withoutStaffLabels(xml: string): string {
  return xml
    .replace(/<part-name(\s[^>]*)?>[\s\S]*?<\/part-name>/g, "<part-name></part-name>")
    .replace(/<part-abbreviation(\s[^>]*)?>[\s\S]*?<\/part-abbreviation>/g, "");
}

/** "Violin 1" -> "Vln 1", "Violoncello" -> "Vc", for labels inside narrow strip segments. */
export function shortLine(name: string): string {
  const v = /^violin\s*(\d+|I+)\b/i.exec(name);
  if (v) return `Vln ${v[1]}`;
  if (/^viola\b/i.test(name)) return "Vla";
  if (/^(violon)?cello\b/i.test(name)) return "Vc";
  if (/^(double\s*)?bass\b/i.test(name)) return "Cb";
  return name.length > 6 ? `${name.slice(0, 5)}.` : name;
}

export interface Duty {
  a: Assignment;
  line: SourcePart | undefined;
  role: string | null;
}

/** This player's assignments in bar order, with the source line and the role the plan gave that span. */
export function dutiesOf(result: ArrangeResult, playerId: string): Duty[] {
  const lines = new Map(result.source_parts.map((s) => [s.id, s]));
  return result.plan.assignments
    .filter((a) => a.player === playerId)
    .sort((x, y) => x.start_measure - y.start_measure || x.source_part.localeCompare(y.source_part))
    .map((a) => {
      // Every role the plan gave this line over the span, in order ("melody", or "melody, then accompaniment").
      const roles = result.plan.roles
        .filter((x) => x.source_part === a.source_part && x.start_measure <= a.end_measure && a.start_measure <= x.end_measure)
        .sort((x, y) => x.start_measure - y.start_measure)
        .map((x) => x.role)
        .filter((r, i, all) => r && r !== all[i - 1]);
      return { a, line: lines.get(a.source_part), role: roles.length ? roles.join(", then ") : null };
    });
}

/** "Violin 1, mm. 1–10 (melody, an octave down)" for each duty; used on cards and printed parts. */
export function dutyText(d: Duty): string {
  const extra = [d.role, octaveNote(d.a.octave_shift)].filter(Boolean).join(", ");
  return `${d.line?.name ?? d.a.source_part}, ${mm(d.a.start_measure, d.a.end_measure)}${extra ? ` (${extra})` : ""}`;
}

/** Bars (inclusive spans) where this player has no assignment. */
export function restSpans(result: ArrangeResult, duties: Duty[]): Array<[number, number]> {
  const [m0, m1] = result.piece.measures;
  const busy = new Set<number>();
  for (const d of duties) for (let m = d.a.start_measure; m <= d.a.end_measure; m++) busy.add(m);
  const spans: Array<[number, number]> = [];
  let start: number | null = null;
  for (let m = m0; m <= m1 + 1; m++) {
    const free = m <= m1 && !busy.has(m);
    if (free && start === null) start = m;
    if (!free && start !== null) {
      spans.push([start, m - 1]);
      start = null;
    }
  }
  return spans;
}
