import { useEffect, useRef, useState } from "react";
import { arrangeLive } from "./data";
import type { ArrangeResult, Planner, Roster } from "./types";

// Instrument ids accepted by engine/coverpart/instruments.py.
const INSTRUMENTS: [string, string][] = [
  ["flute", "Flute"],
  ["oboe", "Oboe"],
  ["clarinet", "Clarinet in B♭"],
  ["alto_sax", "Alto sax"],
  ["tenor_sax", "Tenor sax"],
  ["bari_sax", "Baritone sax"],
  ["bassoon", "Bassoon"],
  ["trumpet", "Trumpet in B♭"],
  ["horn", "Horn in F"],
  ["trombone", "Trombone"],
  ["euphonium", "Euphonium"],
  ["tuba", "Tuba"],
  ["violin", "Violin"],
  ["viola", "Viola"],
  ["cello", "Cello"],
  ["double_bass", "Double bass"],
];
const NAME = new Map(INSTRUMENTS);
const LEVELS = ["beginner", "intermediate", "advanced"] as const;
const MAX_PLAYERS = 8;

interface Draft {
  key: number;
  id: string;
  instrument: string;
  level: string;
  label: string;
}

let keySeq = 0;

function seedFrom(roster: Roster | null): Draft[] {
  return (roster?.players ?? []).map((p) => ({
    key: ++keySeq,
    id: p.id,
    instrument: NAME.has(p.instrument) ? p.instrument : "flute",
    level: p.level ?? "intermediate",
    label: p.label ?? "",
  }));
}

function uniqueIds(players: Draft[]): Draft[] {
  const seen = new Set<string>();
  return players.map((p) => {
    let id = p.id || p.instrument;
    let k = 2;
    while (seen.has(id)) id = `${p.id || p.instrument}_${k++}`;
    seen.add(id);
    return { ...p, id };
  });
}

interface Props {
  pieceId: string;
  seed: Roster | null;
  planner: Planner;
  onResult: (r: ArrangeResult, seconds: number) => void;
}

type Status = { kind: "idle" } | { kind: "running"; started: number } | { kind: "error"; message: string };

export function RosterEditor({ pieceId, seed, planner, onResult }: Props) {
  const [players, setPlayers] = useState<Draft[]>(() => seedFrom(seed));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  // Re-seed when the preset changes.
  useEffect(() => {
    setPlayers(seedFrom(seed));
  }, [seed?.id]); // only on preset change, not on every parent render

  useEffect(() => {
    if (status.kind !== "running") return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [status.kind]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const edit = (key: number, patch: Partial<Draft>) =>
    setPlayers((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const add = () =>
    setPlayers((ps) => [...ps, { key: ++keySeq, id: `p${ps.length + 1}`, instrument: "flute", level: "intermediate", label: "" }]);

  const run = async () => {
    const ps = uniqueIds(players);
    setPlayers(ps);
    const label = `Custom: ${ps.map((p) => p.label.trim() || NAME.get(p.instrument) || p.instrument).join(", ")}`;
    const ctl = new AbortController();
    abortRef.current = ctl;
    const started = Date.now();
    setNow(started);
    setStatus({ kind: "running", started });
    try {
      const result = await arrangeLive(
        {
          piece_id: pieceId,
          planner,
          roster: {
            id: "custom",
            label,
            players: ps.map((p) => ({
              id: p.id,
              instrument: p.instrument,
              level: p.level,
              ...(p.label.trim() ? { label: p.label.trim() } : {}),
            })),
          },
        },
        ctl.signal,
      );
      setStatus({ kind: "idle" });
      onResult(result, Math.round((Date.now() - started) / 1000));
    } catch (e) {
      if (ctl.signal.aborted) {
        setStatus({ kind: "idle" });
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({
        kind: "error",
        message: /HTTP 50[0-4]|Failed to fetch|NetworkError/.test(msg)
          ? `${msg} Is the engine running? cd engine && ../.venv/bin/uvicorn coverpart.api:app --port 8000`
          : msg,
      });
    } finally {
      abortRef.current = null;
    }
  };

  const running = status.kind === "running";
  const elapsed = running ? Math.max(0, Math.floor((now - status.started) / 1000)) : 0;

  return (
    <div className="live">
      <p className="block-lede">
        Change the players, then re-score with {planner === "ai" ? "the AI plan" : "the rule-based baseline"} (switch it
        above). This runs the engine on this machine; nothing is saved.
      </p>
      <ol className="live-players">
        {players.map((p, i) => (
          <li key={p.key} className="live-player">
            <span className="live-n" aria-hidden="true">
              {i + 1}
            </span>
            <label className="field">
              <span className="field-label">Instrument</span>
              <select
                value={p.instrument}
                disabled={running}
                onChange={(e) => edit(p.key, { instrument: e.target.value, label: "" })}
              >
                {INSTRUMENTS.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Level</span>
              <select value={p.level} disabled={running} onChange={(e) => edit(p.key, { level: e.target.value })}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field live-label">
              <span className="field-label">Name on the part (optional)</span>
              <input
                type="text"
                value={p.label}
                placeholder={NAME.get(p.instrument)}
                disabled={running}
                maxLength={40}
                onChange={(e) => edit(p.key, { label: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="btn btn--quiet live-remove"
              disabled={running || players.length <= 1}
              onClick={() => setPlayers((ps) => ps.filter((x) => x.key !== p.key))}
              aria-label={`Remove player ${i + 1}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      <div className="live-actions">
        <button type="button" className="btn btn--quiet" onClick={add} disabled={running || players.length >= MAX_PLAYERS}>
          Add a player
        </button>
        <button type="button" className="btn btn--ink" onClick={run} disabled={running || players.length === 0}>
          Re-score for these players
        </button>
        {running && (
          <button type="button" className="btn btn--quiet" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        )}
      </div>
      <p className="live-status" aria-live="polite">
        {running && (
          <>
            <span className="live-clock">{elapsed}&nbsp;s</span>{" "}
            {planner === "ai"
              ? "The AI is planning; then the checker runs and may send the plan back for another round. This usually takes 20 to 120 seconds."
              : "The baseline rule runs, then the checker. This takes a few seconds."}
          </>
        )}
        {status.kind === "error" && <span className="live-error">Re-score failed: {status.message}</span>}
      </p>
    </div>
  );
}
