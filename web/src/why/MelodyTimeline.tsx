import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ABPlayer } from "../audio";
import type { ArrangeResult, SourcePart } from "../types";
import { REFERENCE_MAP } from "./copy";
import type { MelodySpan } from "./melodyMaps";
import { labeledByBar, melodyIdentified, pct, tuneByBar } from "./metrics";

interface PlanRow {
  key: string;
  label: string;
  result: ArrangeResult;
}

/**
 * Where the tune is, bar by bar (reference map), against which line each plan labels "melody".
 * A bar counts as identified when the plan labels the reference line itself (report.py's definition).
 */
export function MelodyTimeline({
  map,
  parts,
  measures,
  rows,
  player,
}: {
  map: MelodySpan[];
  parts: SourcePart[];
  measures: [number, number];
  rows: PlanRow[];
  player: ABPlayer | null;
}) {
  const [m0, m1] = measures;
  const n = m1 - m0 + 1;
  const bars = Array.from({ length: n }, (_, i) => m0 + i);
  const tune = tuneByBar(map, m0, m1);
  const color = (id: string | null | undefined) => parts.find((p) => p.id === id)?.color;
  const name = (id: string | null | undefined) => parts.find((p) => p.id === id)?.name ?? "";
  const rootRef = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState<number | null>(null);

  // Playhead: rAF only while this player is playing; a CSS variable moves the line (no re-render per frame).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !player) return;
    let raf = 0;
    let lastBar: number | null = null;
    const frame = () => {
      const pos = player.measurePosition;
      root.style.setProperty("--ph", `${Math.min(100, Math.max(0, (pos / n) * 100))}%`);
      const b = Math.min(n - 1, Math.max(0, Math.floor(pos)));
      if (b !== lastBar) {
        lastBar = b;
        setCur(b);
      }
      if (player.isPlaying) raf = requestAnimationFrame(frame);
    };
    const onChange = () => {
      cancelAnimationFrame(raf);
      const on = player.isPlaying || player.position > 0;
      root.dataset.playing = player.isPlaying ? "true" : "false";
      root.style.setProperty("--ph-o", on ? "1" : "0");
      if (on) frame();
      else {
        lastBar = null;
        setCur(null);
      }
    };
    const unsub = player.subscribe(onChange);
    onChange();
    return () => {
      unsub();
      cancelAnimationFrame(raf);
      root.style.setProperty("--ph-o", "0");
    };
  }, [player, n]);

  const shown = new Set<string>();
  tune.forEach((t) => t && shown.add(t));
  const labeled = rows.map((r) => labeledByBar(r.result, m0, m1));
  labeled.forEach((l) => l.forEach((ps) => ps.forEach((p) => shown.add(p))));

  const caption =
    cur !== null
      ? [
          `Bar ${bars[cur]}: the tune is ${tune[cur] ? `in ${name(tune[cur])}` : "nowhere (no single line)"}`,
          ...rows.map((r, i) => `${r.label}: ${labeled[i][cur].length ? labeled[i][cur].map(name).join(" + ") : "no melody label"}`),
        ].join(" · ")
      : null;

  return (
    <figure className="why-tl" ref={rootRef} style={{ "--n": n } as CSSProperties} data-demo="timeline">
      <div className="why-tl-grid">
        <div className="why-tl-row why-tl-ruler" aria-hidden="true">
          <span className="why-tl-label">Bar</span>
          <span className="why-tl-cells">
            {bars.map((b, i) => (
              <span key={b} className={`why-tl-bar${cur === i ? " is-cur" : ""}`} data-minor={(b - m0) % 2 === 1 ? "" : undefined}>
                {n <= 24 || (b - m0) % 2 === 0 ? b : ""}
              </span>
            ))}
          </span>
          <span className="why-tl-score" />
        </div>

        <div className="why-tl-row is-ref" data-row="reference">
          <span className="why-tl-label">
            Where the tune is
            <small>{REFERENCE_MAP.label}</small>
          </span>
          <span className="why-tl-cells">
            {bars.map((b, i) => (
              <span
                key={b}
                className={`why-tl-cell${tune[i] ? " is-tune" : " is-none"}${cur === i ? " is-cur" : ""}`}
                style={{ "--c": color(tune[i]) ?? "transparent" } as CSSProperties}
                title={`Bar ${b}: ${tune[i] ? name(tune[i]) : "no single melodic line"}`}
              />
            ))}
          </span>
          <span className="why-tl-score" />
        </div>

        {rows.map((r, ri) => {
          const id = melodyIdentified(r.result, map);
          return (
            <div className="why-tl-row" key={r.key} data-row={r.key}>
              <span className="why-tl-label">
                {r.label}
                <small>labels as melody</small>
              </span>
              <span className="why-tl-cells">
                {bars.map((b, i) => {
                  const lab = labeled[ri][i];
                  const ref = tune[i];
                  const status = !ref ? "free" : lab.includes(ref) ? "hit" : "miss";
                  return (
                    <span
                      key={b}
                      className={`why-tl-cell is-${status}${lab.length ? " is-tune" : " is-none"}${cur === i ? " is-cur" : ""}`}
                      style={{ "--c": color(lab[0]) ?? "transparent" } as CSSProperties}
                      title={`Bar ${b}: labels ${lab.length ? lab.map(name).join(" + ") : "nothing"} as melody${
                        status === "miss" ? ` (the tune is in ${name(ref)})` : ""
                      }`}
                    />
                  );
                })}
              </span>
              <span className="why-tl-score" data-hit={id.hit} data-of={id.of}>
                <b>{pct(id.share)}</b>
                <small>
                  {id.hit} of {id.of} bars
                </small>
              </span>
            </div>
          );
        })}
        <div className="why-tl-playhead" aria-hidden="true" />
      </div>
      <div className="why-tl-legend">
        {[...shown].sort().map((p) => (
          <span key={p} style={{ "--c": color(p) } as CSSProperties}>
            <i aria-hidden="true" />
            {name(p)}
          </span>
        ))}
        <span className="why-tl-key-miss">
          <i aria-hidden="true" />
          wrong line labeled melody
        </span>
        <span className="why-tl-key-ref" data-legend="reference-map">{REFERENCE_MAP.legend}</span>
      </div>
      <figcaption className="why-cap why-tl-live">
        {caption ?? "Percentages: share of the reference map's melody bars that the plan itself labels melody."}
      </figcaption>
    </figure>
  );
}
