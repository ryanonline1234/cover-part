import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ABPlayer, Side } from "./audio";

function useVersion(player: ABPlayer | null) {
  const ref = useRef(0);
  return useSyncExternalStore(
    (cb) => {
      if (!player) return () => {};
      return player.subscribe(() => {
        ref.current++;
        cb();
      });
    },
    () => ref.current,
  );
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Props {
  player: ABPlayer | null;
  side: Side;
  onSide: (s: Side) => void;
  coverLabel: string;
}

export function PlayerBar({ player, side, onSide, coverLabel }: Props) {
  useVersion(player);
  const rangeRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!player) return;
    let raf = 0;
    const loop = () => {
      const pos = player.position;
      if (rangeRef.current && !dragging.current) {
        rangeRef.current.value = String(pos);
        rangeRef.current.style.setProperty("--p", `${(pos / (player.duration || 1)) * 100}%`);
      }
      if (timeRef.current) timeRef.current.textContent = clock(pos);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  // Space toggles playback when focus isn't in a form control.
  useEffect(() => {
    if (!player) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, select, textarea, button, [contenteditable]")) return;
      e.preventDefault();
      player.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const load = player?.load ?? { status: "idle" as const };
  const playing = player?.isPlaying ?? false;
  const loading = load.status === "loading";

  return (
    <div className="playbar">
      <button
        type="button"
        className="play"
        onClick={() => player?.toggle()}
        disabled={!player || loading}
        aria-label={playing ? "Pause" : "Play"}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          {playing ? (
            <g fill="currentColor">
              <rect x="4.5" y="3.5" width="3.6" height="13" />
              <rect x="11.9" y="3.5" width="3.6" height="13" />
            </g>
          ) : (
            <path d="M5.5 3.2v13.6L16.6 10z" fill="currentColor" />
          )}
        </svg>
      </button>

      <fieldset className="ab" aria-label="Which version plays">
        <legend className="sr-only">Which version plays</legend>
        {(
          [
            ["original", "A", "Original"],
            ["arranged", "B", coverLabel],
          ] as const
        ).map(([value, letter, label]) => (
          <label key={value} className={`ab-opt ${side === value ? "is-on" : ""}`}>
            <input type="radio" name="ab" value={value} checked={side === value} onChange={() => onSide(value)} />
            <span className="ab-letter">{letter}</span>
            <span className="ab-label">{label}</span>
          </label>
        ))}
      </fieldset>

      <div className="scrub">
        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={player?.duration ?? 0}
          step={0.01}
          defaultValue={0}
          aria-label="Playback position"
          disabled={!player}
          onPointerDown={() => (dragging.current = true)}
          onPointerUp={() => (dragging.current = false)}
          onChange={(e) => player?.seek(Number(e.currentTarget.value))}
        />
        <span className="time">
          <span ref={timeRef}>0:00</span> / {clock(player?.duration ?? 0)}
        </span>
      </div>

      <p className="playbar-status" aria-live="polite">
        {load.status === "loading" && `Loading instrument sounds, ${load.done} of ${load.total}…`}
        {load.status === "error" && `Sounds didn't load (${load.message}). Check the connection and press play again.`}
        {load.status === "idle" && "Switch A and B while it plays; it keeps your place."}
      </p>
    </div>
  );
}
