// The band row's model: who is in the band, how it is written into the URL, and whether it is
// exactly one of the preset bands (which have precomputed AI and rule-based results).
import type { Roster } from "../types";

/** Instrument ids and names accepted by engine/coverpart/instruments.py (all 16). */
export const INSTRUMENTS: ReadonlyArray<readonly [id: string, name: string]> = [
  ["flute", "Flute"],
  ["oboe", "Oboe"],
  ["clarinet", "Clarinet in B♭"],
  ["alto_sax", "Alto Sax in E♭"],
  ["tenor_sax", "Tenor Sax in B♭"],
  ["bari_sax", "Baritone Sax in E♭"],
  ["bassoon", "Bassoon"],
  ["trumpet", "Trumpet in B♭"],
  ["horn", "Horn in F"],
  ["trombone", "Trombone"],
  ["euphonium", "Euphonium"],
  ["tuba", "Tuba"],
  ["violin", "Violin"],
  ["viola", "Viola"],
  ["cello", "Cello"],
  ["double_bass", "Double Bass"],
];
export const INSTRUMENT_NAME = new Map<string, string>(INSTRUMENTS);

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];
const LEVEL_CODE: Record<Level, string> = { beginner: "b", intermediate: "i", advanced: "a" };
const CODE_LEVEL: Record<string, Level> = { b: "beginner", i: "intermediate", a: "advanced" };

export const MAX_PLAYERS = 8;

export interface BandPlayer {
  /** Stable React key; not sent anywhere. */
  key: number;
  instrument: string;
  level: Level;
  /** Optional name on the part ("Sam"); empty = none. */
  name: string;
}

let keySeq = 0;
export function newPlayer(instrument = "flute", level: Level = "intermediate", name = ""): BandPlayer {
  return { key: ++keySeq, instrument, level, name };
}

const asLevel = (l: string | undefined): Level => (LEVELS as readonly string[]).includes(l ?? "") ? (l as Level) : "intermediate";

export function bandFromRoster(r: Roster): BandPlayer[] {
  return r.players.map((p) => newPlayer(INSTRUMENT_NAME.has(p.instrument) ? p.instrument : "flute", asLevel(p.level)));
}

/** Instrument + level, in order: what decides the arrangement (names are cosmetic). */
export function signature(band: BandPlayer[]): string {
  return band.map((p) => `${p.instrument}:${LEVEL_CODE[p.level]}`).join(",");
}

/**
 * The preset this band is, if it has exactly the same players (instrument and level, any order).
 * Returns the preset id and, for each preset player id, the band player standing in for it.
 */
export function matchPreset(band: BandPlayer[], presets: Roster[]): { id: string; byPlayer: Map<string, BandPlayer> } | null {
  for (const r of presets) {
    if (r.players.length !== band.length) continue;
    const left = [...band];
    const byPlayer = new Map<string, BandPlayer>();
    let ok = true;
    for (const p of r.players) {
      const i = left.findIndex((b) => b.instrument === p.instrument && b.level === asLevel(p.level));
      if (i < 0) {
        ok = false;
        break;
      }
      byPlayer.set(p.id, left[i]);
      left.splice(i, 1);
    }
    if (ok) return { id: r.id, byPlayer };
  }
  return null;
}

/** URL form: a preset id, or "flute:i,trumpet:b:Sam" (instrument:level[:name]). */
export function encodeBand(band: BandPlayer[], presetId: string | null): string {
  if (presetId && band.every((p) => !p.name.trim())) return presetId;
  return band
    .map((p) => {
      const base = `${p.instrument}:${LEVEL_CODE[p.level]}`;
      const name = p.name.trim();
      return name ? `${base}:${encodeURIComponent(name)}` : base;
    })
    .join(",");
}

export function decodeBand(s: string | null, presets: Roster[]): BandPlayer[] | null {
  if (!s) return null;
  const preset = presets.find((r) => r.id === s);
  if (preset) return bandFromRoster(preset);
  if (!s.includes(":")) return null;
  const out: BandPlayer[] = [];
  for (const item of s.split(",").slice(0, MAX_PLAYERS)) {
    const [inst, lv, ...rest] = item.split(":");
    if (!INSTRUMENT_NAME.has(inst)) continue;
    let name = "";
    try {
      name = decodeURIComponent(rest.join(":")).slice(0, 40);
    } catch {
      name = "";
    }
    out.push(newPlayer(inst, CODE_LEVEL[lv] ?? "intermediate", name));
  }
  return out.length ? out : null;
}

/**
 * Labels sent with a custom band: the name if given, else the instrument, numbered when the band has
 * more than one ("Trumpet in B♭ 1", "Trumpet in B♭ 2").
 */
export function liveLabels(band: BandPlayer[]): string[] {
  const count = new Map<string, number>();
  for (const p of band) count.set(p.instrument, (count.get(p.instrument) ?? 0) + 1);
  const seen = new Map<string, number>();
  return band.map((p) => {
    if (p.name.trim()) return p.name.trim();
    const base = INSTRUMENT_NAME.get(p.instrument) ?? p.instrument;
    if ((count.get(p.instrument) ?? 0) < 2) return base;
    const k = (seen.get(p.instrument) ?? 0) + 1;
    seen.set(p.instrument, k);
    return `${base} ${k}`;
  });
}

/** Short ids for the engine: "fl", "tp2", ... unique within the band. */
const SHORT: Record<string, string> = {
  flute: "fl", oboe: "ob", clarinet: "cl", alto_sax: "asx", tenor_sax: "tsx", bari_sax: "bsx", bassoon: "bsn",
  trumpet: "tp", horn: "hn", trombone: "tbn", euphonium: "euph", tuba: "tba", violin: "vn", viola: "va",
  cello: "vc", double_bass: "db",
};
export function liveIds(band: BandPlayer[]): string[] {
  const used = new Set<string>();
  return band.map((p) => {
    const base = SHORT[p.instrument] ?? "p";
    let id = base;
    let k = 2;
    while (used.has(id)) id = `${base}${k++}`;
    used.add(id);
    return id;
  });
}

/** "Flute, Clarinet in B♭, 2 × Trumpet in B♭" for a heading. */
export function bandSummary(band: ReadonlyArray<{ instrument: string }>): string {
  const order: string[] = [];
  const n = new Map<string, number>();
  for (const p of band) {
    if (!n.has(p.instrument)) order.push(p.instrument);
    n.set(p.instrument, (n.get(p.instrument) ?? 0) + 1);
  }
  return order.map((i) => `${(n.get(i) ?? 0) > 1 ? `${n.get(i)} × ` : ""}${INSTRUMENT_NAME.get(i) ?? i}`).join(", ");
}
