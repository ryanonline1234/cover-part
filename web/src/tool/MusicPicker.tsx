import { mm } from "../music";
import type { IndexPiece } from "../types";

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
}

/** The demo excerpts as a radio group of title cards. */
export function MusicPicker({ pieces, value, onChange, length = null }: Props) {
  return (
    <fieldset className="music">
      <legend className="sr-only">Music</legend>
      <div className="music-list">
        {pieces.map((p) => {
          const on = p.id === value;
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
    </fieldset>
  );
}
