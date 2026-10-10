import type { CSSProperties } from "react";
import { mm } from "./music";
import type { Comparison, ComparisonMetric, DemoIndex } from "./types";

interface Props {
  data: Comparison;
  index: DemoIndex;
  current: { piece: string; roster: string } | null;
  onPick: (piece: string, roster: string) => void;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A metric is a share (shown as %) if every reported value sits in [0, 1] and some are fractional. */
function isShare(data: Comparison, key: string): boolean {
  const vals = data.rows.flatMap((r) => [num(r.ai[key]), num(r.greedy[key])]).filter((v): v is number => v !== null);
  return vals.length > 0 && vals.every((v) => v >= 0 && v <= 1) && vals.some((v) => !Number.isInteger(v));
}

function fmt(v: number | null, share: boolean, mean = false): string {
  if (v === null) return "n/a";
  if (share) return `${Math.round(v * 100)}%`;
  return mean ? v.toFixed(1) : String(v);
}

/** -1: AI better, 1: baseline better, 0: tie / not comparable. */
function winner(m: ComparisonMetric, ai: number | null, base: number | null): -1 | 0 | 1 {
  if (ai === null || base === null || ai === base) return 0;
  const aiHigher = ai > base;
  return (m.better === "higher") === aiHigher ? -1 : 1;
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

function listing(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function Scoreboard({ data, index, current, onPick }: Props) {
  const metrics = data.metrics.filter((m) => data.totals[m.key]);
  const share = Object.fromEntries(metrics.map((m) => [m.key, isShare(data, m.key)]));
  const ahead = { ai: [] as string[], base: [] as string[], even: [] as string[] };
  for (const m of metrics) {
    const t = data.totals[m.key];
    // "First plan: notes that needed a single-note fold" -> "notes that needed a single-note fold (first plan)"
    const [head, ...rest] = m.label.split(": ");
    const phrase = rest.length ? `${rest.join(": ")} (${head.toLowerCase()})` : m.label;
    const name = phrase.charAt(0).toLowerCase() + phrase.slice(1);
    if (t.ai_better > t.greedy_better) ahead.ai.push(name);
    else if (t.greedy_better > t.ai_better) ahead.base.push(name);
    else ahead.even.push(name);
  }

  return (
    <div className="scoreboard">
      <p className="block-lede">
        Every piece with every set of players, {data.n_pairs} pairs in all, AI plan against the naive baseline. Counts are
        how many pairs each side did better on; a tie means equal numbers.
        {ahead.ai.length > 0 && ` The AI plan does better more often on ${listing(ahead.ai)}.`}
        {ahead.base.length > 0 && ` The baseline does better more often on ${listing(ahead.base)}.`}
        {ahead.even.length > 0 && ` Even on ${listing(ahead.even)}.`}
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
              const w = winner(m, num(t.ai_mean), num(t.greedy_mean));
              return (
                <tr key={m.key}>
                  <th scope="row">
                    <span className="ledger-label">{m.label}</span>
                    <span className="ledger-def">{m.better === "higher" ? "Higher is better" : "Lower is better"}</span>
                  </th>
                  <td className={`num ${w === -1 ? "is-better" : ""}`}>{fmt(num(t.ai_mean), share[m.key], true)}</td>
                  <td className={`num ${w === 1 ? "is-better" : ""}`}>{fmt(num(t.greedy_mean), share[m.key], true)}</td>
                  <td className={`num ${t.ai_better > t.greedy_better ? "is-better" : ""}`}>{t.ai_better}</td>
                  <td className="num">{t.tie}</td>
                  <td className={`num ${t.greedy_better > t.ai_better ? "is-better" : ""}`}>{t.greedy_better}</td>
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
      <p className="block-lede">Each cell is AI plan, then baseline; the better one is set in bold. Choose a row to open it above.</p>
      <div className="table-scroll">
        <table className="pairs">
          <caption className="sr-only">Per pair results, AI plan versus baseline</caption>
          <thead>
            <tr>
              <th scope="col">Piece</th>
              <th scope="col">Players</th>
              {metrics.map((m) => (
                <th scope="col" key={m.key} className="num">
                  {m.label}
                </th>
              ))}
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
                    const w = winner(m, a, g);
                    return (
                      <td key={m.key} className="num pair-cell">
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
  );
}
