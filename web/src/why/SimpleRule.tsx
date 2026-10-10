import { useRef, useState } from "react";
import type { DemoIndex } from "../types";
import { section } from "./copy";
import { useABPlayer, useComparison, useNear, useResult } from "./hooks";
import { MELODY_MAPS } from "./melodyMaps";
import { firstHandoff, melodyIdentified, pct, PART_ALIAS, shortPiece } from "./metrics";
import { MelodyTimeline } from "./MelodyTimeline";
import { SectionShell, type Values } from "./Prose";
import { BandPicker, PlayButton } from "./Transport";

export const DEMO2_PIECE = "osq-dvorak-op96-ii-m1-18";

export function SimpleRule({ index }: { index: DemoIndex | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const [band, setBand] = useState("church_brass");
  const aiId = `${DEMO2_PIECE}__${band}__ai`;
  const gId = `${DEMO2_PIECE}__${band}__greedy`;
  const ai = useResult(aiId, near);
  const g = useResult(gId, near);
  const cmp = useComparison();
  const map = MELODY_MAPS[DEMO2_PIECE] ?? [];
  const hand = firstHandoff(map);
  const base = ai.data ?? g.data;
  const player = useABPlayer(base?.midi.original, base?.midi.original, base?.musicxml.original, "original");
  const partName = (manifestName: string) => base?.source_parts.find((s) => s.id === PART_ALIAS[manifestName])?.name ?? manifestName;

  const values: Values = { ai_id: aiId, g_id: gId };
  if (hand) Object.assign(values, { handoff_from: partName(hand.from), handoff_to: partName(hand.to).replace(/^Violoncello$/, "the cello"), handoff_bar: hand.bar });
  if (ai.data && g.data) {
    const a = melodyIdentified(ai.data, map);
    const b = melodyIdentified(g.data, map);
    Object.assign(values, {
      band: `“${ai.data.roster.label.split(":")[0]}”`,
      ref_bars: a.of,
      ai_hit: a.hit,
      ai_pct: pct(a.share),
      g_hit: b.hit,
      g_pct: pct(b.share),
    });
  }
  if (cmp) {
    const t = cmp.totals.melody_id;
    Object.assign(values, {
      n_pairs: cmp.n_pairs,
      all_ai_pct: pct(t?.ai_mean),
      all_g_pct: pct(t?.greedy_mean),
      all_ai_better: t?.ai_better,
      all_g_better: t?.greedy_better,
      all_tie: t?.tie,
    });
  }

  const startBar = 9;
  const m0 = base?.piece.measures[0] ?? 1;
  return (
    <SectionShell
      id="simple-rule"
      index="§2"
      kicker="Demo · the top line isn't always the tune"
      source={`data: corpus/manifest.json melody_map · demos/${gId}.json · demos/${aiId}.json`}
      section={section("simple-rule")}
      values={values}
    >
      <div className="why-panel" ref={ref} data-demo="simple-rule">
        <div className="why-panel-head">
          <p className="why-panel-title">{base ? shortPiece(base) : "Loading…"}</p>
          <BandPicker bands={index?.rosters.map((r) => ({ id: r.id, label: r.label })) ?? []} value={band} onChange={setBand} id="simple-rule" />
        </div>
        {(ai.error || g.error) && <p className="why-error">{ai.error ?? g.error}</p>}
        {ai.data && g.data ? (
          <MelodyTimeline
            map={map}
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
        <div className="why-panel-foot">
          <PlayButton player={player} label={`Play the original from bar ${startBar}`} fromMeasure={startBar - m0} id="simple-rule" />
          {hand && (
            <span className="why-cap">
              Listen for bar {hand.bar}: the tune drops from {partName(hand.from)} to the cello, and {partName("Violin I")} keeps playing above it.
            </span>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
