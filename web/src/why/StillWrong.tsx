import { useRef, useState, type CSSProperties } from "react";
import type { DemoIndex } from "../types";
import { metricText } from "../Scoreboard";
import { section } from "./copy";
import { useABPlayer, useComparison, useNear, useResult } from "./hooks";
import { MELODY_MAPS } from "./melodyMaps";
import { mean1, num, pct, shortPiece } from "./metrics";
import { MelodyTimeline } from "./MelodyTimeline";
import { SectionShell, type Values } from "./Prose";
import { BandPicker, PlayButton, shortBand } from "./Transport";

export const VAR2_PIECE = "osq-haydn-op76no3-ii-m40-60";

const SHADES = ["var(--w-ink)", "var(--w-ink-2)", "var(--w-ink-3)", "var(--w-rule)"];

export function StillWrong({ index }: { index: DemoIndex | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const cmp = useComparison();
  const [band, setBand] = useState("winds4");
  const aiId = `${VAR2_PIECE}__${band}__ai`;
  const gId = `${VAR2_PIECE}__${band}__greedy`;
  const ai = useResult(aiId, near);
  const g = useResult(gId, near);
  const base = ai.data ?? g.data;
  const player = useABPlayer(base?.midi.original, base?.midi.original, base?.musicxml.original, "original");
  const rosters = index?.rosters ?? [];
  const bandLabel = (id: string) => shortBand(rosters.find((r) => r.id === id)?.label ?? id);

  // Line-bars left out, summed per band, per planner (comparison.json rows[].dropped).
  const bandIds = [...new Set(cmp?.rows.map((r) => r.roster) ?? [])];
  const sums = (planner: "ai" | "greedy") =>
    bandIds.map((b) => ({
      band: b,
      bars: (cmp?.rows ?? []).filter((r) => r.roster === b).reduce((s, r) => s + (num(r[planner].dropped) ?? 0), 0),
    }));
  const aiSums = sums("ai");
  const gSums = sums("greedy");
  const aiTotal = aiSums.reduce((s, x) => s + x.bars, 0);
  const gTotal = gSums.reduce((s, x) => s + x.bars, 0);
  const maxTotal = Math.max(1, aiTotal, gTotal);
  const dropT = cmp?.totals.dropped;

  const v2rows = (cmp?.rows ?? []).filter((r) => r.piece === VAR2_PIECE);
  const v2ai = [...new Set(v2rows.map((r) => num(r.ai.melody_id)))];
  const v2g = [...new Set(v2rows.map((r) => num(r.greedy.melody_id)))];

  const values: Values = {};
  if (cmp) {
    const am = num(dropT?.ai_mean);
    const gm = num(dropT?.greedy_mean);
    Object.assign(values, {
      drop_lead:
        am === null || gm === null
          ? null
          : mean1(am) === mean1(gm)
            ? "The AI and the rule-based plan leave out about the same amount of music"
            : am > gm
              ? "The AI leaves out more music"
              : "The AI leaves out less music",
      drop_ai_mean: mean1(dropT?.ai_mean),
      drop_g_mean: mean1(dropT?.greedy_mean),
      drop_ai_sum: aiTotal,
      drop_g_sum: gTotal,
      drop_ai_better: dropT?.ai_better,
      drop_g_better: dropT?.greedy_better,
      drop_tie: dropT?.tie,
      drop_cb: aiSums.find((x) => x.band === "church_brass")?.bars,
      v2_ai: v2ai.length === 1 ? pct(v2ai[0]) : null,
      v2_g: v2g.length === 1 ? pct(v2g[0]) : null,
      v2_bands: v2ai.length === 1 && v2g.length === 1 ? `all ${v2rows.length} bands` : null,
      n_metrics: cmp.metrics.length,
    });
  }

  const Stack = ({ label, parts, total, planner }: { label: string; parts: Array<{ band: string; bars: number }>; total: number; planner: string }) => (
    <div className="why-stack-row" data-planner={planner} data-total={total}>
      <span className="why-stack-l">{label}</span>
      <span className="why-stack-track">
        {parts.map((p, k) =>
          p.bars > 0 ? (
            <span
              key={p.band}
              className="why-stack-seg"
              data-band={p.band}
              data-bars={p.bars}
              style={{ width: `${(p.bars / maxTotal) * 100}%`, "--shade": SHADES[k % SHADES.length] } as CSSProperties}
              title={`${bandLabel(p.band)}: ${p.bars} line-bars`}
            >
              <span>{p.bars}</span>
            </span>
          ) : null,
        )}
      </span>
      <span className="why-num why-stack-total">{total}</span>
    </div>
  );

  return (
    <SectionShell
      id="still-wrong"
      index="§4"
      kicker="Demo · what it still gets wrong"
      source="data: demos/comparison.json · corpus/manifest.json"
      section={section("still-wrong")}
      values={values}
    >
      <div className="why-panel why-panel--stack" ref={ref} data-demo="still-wrong">
        <figure className="why-sub" data-sub="dropped">
          <p className="why-sub-k">(a) Line-bars left out, all {cmp?.n_pairs ?? "…"} pairs</p>
          {cmp ? (
            <>
              <div className="why-stack">
                <Stack label="AI plan" parts={aiSums} total={aiTotal} planner="ai" />
                <Stack label="Rule-based plan" parts={gSums} total={gTotal} planner="greedy" />
              </div>
              <p className="why-stack-key">
                {bandIds.map((b, k) => (
                  <span key={b} style={{ "--shade": SHADES[k % SHADES.length] } as CSSProperties}>
                    <i aria-hidden="true" />
                    {bandLabel(b)}
                  </span>
                ))}
              </p>
              <figcaption className="why-cap">
                A line-bar is one bar of one original line; counted are line-bars with notes that no player plays, summed by band.
                Fewer left out: rule-based plan in {dropT?.greedy_better} pairs, AI in {dropT?.ai_better}, tied in {dropT?.tie}.
              </figcaption>
            </>
          ) : (
            <p className="why-loading">Loading the results…</p>
          )}
        </figure>

        <figure className="why-sub" data-sub="var2">
          <p className="why-sub-k">(b) {base ? shortPiece(base) : "Haydn, Var. II"}: who has the tune</p>
          <BandPicker bands={rosters.map((r) => ({ id: r.id, label: r.label }))} value={band} onChange={setBand} id="still-wrong" />
          {(ai.error || g.error) && <p className="why-error">{ai.error ?? g.error}</p>}
          {ai.data && g.data ? (
            <MelodyTimeline
              map={MELODY_MAPS[VAR2_PIECE] ?? []}
              parts={ai.data.source_parts}
              measures={ai.data.piece.measures}
              rows={[
                { key: "greedy", label: "Rule-based plan", result: g.data },
                { key: "ai", label: "AI plan", result: ai.data },
              ]}
              player={player}
            />
          ) : (
            <p className="why-loading">Loading both plans…</p>
          )}
          {v2rows.length > 0 && (
            <table className="why-mini" data-table="var2-melody-id">
              <caption>
                Melody identified, every band, against the AI-written reference map
                <span className="why-src"> · Source: demos/comparison.json → rows[].melody_id</span>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Band</th>
                  <th scope="col" className="why-num">AI</th>
                  <th scope="col" className="why-num">Rule-based</th>
                </tr>
              </thead>
              <tbody>
                {v2rows.map((r) => (
                  <tr key={r.roster} data-band={r.roster}>
                    <th scope="row">{bandLabel(r.roster)}</th>
                    <td className="why-num">{pct(num(r.ai.melody_id))}</td>
                    <td className="why-num">{pct(num(r.greedy.melody_id))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="why-panel-foot">
            <PlayButton player={player} label="Hear the original" id="still-wrong" />
            <span className="why-cap">
              The reference map puts the hymn in the cello; the busy line above it is{" "}
              {base?.source_parts.find((s) => s.id === "P1")?.name ?? "the first violin"}'s countermelody.
            </span>
          </div>
        </figure>

        <figure className="why-sub" data-sub="not-measured">
          <p className="why-sub-k">(c) What the numbers cover</p>
          {cmp && (
            <table className="why-mini why-measured">
              <caption className="sr-only">Metrics measured over all pairs, and what is not measured</caption>
              <tbody>
                {cmp.metrics.map((m) => (
                  <tr key={m.key} data-metric={m.key}>
                    <th scope="row">{metricText(m).name}</th>
                    <td>
                      measured, {cmp.totals[m.key]?.n ?? cmp.n_pairs} pairs
                      {(m.key === "melody_id" || m.key === "melody") && ", against the AI-written reference map"}
                    </td>
                  </tr>
                ))}
                <tr className="is-unmeasured" data-row="reference-map">
                  <th scope="row">The reference melody map behind both melody metrics</th>
                  <td>written by a Claude Code agent; not checked by a musician</td>
                </tr>
                <tr className="is-unmeasured" data-row="sounds-good">
                  <th scope="row">Whether the cover sounds good</th>
                  <td>not measured</td>
                </tr>
              </tbody>
            </table>
          )}
        </figure>
      </div>
    </SectionShell>
  );
}
