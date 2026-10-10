import type { ArrangeResult, Player, SourcePart } from "./types";

/** "C#4" -> "C♯4", "Bb3" / "B-3" -> "B♭3". */
export function prettyPitch(p: string): string {
  const m = /^([A-Ga-g])([#b\-]*|x)?(-?\d+)?$/.exec(p.trim());
  if (!m) return p;
  const acc = (m[2] ?? "").replace(/#/g, "♯").replace(/[b-]/g, "♭").replace("x", "𝄪");
  return `${m[1].toUpperCase()}${acc}${m[3] ?? ""}`;
}

export function prettyRange(r: [string, string]): string {
  return `${prettyPitch(r[0])}–${prettyPitch(r[1])}`;
}

export function mm(a: number, b: number): string {
  return a === b ? `m. ${a}` : `mm. ${a}–${b}`;
}

export function pct(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "n/a";
  return `${Math.round(x * 100)}%`;
}

export function playerById(result: ArrangeResult): Map<string, Player> {
  return new Map(result.roster.players.map((p) => [p.id, p]));
}

export function sourceById(result: ArrangeResult): Map<string, SourcePart> {
  return new Map(result.source_parts.map((s) => [s.id, s]));
}

/** Readable text color on top of a line color. */
export function onColor(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#fff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.36 ? "#1E1C18" : "#FFFDF8";
}

export function octaveNote(shift: number): string {
  if (!shift) return "";
  const n = Math.abs(shift);
  const dir = shift > 0 ? "up" : "down";
  return n === 1 ? `an octave ${dir}` : `${n} octaves ${dir}`;
}

export function roleOf(result: ArrangeResult, sourcePart: string, measure: number): string | null {
  const r = result.plan.roles.find(
    (x) => x.source_part === sourcePart && x.start_measure <= measure && measure <= x.end_measure,
  );
  return r ? r.role : null;
}

/** The single role a source part plays across the excerpt, or null if it changes. */
export function steadyRole(result: ArrangeResult, sourcePart: string): string | null {
  const roles = new Set(result.plan.roles.filter((r) => r.source_part === sourcePart).map((r) => r.role));
  return roles.size === 1 ? [...roles][0] : null;
}

export const PLANNER_LABEL = { ai: "AI plan", greedy: "Rule-based baseline" } as const;

export function downloadText(filename: string, text: string, mime = "application/vnd.recordare.musicxml+xml") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(s: string): string {
  return s
    .replace(/\u266D/g, "b")
    .replace(/\u266F/g, "s")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

export interface Bar {
  /** Integer bar number (split halves like "40X2" merge into 40). */
  n: number;
  /** Start and length in quarter notes from the excerpt's first sounding beat. */
  startQ: number;
  lenQ: number;
}

/**
 * Bar map from the first part of a MusicXML score, using each measure's real length (pickups and split
 * half-bars included), following backup/forward so multiple voices count once. Measures sharing an
 * integer number are merged. Returns [] if the score can't be read.
 */
export function barMap(xml: string): Bar[] {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const part = doc.querySelector("part");
    if (!part) return [];
    const bars: Bar[] = [];
    let divisions = 1;
    let q = 0;
    let lastNum = Number.NaN;
    for (const m of Array.from(part.children).filter((c) => c.tagName === "measure")) {
      const d = m.querySelector(":scope > attributes > divisions");
      if (d) divisions = Number(d.textContent) || divisions;
      let t = 0;
      let max = 0;
      for (const el of Array.from(m.children)) {
        const dur = Number(el.querySelector(":scope > duration")?.textContent ?? "0");
        if (el.tagName === "note") {
          if (el.querySelector(":scope > chord") || el.querySelector(":scope > grace")) continue;
          t += dur;
        } else if (el.tagName === "backup") t -= dur;
        else if (el.tagName === "forward") t += dur;
        max = Math.max(max, t);
      }
      const len = max / divisions;
      const parsed = parseInt(m.getAttribute("number") ?? "", 10);
      const n = Number.isFinite(parsed) ? parsed : Number.isFinite(lastNum) ? lastNum + 1 : 0;
      const prev = bars[bars.length - 1];
      if (prev && prev.n === n) prev.lenQ += len;
      else bars.push({ n, startQ: q, lenQ: len });
      lastNum = n;
      q += len;
    }
    return bars.filter((b) => b.lenQ > 0);
  } catch {
    return [];
  }
}
