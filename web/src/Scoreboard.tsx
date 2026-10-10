import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { mm } from "./music";
import type { Comparison, ComparisonMetric, ComparisonTotals, DemoIndex } from "./types";

interface Props {
  data: Comparison;
  index: DemoIndex;
  current: { piece: string; roster: string } | null;
  onPick: (piece: string, roster: string) => void;
  /** Plans the AI wrote per pair (best-of-N; the checker kept one). Read from the result files; omit when unknown. */
  nCandidates?: number | null;
}

/**
 * Display text per metric key (comparison.json keeps the keys; labels here are copy, never numbers).
 * `short` heads the per-pair table's columns; `name` is the full name; `def` says what is counted.
 * An unknown key falls back to comparison.json's own label.
 */
export const METRIC_TEXT: Record<string, { short: string; name: string; def: string }> = {
  melody_id: {
    short: "Melody ID",
    name: "Melody identified",
    def: "Share of the reference map's melody bars that the planner itself labels melody. The reference map was written by a separate Claude Code agent reading the notes, before any plan existed; no musician has checked it.",
  },
  melody: {
    short: "Melody kept",
    name: "Reference melody kept",
    def: "Share of the reference map's melody bars that some player plays (same AI-written reference map).",
  },
  bass: {
    short: "Bass",
    name: "Harmonic bass preserved",
    def: "Share of sounding time in which the cover's lowest note has the original's bass pitch class.",
  },
  inversions: {
    short: "Under bass",
    name: "Notes sounding under the bass line",
    def: "Cover notes below whichever player carries the original's bass at that moment. The original scores 0.",
  },
  first_unfit: {
    short: "Folds, 1st plan",
    name: "First-plan notes that needed a single-note fold",
    def: "The planner's first plan (for the AI, the first plan it wrote, before the checker picks among its plans), after the same octave repair every plan gets: notes still out of range.",
  },
  folded: {
    short: "Folds, final",
    name: "Single notes octave-folded in the final parts",
    def: "Single notes moved by an octave as a last resort, in the parts the band gets.",
  },
  handoffs: {
    short: "Handoffs",
    name: "Line handoffs between players",
    def: "Times an original line moves from one player to another.",
  },
  dropped: {
    short: "Line-bars out",
    name: "Line-bars left out",
    def: "A line-bar is one bar of one original line. Counted: line-bars with notes that no player plays, so two lines missing in the same bar count 2.",
  },
};

export function metricText(m: ComparisonMetric): { short: string; name: string; def: string } {
  return METRIC_TEXT[m.key] ?? { short: m.label, name: m.label, def: "" };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A metric is a share (shown as %) if every reported value sits in [0, 1] and some are fractional. */
export function isShare(data: Comparison, key: string): boolean {
  const vals = data.rows.flatMap((r) => [num(r.ai[key]), num(r.greedy[key])]).filter((v): v is number => v !== null);
  return vals.length > 0 && vals.every((v) => v >= 0 && v <= 1) && vals.some((v) => !Number.isInteger(v));
}

export function fmt(v: number | null, share: boolean, mean = false): string {
  if (v === null) return "n/a";
  if (share) return `${Math.round(v * 100)}%`;
  return mean ? v.toFixed(1) : String(v);
}

/** -1: AI better, 1: baseline better, 0: tie / not comparable / the same as displayed. */
function winner(m: ComparisonMetric, ai: number | null, base: number | null, share: boolean, mean = false): -1 | 0 | 1 {
  if (ai === null || base === null || ai === base) return 0;
  if (fmt(ai, share, mean) === fmt(base, share, mean)) return 0;
  const aiHigher = ai > base;
  return (m.better === "higher") === aiHigher ? -1 : 1;
}

/**
 * Which side a metric goes under in the summary. "even" when the two sides' win counts differ by one pair or
 * less, or when their means show the same value; otherwise the side that does better in more pairs.
 */
export function verdict(data: Comparison, m: ComparisonMetric): "ai" | "base" | "even" {
  const t: ComparisonTotals | undefined = data.totals[m.key];
  if (!t) return "even";
  const share = isShare(data, m.key);
  if (Math.abs(t.ai_better - t.greedy_better) <= 1) return "even";
  if (fmt(num(t.ai_mean), share, true) === fmt(num(t.greedy_mean), share, true)) return "even";
  return t.ai_better > t.greedy_better ? "ai" : "base";
}

function shortPiece(index: DemoIndex, id: string): string {
  const p = index.pieces.find((x) => x.id === id);
  if (!p) return id;
  const surname = p.composer.replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(-1)[0];
  const opus = /Op\.\s?\d+(?:\s?No\.\s?\d+)?/.exec(p.title)?.[0];
  const mv = p.movement ? p.movement.split(/[.\s]/)[0] : "";
  return [surname + (opus ? ` ${opus}` : ""), mv, p.measures ? mm(p.measures[0], p.measures[1]) : ""].filter(Boolean).join(", ");
}

function shortRoster(index: DemoIndex, id: string): string {
  const r = index.rosters.find((x) => x.id === id);
  return r ? r.label.split(":")[0] : id;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function listing(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Whether a horizontal scroller has more to show, and whether it is scrolled to the end. */
function useOverflow(ref: RefObject<HTMLDivElement | null>): { over: boolean; atEnd: boolean } {
  const [s, setS] = useState({ over: false, atEnd: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const over = el.scrollWidth > el.clientWidth + 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      setS((p) => (p.over === over && p.atEnd === atEnd ? p : { over, atEnd }));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [ref]);
  return s;
}

export function Scoreboard({ data, index, current, onPick, nCandidates = null }: Props) {
  const metrics = data.metrics.filter((m) => data.totals[m.key]);
  const share = Object.fromEntries(metrics.map((m) => [m.key, isShare(data, m.key)]));
  const ahead = { ai: [] as string[], base: [] as string[], even: [] as string[] };
  const side: Record<string, "ai" | "base" | "even"> = {};
  for (const m of metrics) {
    const v = verdict(data, m);
    side[m.key] = v;
    ahead[v].push(lower(metricText(m).name));
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  const { over, atEnd } = useOverflow(scrollRef);

  return (
    <div className="scoreboard">
      <p className="block-lede">
        Every piece with every set of players, {data.n_pairs} pairs in all, AI plan against the rule-based baseline. Counts are
        how many pairs each side did better on; a tie means equal numbers.
        {nCandidates !== null &&
          nCandidates > 1 &&
          ` The AI side is, for each pair, the plan the checker kept of the ${nCandidates} the AI wrote (fewest problems); the first-plan column instead uses the first plan it wrote, before that choice.`}
        {ahead.ai.length > 0 && ` The AI plan does better more often on ${listing(ahead.ai)}.`}
        {ahead.base.length > 0 && ` The baseline does better more often on ${listing(ahead.base)}.`}
        {ahead.even.length > 0 &&
          ` About even on ${listing(ahead.even)}: the two sides' win counts are within one pair of each other, or their means show the same value.`}
      </p>

      <div className="table-scroll">
        <table className="tally">
          <caption className="sr-only">Totals per metric across all pairs</caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col" className="num">AI plan, mean</th>
              <th scope="col" className="num">Baseline, mean</th>
              <th scope="col" className="num">AI better</th>
              <th scope="col" className="num">Tie</th>
              <th scope="col" className="num">Baseline better</th>
              <th scope="col" className="bar-col">
                <span className="sr-only">Share of pairs</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const t = data.totals[m.key];
              const n = t.n || t.ai_better + t.tie + t.greedy_better || 1;
              const txt = metricText(m);
              const v = side[m.key];
              // An "about even" metric sets neither mean in bold, so the table and the summary agree.
              const w = v === "even" ? 0 : winner(m, num(t.ai_mean), num(t.greedy_mean), share[m.key], true);
              return (
                <tr key={m.key} data-metric={m.key} data-verdict={v}>
                  <th scope="row">
                    <span className="ledger-label">{txt.name}</span>
                    <span className="ledger-def">
                      {txt.def ? `${txt.def} ` : ""}
                      {m.better === "higher" ? "Higher is better." : "Lower is better."}
                      {v === "even" ? " About even." : ""}
                    </span>
                  </th>
                  <td className={`num ${w === -1 ? "is-better" : ""}`}>{fmt(num(t.ai_mean), share[m.key], true)}</td>
                  <td className={`num ${w === 1 ? "is-better" : ""}`}>{fmt(num(t.greedy_mean), share[m.key], true)}</td>
                  <td className={`num ${v === "ai" ? "is-better" : ""}`}>{t.ai_better}</td>
                  <td className="num">{t.tie}</td>
                  <td className={`num ${v === "base" ? "is-better" : ""}`}>{t.greedy_better}</td>
                  <td className="bar-col">
                    <span
                      className="winbar"
                      style={{ "--a": t.ai_better / n, "--t": t.tie / n, "--g": t.greedy_better / n } as CSSProperties}
                      role="img"
                      aria-label={`AI better ${t.ai_better}, tie ${t.tie}, baseline better ${t.greedy_better}, of ${n}`}
                    >
                      <span className="winbar-a" />
                      <span className="winbar-t" />
                      <span className="winbar-g" />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="tally-key">
        <span className="key-a" /> AI better <span className="key-t" /> tie <span className="key-g" /> baseline better
      </p>

      <h3 className="pairs-title">Every pair</h3>
      <p className="block-lede">Each cell is AI plan, then baseline; the better one is set in bold. Choose a row to open it in the tool.</p>
      <p className="pairs-key">
        <span className="pairs-key-h">Columns</span>
        {metrics.map((m) => {
          const txt = metricText(m);
          return (
            <span key={m.key} data-metric={m.key}>
              <b>{txt.short}</b>: {lower(txt.name)}
            </span>
          );
        })}
      </p>
      {over && (
        <p className="pairs-cue" aria-hidden="true">
          {atEnd ? "← Scroll back for the first columns" : `Scroll sideways for all ${metrics.length + 2} columns →`}
        </p>
      )}
      <div className="pairs-wrap" data-overflow={over ? "true" : "false"} data-at-end={atEnd ? "true" : "false"}>
        <div className="table-scroll" ref={scrollRef}>
          <table className="pairs">
            <caption className="sr-only">Per pair results, AI plan versus baseline</caption>
            <thead>
              <tr>
                <th scope="col">Piece</th>
                <th scope="col">Players</th>
                {metrics.map((m) => {
                  const txt = metricText(m);
                  return (
                    <th scope="col" key={m.key} className="num" title={txt.name} aria-label={txt.name} data-metric={m.key}>
                      <span aria-hidden="true">{txt.short}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const isCurrent = current?.piece === row.piece && current?.roster === row.roster;
                return (
                  <tr
                    key={`${row.piece}|${row.roster}`}
                    className={isCurrent ? "is-current" : ""}
                    onClick={() => onPick(row.piece, row.roster)}
                  >
                    <th scope="row">
                      <button type="button" className="row-link" onClick={(e) => (e.stopPropagation(), onPick(row.piece, row.roster))}>
                        {shortPiece(index, row.piece)}
                      </button>
                    </th>
                    <td>{shortRoster(index, row.roster)}</td>
                    {metrics.map((m) => {
                      const a = num(row.ai[m.key]);
                      const g = num(row.greedy[m.key]);
                      const w = winner(m, a, g, share[m.key]);
                      return (
                        <td key={m.key} className="num pair-cell" data-metric={m.key}>
                          <span className={w === -1 ? "is-better" : ""}>{fmt(a, share[m.key])}</span>
                          <span className="pair-sep"> / </span>
                          <span className={w === 1 ? "is-better" : ""}>{fmt(g, share[m.key])}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
