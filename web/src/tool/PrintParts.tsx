import { useEffect, useState } from "react";
import { mm, prettyRange } from "../music";
import type { ArrangeResult } from "../types";
import { INSTRUMENT_NAME } from "./band";
import { dutiesOf, dutyText, restSpans, withoutStaffLabels } from "./parts";
import { queueRender } from "./renderQueue";

/** Letter/A4 printable width at 96 px per inch, 0.5 in margins: render at this width, CSS scales to fit. */
const PRINT_W = 720;
/** Height of one engraved block; the first page also holds the part's header. */
const PRINT_H = 780;
const PRINT_SCALE = 36;

interface Props {
  result: ArrangeResult;
  /** Display names typed in the band row, by player id. */
  names: Map<string, string>;
  /** Print just this player's part (null: every part). */
  only: string | null;
  /** Called with true once every part has been engraved at print size. */
  onReady: (ready: boolean) => void;
}

/**
 * The printed folder: one player's full part per page, engraved again at print size. Hidden on screen;
 * @media print shows it and hides everything else on the tool page.
 */
export function PrintParts({ result, names, only, onReady }: Props) {
  const [svgs, setSvgs] = useState<Record<string, string[]>>({});
  const players = result.roster.players;

  useEffect(() => {
    let live = true;
    setSvgs({});
    onReady(false);
    const jobs = players
      .filter((p) => result.musicxml.parts[p.id])
      .map((p) => {
        const job = queueRender(withoutStaffLabels(result.musicxml.parts[p.id]), PRINT_W, { scale: PRINT_SCALE, heightPx: PRINT_H, viewBox: true, marginTop: 30, marginX: 20, timemap: false }, "low");
        job.promise.then((r) => live && setSvgs((s) => ({ ...s, [p.id]: r.pages }))).catch(() => {});
        return job;
      });
    Promise.allSettled(jobs.map((j) => j.promise)).then(() => live && onReady(true));
    return () => {
      live = false;
      jobs.forEach((j) => j.cancel());
    };
    // Re-engrave only when the result changes (players and onReady follow from it / are stable).
  }, [result]);

  const piece = result.piece;
  const work = [piece.title, piece.movement].filter(Boolean).join(" — ");

  return (
    <div className="print-folder" aria-hidden="true">
      {players.map((p) => {
        const duties = dutiesOf(result, p.id);
        const rests = restSpans(result, duties);
        const name = names.get(p.id) || p.label;
        const inst = INSTRUMENT_NAME.get(p.instrument) ?? p.instrument;
        return (
          <section key={p.id} className="print-sheet" hidden={only !== null && only !== p.id}>
            <header className="ps-head">
              <p className="ps-work">{work}</p>
              <p className="ps-composer">
                {piece.composer} · {mm(piece.measures[0], piece.measures[1])}
              </p>
              <h1 className="ps-player">{name}</h1>
              <p className="ps-inst">
                {name !== inst ? `${inst} · ` : ""}
                {p.level ?? "intermediate"} · written range {prettyRange(p.range_written)} · part in written pitch
              </p>
              <p className="ps-cues">
                {duties.length ? `You play: ${duties.map(dutyText).join("; ")}.` : "Rests throughout."}
                {duties.length > 0 && rests.length > 0 && ` Rests: ${rests.map(([a, b]) => mm(a, b)).join(", ")}.`}
              </p>
            </header>
            <div className="ps-music">
              {(svgs[p.id] ?? []).map((svg, i) => (
                <div className="ps-page" key={i} dangerouslySetInnerHTML={{ __html: svg }} />
              ))}
              {!svgs[p.id] && <p className="ps-wait">Engraving this part for print…</p>}
            </div>
            <footer className="ps-foot">Arranged with Cover Part · source: {piece.source ?? "OpenScore String Quartets (CC0)"}</footer>
          </section>
        );
      })}
    </div>
  );
}
