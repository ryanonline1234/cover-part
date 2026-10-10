import { useRef, useState, type CSSProperties } from "react";
import { ScoreView } from "../Score";
import type { ArrangeResult, DemoIndex } from "../types";
import { pickNote } from "./candidates";
import { section } from "./copy";
import { useABPlayer, useNear, useResult } from "./hooks";
import { midiToName, partRanges, shortPiece } from "./metrics";
import { SectionShell, type Values } from "./Prose";
import { bandExtremes, RangeChart } from "./RangeChart";
import { BandPicker, PlayButton, shortBand, Switch } from "./Transport";

/** DEMO 1 excerpt: every preset band has notes out of range as written (see the builder's report). */
export const DEMO1_PIECE = "osq-haydn-op20no2-i-m0-14";

type Bands = Array<{ id: string; label: string }>;

function bandsOf(index: DemoIndex | null): Bands {
  return index ? index.rosters.map((r) => ({ id: r.id, label: r.label })) : [];
}

// ---------------------------------------------------------------------------
// Opening: the situation
// ---------------------------------------------------------------------------

export function Situation({ index, band, setBand }: { index: DemoIndex | null; band: string; setBand: (b: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref, "200px");
  const id = `${DEMO1_PIECE}__${band}__ai`;
  const res = useResult(id, near);
  const r = res.data;
  const player = useABPlayer(r?.midi.original, r?.midi.original, r?.musicxml.original, "original");

  const values: Values = {
    n_pieces: index?.pieces.length,
    n_bands: index?.rosters.length,
    band_list: index?.rosters.map((x) => x.label).join("; "),
    result_id: id,
  };
  const names = r?.source_parts.map((p) => p.name) ?? [];
  if (names.length) values.line_names = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  if (r) {
    const pr = partRanges(r.musicxml.original);
    const v1 = pr[0];
    const vc = pr[r.source_parts.length - 1];
    const ex = bandExtremes(r);
    Object.assign(values, {
      piece: shortPiece(r),
      band: shortBand(r.roster.label),
      v1_range: v1 ? `${midiToName(v1.lo)}–${midiToName(v1.hi)}` : null,
      cello_range: vc ? `${midiToName(vc.lo)}–${midiToName(vc.hi)}` : null,
      band_hi: ex.hi ? midiToName(ex.hi.m) : null,
      band_hi_player: ex.hi?.who,
      band_lo: ex.lo ? midiToName(ex.lo.m) : null,
      band_lo_player: ex.lo?.who,
    });
  }

  return (
    <SectionShell id="situation" index="§0" kicker="Why Cover Part exists" source={`data: demos/${id}.json`} section={section("situation")} values={values} hero>
      <div className="why-panel" ref={ref}>
        <div className="why-panel-head">
          <p className="why-panel-title">{r ? shortPiece(r) : "Loading the excerpt…"}</p>
          <BandPicker bands={bandsOf(index)} value={band} onChange={setBand} id="situation" />
        </div>
        {res.error && <p className="why-error">{res.error}</p>}
        {r && <RangeChart result={r} />}
        <div className="why-panel-foot">
          <PlayButton player={player} label="Hear the original quartet" id="situation" />
          <span className="why-cap">Synthesized from the score (General MIDI samples), not a recording.</span>
        </div>
      </div>
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------
// DEMO 1: hand the parts out as written
// ---------------------------------------------------------------------------

type View = "as_written" | "cover";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function perPlayer(r: ArrangeResult): Array<{ id: string; label: string; n: number; range: string }> {
  const counts = new Map<string, number>();
  for (const v of r.checks.violations ?? []) counts.set(v.player, (counts.get(v.player) ?? 0) + 1);
  return r.roster.players.map((p) => ({
    id: p.id,
    label: p.label,
    n: counts.get(p.id) ?? 0,
    range: `${p.range_sounding[0]}–${p.range_sounding[1]}`,
  }));
}

export function AsWritten({ index, band, setBand }: { index: DemoIndex | null; band: string; setBand: (b: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const [view, setView] = useState<View>("as_written");
  const aswId = `${DEMO1_PIECE}__${band}__as_written`;
  const aiId = `${DEMO1_PIECE}__${band}__ai`;
  const asw = useResult(aswId, near, 15000); // generated in parallel: poll until it appears
  const ai = useResult(aiId, near);
  const shown = view === "as_written" ? asw.data : ai.data;
  const player = useABPlayer(asw.data?.midi.arranged, ai.data?.midi.arranged, ai.data?.musicxml.original, view === "as_written" ? "original" : "arranged");

  const sp = new Map((ai.data ?? asw.data)?.source_parts.map((s) => [s.id, s]) ?? []);
  const players = new Map((asw.data ?? ai.data)?.roster.players.map((p) => [p.id, p]) ?? []);
  const mapping = (asw.data?.plan.assignments ?? []).map((a) => ({
    from: sp.get(a.source_part),
    to: players.get(a.player)?.label ?? a.player,
  }));
  const unmapped = asw.data ? asw.data.source_parts.filter((s) => !asw.data!.plan.assignments.some((a) => a.source_part === s.id)) : [];
  const tally = asw.data ? perPlayer(asw.data) : [];
  const worst = tally.reduce<(typeof tally)[number] | null>((w, t) => (!w || t.n > w.n ? t : w), null);
  const maxN = Math.max(1, ...tally.map((t) => t.n));

  const values: Values = { asw_id: aswId, ai_id: aiId };
  if (asw.data) {
    Object.assign(values, {
      piece: shortPiece(asw.data),
      band: `“${shortBand(asw.data.roster.label)}”`,
      mapping: mapping.map((m) => `${m.from?.name ?? "?"} to ${m.to}`).join(", "),
      asw_oor: asw.data.checks.notes_out_of_range,
      asw_total: asw.data.checks.notes_total,
      asw_worst_player: worst && worst.n > 0 ? worst.label : null,
      asw_worst_count: worst && worst.n > 0 ? worst.n : null,
    });
  }
  if (ai.data) {
    Object.assign(values, {
      ai_oor: ai.data.checks.notes_out_of_range,
      ai_folded: ai.data.checks.notes_folded,
      ai_dropped: ai.data.checks.measures_dropped ?? null,
    });
  }

  const big = shown?.checks.notes_out_of_range;
  return (
    <SectionShell
      id="as-written"
      index="§1"
      kicker="Demo · hand the parts out"
      source={`data: demos/${view === "as_written" ? aswId : aiId}.json`}
      section={section("as-written")}
      values={values}
    >
      <div className="why-panel" ref={ref} data-demo="as-written" data-view={view}>
        <div className="why-panel-head">
          <p className="why-panel-title">{shortPiece(asw.data ?? ai.data) || "Loading…"}</p>
          <BandPicker bands={bandsOf(index)} value={band} onChange={setBand} id="as-written" />
        </div>

        {mapping.length > 0 && (
          <ol className="why-mapping" aria-label="Who gets which part, as written">
            {mapping.map((m, i) => (
              <li key={i} style={{ "--line": m.from?.color } as CSSProperties}>
                <span className="why-swatch" aria-hidden="true" />
                {m.from?.name} <span className="why-arrow" aria-hidden="true">→</span> {m.to}
              </li>
            ))}
            {unmapped.map((s) => (
              <li key={s.id} className="is-unmapped" style={{ "--line": s.color } as CSSProperties}>
                <span className="why-swatch" aria-hidden="true" />
                {s.name} <span className="why-arrow" aria-hidden="true">→</span> nobody
              </li>
            ))}
          </ol>
        )}

        <div className="why-controls">
          <Switch
            label="Which parts"
            id="as-written"
            value={view}
            onChange={setView}
            options={[
              { value: "as_written", label: "As written" },
              { value: "cover", label: "Cover Part's version" },
            ]}
          />
          <PlayButton player={player} label={view === "as_written" ? "Play the parts as written" : "Play Cover Part's version"} id="as-written" />
        </div>

        <div className="why-readout" aria-live="polite">
          <p className="why-big" data-figure="notes_out_of_range">
            <span className="why-big-n" key={`${view}-${band}-${big ?? "x"}`}>
              {big ?? "…"}
            </span>
            <span className="why-big-l">
              {view === "as_written" ? "notes outside the player's assumed range" : "notes out of range"}
              {shown && (
                <small>
                  of {shown.checks.notes_total} notes ·{" "}
                  {view === "as_written"
                    ? `${plural(shown.checks.measures_dropped ?? 0, "line-bar")} nobody plays`
                    : `${plural(shown.checks.notes_folded, "single note")} moved an octave · ${plural(shown.checks.measures_dropped ?? 0, "line-bar")} left out`}
                </small>
              )}
            </span>
          </p>
          {view === "as_written" && tally.length > 0 && (
            <table className="why-tally">
              <caption className="sr-only">Notes out of range per player, as written</caption>
              <tbody>
                {tally.map((t) => (
                  <tr key={t.id} data-player={t.id} data-n={t.n}>
                    <th scope="row">{t.label}</th>
                    <td className="why-tally-bar">
                      <span style={{ transform: `scaleX(${t.n / maxN})` }} />
                    </td>
                    <td className="why-num">{t.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === "cover" && ai.data && (
            <p className="why-cap">
              Same band, planned by the AI{pickNote(ai.data) ? ` (${pickNote(ai.data)})` : ""} and checked by code (precomputed). Each
              line keeps its color in the score below, wherever it goes.
            </p>
          )}
        </div>

        {view === "as_written" && asw.error && !asw.data && (
          <p className="why-error">The as-written parts aren't generated yet ({asw.error}). Checking again every 15 seconds.</p>
        )}
        {view === "cover" && ai.error && <p className="why-error">{ai.error}</p>}
        {shown && (
          <div className="why-score">
            <ScoreView
              xml={shown.musicxml.arranged}
              label={
                view === "as_written"
                  ? "Full score as written, notes outside the player's assumed range drawn with x noteheads"
                  : "Cover Part's score, notes colored by source line"
              }
              player={player}
              follow
            />
            <p className="why-cap">
              {view === "as_written"
                ? "Concert pitch. Notes outside the player's assumed range are drawn with x noteheads; playback plays them anyway, so you hear what the page asks for."
                : "Concert pitch. Each player's own part (written pitch, right clef) is in the tool."}
            </p>
          </div>
        )}
      </div>
    </SectionShell>
  );
}
