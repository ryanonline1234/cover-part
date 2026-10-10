import { useEffect, useRef } from "react";
import type { Roster } from "../types";
import { INSTRUMENTS, INSTRUMENT_NAME, LEVELS, MAX_PLAYERS, bandFromRoster, newPlayer, type BandPlayer, type Level } from "./band";

interface Props {
  band: BandPlayer[];
  onChange: (band: BandPlayer[]) => void;
  presets: Roster[];
  /** Id of the preset the band currently is, if any. */
  presetId: string | null;
}

/** "Church brass: 2 trumpets (one beginner), horn, euphonium" -> ["Church brass", "2 trumpets (one beginner), horn, euphonium"]. */
function presetName(label: string): [string, string | null] {
  const i = label.indexOf(": ");
  return i > 0 ? [label.slice(0, i), label.slice(i + 2)] : [label, null];
}

/** The editable band: one stand per player, preset bands as quick-fill chips. */
export function BandRow({ band, onChange, presets, presetId }: Props) {
  const edit = (key: number, patch: Partial<BandPlayer>) => onChange(band.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const last = band[band.length - 1];
  const listRef = useRef<HTMLOListElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  /** Where keyboard focus goes after the control that had it disappears (Remove, the 8th Add). */
  const focusNext = useRef<{ kind: "stand"; index: number } | { kind: "note" } | null>(null);

  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    focusNext.current = null;
    if (want.kind === "note") {
      noteRef.current?.focus();
      return;
    }
    // The player who moved up into the removed stand, else "+ Add player" (or the last stand).
    const stands = listRef.current?.querySelectorAll<HTMLElement>(".stand:not(.stand--add)") ?? [];
    const target =
      stands[want.index]?.querySelector<HTMLElement>("select") ??
      listRef.current?.querySelector<HTMLElement>(".stand-add") ??
      stands[stands.length - 1]?.querySelector<HTMLElement>("select");
    target?.focus();
  }, [band]);

  const remove = (key: number, index: number) => {
    focusNext.current = { kind: "stand", index };
    onChange(band.filter((x) => x.key !== key));
  };
  const add = () => {
    if (band.length + 1 >= MAX_PLAYERS) focusNext.current = { kind: "note" };
    onChange([...band, newPlayer(last?.instrument ?? "flute", last?.level ?? "intermediate")]);
  };

  return (
    <div className="band">
      <div className="presets" role="group" aria-label="Fill in a preset band">
        <span className="presets-label">Quick fill</span>
        {presets.map((r) => {
          const [name, detail] = presetName(r.label);
          return (
            <button
              key={r.id}
              type="button"
              className={`preset ${presetId === r.id ? "is-on" : ""}`}
              aria-pressed={presetId === r.id}
              title={r.label}
              onClick={() => onChange(bandFromRoster(r))}
            >
              <span className="preset-name">{name}</span>
              {detail && <span className="preset-detail">{detail}</span>}
            </button>
          );
        })}
      </div>

      <ol className="stands" ref={listRef}>
        {band.map((p, i) => (
          <li key={p.key} className="stand">
            <span className="stand-n" aria-hidden="true">
              {i + 1}
            </span>
            <label className="stand-field stand-inst">
              <span className="sr-only">Player {i + 1} instrument</span>
              <select value={p.instrument} onChange={(e) => edit(p.key, { instrument: e.target.value })}>
                {INSTRUMENTS.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="stand-field stand-level">
              <span className="sr-only">Player {i + 1} level</span>
              <select value={p.level} onChange={(e) => edit(p.key, { level: e.target.value as Level })}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="stand-field stand-name">
              <span className="sr-only">Player {i + 1} name (optional)</span>
              <input
                type="text"
                value={p.name}
                placeholder="Name (optional)"
                maxLength={40}
                autoComplete="off"
                onChange={(e) => edit(p.key, { name: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="stand-remove"
              disabled={band.length <= 1}
              onClick={() => remove(p.key, i)}
              aria-label={`Remove player ${i + 1} (${p.name.trim() || INSTRUMENT_NAME.get(p.instrument)})`}
              title="Remove this player"
            >
              <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>
          </li>
        ))}
        {band.length < MAX_PLAYERS && (
          <li className="stand stand--add">
            <button type="button" className="stand-add" onClick={add}>
              + Add player
            </button>
          </li>
        )}
      </ol>
      {band.length >= MAX_PLAYERS && (
        <p className="band-note" ref={noteRef} tabIndex={-1}>
          {MAX_PLAYERS} players is the most the engine arranges for.
        </p>
      )}
    </div>
  );
}
