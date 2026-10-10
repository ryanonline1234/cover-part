import { useState, type DragEvent } from "react";
import { mm } from "../music";
import type { IndexPiece } from "../types";
import { dragHasFiles, droppedFile } from "./UploadPanel";

/** "String Quartet No.12 in F major, Op.96 (“American”)" -> "“American” Quartet, Op. 96". */
export function shortWork(title: string): string {
  const nick = /\(\s*(“[^”]+”)\s*\)/.exec(title)?.[1];
  const opus = /Op\.\s?(\d+)(?:\s?No\.\s?(\d+))?/.exec(title);
  const op = opus ? `Op. ${opus[1]}${opus[2] ? ` No. ${opus[2]}` : ""}` : null;
  if (nick) return `${nick} Quartet${op ? `, ${op}` : ""}`;
  const head = title.split(", ")[0].replace(/-flat\b/g, "♭").replace(/-sharp\b/g, "♯");
  return op ? `${head}, ${op}` : head;
}

export function surname(composer: string): string {
  return composer.replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(-1)[0];
}

interface Props {
  pieces: IndexPiece[];
  value: string;
  onChange: (id: string) => void;
  /** Length of the selected excerpt ("about 1 min"), once a result for it has loaded; null if unknown. */
  length?: string | null;
  /** The seventh option: the director's own MusicXML file. */
  upload: {
    on: boolean;
    /** Title of the file read so far, if any. */
    title: string | null;
    onSelect: () => void;
    /** A file dropped on the card (desktop). */
    onFile: (f: File) => void;
  };
}

/** The demo excerpts, then "use your own score", as one radio group of title cards. */
export function MusicPicker({ pieces, value, onChange, length = null, upload }: Props) {
  const [drag, setDrag] = useState(false);
  return (
    <fieldset className="music">
      <legend className="sr-only">Music</legend>
      <div className="music-list">
        {pieces.map((p) => {
          const on = !upload.on && p.id === value;
          return (
            <label key={p.id} className={`piece ${on ? "is-on" : ""}`}>
              <input type="radio" name="piece" value={p.id} checked={on} onChange={() => onChange(p.id)} />
              <span className="piece-top">
                <span className="piece-composer">{surname(p.composer)}</span>
                <span className="piece-bars">
                  {mm(p.measures[0], p.measures[1])}
                  {on && length ? <span className="piece-length">, {length}</span> : null}
                </span>
              </span>
              <span className="piece-work">{shortWork(p.title)}</span>
              {p.movement && <span className="piece-mvt">{p.movement}</span>}
              {p.why && <span className="piece-why">{p.why}</span>}
            </label>
          );
        })}
      </div>
      <label
        className={`piece piece--upload ${upload.on ? "is-on" : ""} ${drag ? "is-drag" : ""}`}
        onDragOver={(e: DragEvent) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDrag(true);
        }}
        onDragLeave={(e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
        }}
        onDrop={(e: DragEvent) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          setDrag(false);
          const f = droppedFile(e);
          if (f) upload.onFile(f);
        }}
      >
        <input type="radio" name="piece" value="__upload__" checked={upload.on} onChange={upload.onSelect} />
        <span className="piece-plus" aria-hidden="true">
          +
        </span>
        <span className="piece-upload-text">
          <span className="piece-work">{upload.title ? `Your score: ${upload.title}` : "Use your own score"}</span>
          <span className="piece-why">
            A MusicXML file from MuseScore, Finale or Sibelius (.musicxml, .xml, .mxl). Arranged live with the rule-based plan;
            nothing is stored.
          </span>
        </span>
      </label>
    </fieldset>
  );
}
