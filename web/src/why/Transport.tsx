import type { ABPlayer } from "../audio";
import { claimAudio, usePlayerState } from "./hooks";

/** Play/pause for one demo's player. Audio starts only from this click. */
export function PlayButton({
  player,
  label,
  fromMeasure,
  id,
}: {
  player: ABPlayer | null;
  label: string;
  /** Measure offset from the excerpt's first bar to start from (when not resuming). */
  fromMeasure?: number;
  id?: string;
}) {
  const { playing, loading, error } = usePlayerState(player);
  const state = !player ? "unavailable" : error ? "error" : playing ? "playing" : loading ? "loading" : "paused";
  const onClick = () => {
    if (!player) return;
    if (player.isPlaying) {
      player.pause();
      return;
    }
    claimAudio(player);
    if (fromMeasure !== undefined) player.seek(player.tracks[player.side].timeAtMeasure(fromMeasure));
    void player.play();
  };
  return (
    <span className="why-play-wrap">
      <button
        type="button"
        className="why-play"
        onClick={onClick}
        disabled={!player}
        aria-pressed={playing}
        data-state={state}
        data-play={id}
      >
        <span className="why-play-icon" aria-hidden="true" />
        <span>{playing ? "Pause" : loading ? "Loading sounds…" : label}</span>
      </button>
      {error && <span className="why-play-err">Audio couldn't load: {error}</span>}
    </span>
  );
}

/** Two-option segmented switch (e.g. As written | Cover Part's version). */
export function Switch<T extends string>({
  options,
  value,
  onChange,
  label,
  id,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
  id?: string;
}) {
  return (
    <div className="why-switch" role="radiogroup" aria-label={label} data-switch={id}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "is-on" : ""}
          onClick={() => onChange(o.value)}
          data-value={o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Band picker over the preset rosters. */
export function BandPicker({
  bands,
  value,
  onChange,
  id,
}: {
  bands: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  return (
    <div className="why-bands" role="radiogroup" aria-label="Band" data-bands={id}>
      {bands.map((b) => (
        <button
          key={b.id}
          type="button"
          role="radio"
          aria-checked={value === b.id}
          className={value === b.id ? "is-on" : ""}
          onClick={() => onChange(b.id)}
          data-band={b.id}
        >
          {shortBand(b.label)}
        </button>
      ))}
    </div>
  );
}

/** "Church brass: 2 trumpets (one beginner), horn, euphonium" -> "Church brass". */
export function shortBand(label: string): string {
  return label.split(":")[0];
}
