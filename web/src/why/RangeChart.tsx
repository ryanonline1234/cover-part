import type { CSSProperties } from "react";
import type { ArrangeResult } from "../types";
import { midiToName, nameToMidi, partRanges } from "./metrics";

interface Row {
  key: string;
  name: string;
  lo: number;
  hi: number;
  color?: string;
}

/** Each source line's range (from the score) against each player's sounding range, on one keyboard. */
export function RangeChart({ result }: { result: ArrangeResult }) {
  const lines: Row[] = [];
  const pr = partRanges(result.musicxml.original);
  result.source_parts.forEach((sp, i) => {
    const r = pr[i];
    if (r) lines.push({ key: sp.id, name: sp.name, lo: r.lo, hi: r.hi, color: sp.color });
  });
  const players: Row[] = [];
  for (const p of result.roster.players) {
    const lo = nameToMidi(p.range_sounding[0]);
    const hi = nameToMidi(p.range_sounding[1]);
    if (lo !== null && hi !== null) players.push({ key: p.id, name: p.label, lo, hi });
  }
  if (!lines.length || !players.length) return null;

  // Pitches no player can reach (the union of the players' ranges may have gaps).
  const playable = (m: number) => players.some((p) => p.lo <= m && m <= p.hi);
  const outside = (r: Row): Array<[number, number]> => {
    const segs: Array<[number, number]> = [];
    for (let m = r.lo; m <= r.hi; m++) {
      if (playable(m)) continue;
      const last = segs[segs.length - 1];
      if (last && last[1] === m - 1) last[1] = m;
      else segs.push([m, m]);
    }
    return segs;
  };
  const all = [...lines, ...players];
  const lo = Math.floor((Math.min(...all.map((r) => r.lo)) - 2) / 12) * 12; // start on a C
  const hi = Math.max(...all.map((r) => r.hi)) + 2;
  const span = hi - lo;
  const x = (m: number) => ((m - lo) / span) * 100;
  const bar = (a: number, b: number): CSSProperties => ({ left: `${x(a - 0.5)}%`, width: `${x(b + 0.5) - x(a - 0.5)}%` });

  const anyOut = lines.some((r) => outside(r).length > 0);
  const keys = Array.from({ length: span + 1 }, (_, i) => lo + i);
  const black = new Set([1, 3, 6, 8, 10]);

  return (
    <figure className="why-range" data-demo="range">
      <div className="why-range-grid">
        <p className="why-range-group">Written for</p>
        {lines.map((r) => {
          const out = outside(r);
          return (
            <div className="why-range-row" key={r.key} style={{ "--line": r.color } as CSSProperties}>
              <span className="why-range-name">
                <span className="why-swatch" aria-hidden="true" />
                {r.name}
              </span>
              <span className="why-range-track">
                <span className="why-range-bar is-line" style={bar(r.lo, r.hi)} />
                {out.map(([a, b]) => (
                  <span key={a} className="why-range-out" style={bar(a, b)} title={`${midiToName(a)}–${midiToName(b)}: no player in this band reaches it`} />
                ))}
                <span className="why-range-val" style={{ left: `${x(r.hi + 0.5)}%` }}>
                  {midiToName(r.lo)}–{midiToName(r.hi)}
                </span>
              </span>
            </div>
          );
        })}
        <p className="why-range-group">Who you have</p>
        {players.map((r) => (
          <div className="why-range-row" key={r.key}>
            <span className="why-range-name">{r.name}</span>
            <span className="why-range-track">
              <span className="why-range-bar is-player" style={bar(r.lo, r.hi)} />
              <span className="why-range-val" style={{ left: `${x(r.hi + 0.5)}%` }}>
                {midiToName(r.lo)}–{midiToName(r.hi)}
              </span>
            </span>
          </div>
        ))}
        <div className="why-range-row why-range-axis" aria-hidden="true">
          <span className="why-range-name">sounding pitch</span>
          <span className="why-range-track why-keys">
            {keys.map((m) => (
              <span
                key={m}
                className={`why-key${black.has(((m % 12) + 12) % 12) ? " is-black" : ""}`}
                style={{ left: `${x(m)}%` }}
              >
                {m % 12 === 0 && <span className="why-key-c">{midiToName(m)}</span>}
              </span>
            ))}
          </span>
        </div>
      </div>
      <figcaption className="why-cap">
        Colored bars: each line's lowest to highest note in this excerpt. Outlined bars: each player's range.
        {anyOut ? " Hatched: pitches no player in this band can reach." : " Every pitch is inside at least one player's range."}
      </figcaption>
    </figure>
  );
}

export function bandExtremes(result: ArrangeResult) {
  let lo: { m: number; who: string } | null = null;
  let hi: { m: number; who: string } | null = null;
  for (const p of result.roster.players) {
    const a = nameToMidi(p.range_sounding[0]);
    const b = nameToMidi(p.range_sounding[1]);
    if (a !== null && (!lo || a < lo.m)) lo = { m: a, who: p.label };
    if (b !== null && (!hi || b > hi.m)) hi = { m: b, who: p.label };
  }
  return { lo, hi };
}
