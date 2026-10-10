import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ABPlayer } from "../audio";
import { mm, onColor, prettyRange } from "../music";
import type { ArrangeResult, Player } from "../types";
import { INSTRUMENT_NAME } from "./band";
import { PartSheet } from "./PartSheet";
import { dutiesOf, dutyText, restSpans, shortLine } from "./parts";

export type PlayMode = "solo" | "band";

interface Props {
  result: ArrangeResult;
  player: Player;
  /** 1-based stand number. */
  n: number;
  /** Name typed in the band row, if any (shown instead of the result's label). */
  name: string;
  audio: ABPlayer | null;
  /** This card's MIDI track, or null if the file can't be split by player. */
  track: number | null;
  /** Which card is driving playback, and how. */
  active: { id: string; mode: PlayMode } | null;
  onPlay: (id: string, mode: PlayMode) => void;
  onPrint: (id: string) => void;
  onDownload: (id: string) => void;
}

/** Bars the player covers, each span in its source line's color; rests are the bare staff line. */
function Strip({ result, playerId, audio, follow }: { result: ArrangeResult; playerId: string; audio: ABPlayer | null; follow: boolean }) {
  const [m0, m1] = result.piece.measures;
  const n = Math.max(1, m1 - m0 + 1);
  const duties = dutiesOf(result, playerId);
  const ref = useRef<HTMLDivElement>(null);

  // Playhead while this card is the one playing: a CSS variable, no React re-render.
  useEffect(() => {
    const el = ref.current;
    if (!el || !audio || !follow) return;
    let raf = 0;
    const loop = () => {
      const visible = audio.isPlaying || audio.position > 0;
      el.style.setProperty("--ph-o", visible ? "1" : "0");
      el.style.setProperty("--ph", `${Math.min(100, Math.max(0, (audio.measurePosition / n) * 100))}%`);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      el.style.setProperty("--ph-o", "0");
    };
  }, [audio, follow, n]);

  const col = (a: number, b: number): CSSProperties => ({
    gridColumn: `${Math.max(1, a - m0 + 1)} / ${Math.min(n, b - m0 + 1) + 1}`,
  });
  // First bar, every fourth bar, and the last bar unless it would crowd the tick before it.
  const ticks = Array.from({ length: n }, (_, i) => m0 + i).filter(
    (m) => m === m0 || (m - m0) % 4 === 0 || (m === m1 && (m1 - m0) % 4 >= 2),
  );

  return (
    <div className="strip" ref={ref} style={{ "--measures": n } as CSSProperties}>
      <div className="strip-track">
        {duties.map((d, i) => {
          const color = d.line?.color ?? "#1E1C18";
          return (
            <span
              key={i}
              className="strip-seg"
              style={{ ...col(d.a.start_measure, d.a.end_measure), "--line": color, "--on-line": onColor(color) } as CSSProperties}
              title={dutyText(d)}
            >
              <span className="strip-seg-text">
                {shortLine(d.line?.name ?? d.a.source_part)}
                {d.role ? <span className="strip-role"> {d.role.split(",")[0]}</span> : null}
              </span>
            </span>
          );
        })}
      </div>
      <div className="strip-ruler" aria-hidden="true">
        {ticks.map((m) => (
          <span key={m} className="strip-mnum" style={col(m, m)}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
      {playing ? (
        <g fill="currentColor">
          <rect x="4.5" y="3.5" width="3.6" height="13" />
          <rect x="11.9" y="3.5" width="3.6" height="13" />
        </g>
      ) : (
        <path d="M5.5 3.2v13.6L16.6 10z" fill="currentColor" />
      )}
    </svg>
  );
}

export function PartCard({ result, player: p, n, name, audio, track, active, onPlay, onPrint, onDownload }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [systems, setSystems] = useState(0);
  const duties = dutiesOf(result, p.id);
  const rests = restSpans(result, duties);
  const xml = result.musicxml.parts[p.id];
  const title = name || p.label;
  const inst = INSTRUMENT_NAME.get(p.instrument) ?? p.instrument;
  const isActive = active?.id === p.id;
  const playing = !!audio?.isPlaying && isActive;
  const loading = audio?.load.status === "loading" && isActive;
  const btn = (mode: PlayMode) => {
    const on = playing && active?.mode === mode;
    const text = mode === "solo" ? (on ? "Pause" : "This part alone") : on ? "Pause" : "With the band";
    return (
      <button
        type="button"
        className={`card-play ${on ? "is-on" : ""}`}
        onClick={() => onPlay(p.id, mode)}
        disabled={!audio || (mode === "solo" && track === null)}
        // The visible text is the same on every card; the accessible name says whose part it is.
        aria-label={`${text}: ${title}`}
        title={mode === "solo" && track === null ? "This result's audio can't be split by player." : undefined}
      >
        <PlayIcon playing={on} />
        {text}
      </button>
    );
  };

  return (
    <li className={`part ${isActive ? "is-active" : ""}`} aria-labelledby={`part-${p.id}`}>
      <div className="part-head">
        <span className="part-n" aria-hidden="true">
          {n}
        </span>
        <div className="part-who">
          <h3 className="part-name" id={`part-${p.id}`}>
            {title}
          </h3>
          <p className="part-meta">
            {title !== inst && <>{inst} · </>}
            {p.level ?? "intermediate"} · written range {prettyRange(p.range_written)}
          </p>
        </div>
      </div>

      <Strip result={result} playerId={p.id} audio={audio} follow={isActive} />
      <p className="part-duties">
        {duties.length === 0 ? (
          <span className="part-rests">Rests throughout. The plan gave this player no line.</span>
        ) : (
          <>
            {duties.map((d, i) => (
              <span key={i} className="part-duty" style={{ "--line": d.line?.color ?? "#1E1C18" } as CSSProperties}>
                {dutyText(d)}
              </span>
            ))}
            {rests.length > 0 && <span className="part-rests">Rests {rests.map(([a, b]) => mm(a, b).replace(/^mm?\. /, "")).join(", ")}</span>}
          </>
        )}
      </p>

      {xml ? (
        <>
          <PartSheet xml={xml} label={`${title} part, written pitch`} expanded={expanded} onSystems={setSystems} />
          {systems > 1 && (
            <button type="button" className="part-expand" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
              {expanded ? "Show the first line only" : `Show the whole part (${systems} lines)`}
            </button>
          )}
        </>
      ) : (
        <p className="partsheet-status">No part file in this result.</p>
      )}

      <div className="part-actions">
        {btn("solo")}
        {btn("band")}
        <span className="part-actions-sep" aria-hidden="true" />
        <button type="button" className="card-link" onClick={() => onPrint(p.id)} disabled={!xml} aria-label={`Print: ${title}`}>
          Print
        </button>
        <button
          type="button"
          className="card-link"
          onClick={() => onDownload(p.id)}
          disabled={!xml}
          aria-label={`Download .musicxml: ${title}`}
          title="This part as a .musicxml file (opens in MuseScore, Finale, Sibelius, Dorico)"
        >
          Download<span className="card-link-ext"> .musicxml</span>
        </button>
      </div>
      {loading && audio?.load.status === "loading" && (
        <p className="part-status" aria-live="polite">
          Loading instrument sounds, {audio.load.done} of {audio.load.total}…
        </p>
      )}
      {isActive && audio?.load.status === "error" && (
        <p className="part-status" aria-live="polite">
          Sounds didn't load ({audio.load.message}). Check the connection and try again.
        </p>
      )}
    </li>
  );
}
