import type { CSSProperties } from "react";
import { downloadText, mm, octaveNote, prettyRange, slug, sourceById } from "./music";
import type { ArrangeResult } from "./types";

export function Plan({ result }: { result: ArrangeResult }) {
  const sources = sourceById(result);
  const { plan } = result;

  return (
    <div className="plan">
      <div className="plan-summary">
        <p className="plan-summary-text">{plan.summary}</p>
        <p className="plan-by">
          {result.planner === "ai"
            ? `Planned by ${result.model ?? "an AI model"}. Transposition, range checks and repair are plain code.`
            : "No AI here: fixed rules call the highest line the melody and the lowest the bass, rank the rest by activity, and give each line to the free player whose range fits it best (with octave shifts)."}
        </p>
      </div>

      <ol className="players">
        {result.roster.players.map((p) => {
          const mine = plan.assignments
            .filter((a) => a.player === p.id)
            .sort((a, b) => a.start_measure - b.start_measure || a.source_part.localeCompare(b.source_part));
          const xml = result.musicxml.parts[p.id];
          return (
            <li className="player" key={p.id}>
              <div className="player-head">
                <h3 className="player-name">{p.label}</h3>
                <p className="player-range">
                  {p.level ? `${p.level}, ` : ""}written range {prettyRange(p.range_written)}
                </p>
                {xml ? (
                  <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() =>
                      downloadText(`${slug(result.piece.title)}-${slug(p.label)}.musicxml`, xml)
                    }
                  >
                    Download {p.label} part
                  </button>
                ) : (
                  <p className="player-range">No part file in this result.</p>
                )}
              </div>
              {mine.length === 0 ? (
                <p className="player-rest">Rests throughout.</p>
              ) : (
                <ul className="duties">
                  {mine.map((a, i) => {
                    const sp = sources.get(a.source_part);
                    const shift = octaveNote(a.octave_shift);
                    return (
                      <li key={i} style={{ "--line": sp?.color ?? "#1E1C18" } as CSSProperties}>
                        <p className="duty-what">
                          <span className="duty-line">{sp?.name ?? a.source_part}</span>, {mm(a.start_measure, a.end_measure)}
                          {shift && <>, {shift}</>}
                        </p>
                        <p className="duty-why">{a.reason}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
