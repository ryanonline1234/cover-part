import { useEffect, useId, useRef, useState } from "react";
import { pct } from "../music";
import type { ArrangeResult } from "../types";
import { BASS_WARN, MELODY_WARN, SITTING_OUT, activityText, leftOutSpans, sittingOut, underBass } from "./signals";

interface Chip {
  key: string;
  label: string;
  value: string;
  sub?: string;
  def: string;
  /** true when the number is the ideal one (0 left out, 100%, ...): drawn with a solid mark. */
  clean: boolean;
  /** true when the number is bad enough to look at (thresholds in signals.ts): drawn as a warning. */
  warn: boolean;
}

function chipsFor(r: ArrangeResult, names?: Map<string, string>): Chip[] {
  const c = r.checks;
  const folds = c.final?.folded ?? c.notes_folded;
  const melody = c.essential_coverage.melody;
  const bass = c.essential_coverage.bass;
  const under = underBass(r);
  const left = c.measures_dropped;
  const spans = leftOutSpans(r);
  const shownSpans = spans.slice(0, 3).map((s) => `${s.line} ${s.where}`);
  if (spans.length > 3) shownSpans.push(`${spans.length - 3} more ${spans.length - 3 === 1 ? "line" : "lines"}`);
  const idle = sittingOut(r, names);
  return [
    {
      key: "playable",
      label: "Playable",
      value: `${c.notes_out_of_range} out of range`,
      sub: `of ${c.notes_total} notes · ${folds} single-note ${folds === 1 ? "fold" : "folds"}`,
      def: "Notes outside a player's range for their level, after repair, of every note checked. A fold is a single note moved an octave so it fits.",
      clean: c.notes_out_of_range === 0,
      warn: c.notes_out_of_range > 0,
    },
    {
      key: "melody",
      label: "Melody kept",
      value: melody === null ? "not measured" : pct(melody),
      sub: melody === null ? "no reference melody for this music" : undefined,
      def:
        melody === null
          ? "Measured only where a reference melody map exists (the library excerpts, mapped from the notes before any plan existed). This music has none, so it isn't measured; the rule-based plan treats the highest line as the melody."
          : `Share of the reference melody's bars, mapped from the notes before any plan existed, that some player plays. Flagged below ${pct(MELODY_WARN)}.`,
      clean: melody === 1,
      warn: melody !== null && melody < MELODY_WARN,
    },
    {
      key: "bass",
      label: "Bass at the bottom",
      value: pct(bass),
      sub: under === null ? undefined : `${under} ${under === 1 ? "note" : "notes"} under the bass`,
      def: `Share of the time the band's lowest note is the same pitch, in any octave, as the original's lowest note. Below it: notes another player sounds under the line that carries the bass. Flagged below ${pct(BASS_WARN)}, or when any note sounds under the bass.`,
      clean: bass === 1 && !under,
      warn: (bass !== null && bass < BASS_WARN) || (under ?? 0) > 0,
    },
    {
      key: "left",
      label: "Line-bars left out",
      value: left === undefined || left === null ? "n/a" : String(left),
      sub: left ? shownSpans.join(" · ") : undefined,
      def: "Each line of the original is counted on its own: bars where that line has notes but no player plays it, added up across the lines. Two lines missing in the same bar count twice.",
      clean: left === 0,
      warn: false,
    },
    {
      key: "sitting",
      label: "Sitting out",
      value: idle.length === 0 ? "nobody" : `${idle.length} ${idle.length === 1 ? "player" : "players"}`,
      sub: idle.length ? idle.map(activityText).join(" · ") : undefined,
      def: `Players who have a line to play in fewer than ${pct(SITTING_OUT)} of the excerpt's bars. More players than the piece has lines leaves someone with little or nothing to play.`,
      clean: idle.length === 0,
      warn: idle.length > 0,
    },
  ];
}

/** The numbers a director checks first, each with its definition on hover, focus or tap. */
export function CheckLine({ result, names }: { result: ArrangeResult; names?: Map<string, string> }) {
  const [open, setOpen] = useState<string | null>(null);
  const base = useId();
  const rootRef = useRef<HTMLUListElement>(null);

  // A tap elsewhere (or Escape) closes an open definition.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <ul className="checkline" ref={rootRef} aria-label="What the checker measured">
      {chipsFor(result, names).map((c) => {
        const defId = `${base}-${c.key}`;
        return (
          <li key={c.key} className={`check check--${c.key} ${c.clean ? "is-clean" : ""} ${c.warn ? "is-warn" : ""} ${open === c.key ? "is-open" : ""}`}>
            <button
              type="button"
              className="check-btn"
              aria-describedby={defId}
              aria-expanded={open === c.key}
              onClick={() => setOpen((o) => (o === c.key ? null : c.key))}
            >
              <span className="check-label">{c.label}</span>
              <span className="check-value">
                {c.warn && <span className="sr-only">Check this: </span>}
                {c.value}
              </span>
              {c.sub && <span className="check-sub">{c.sub}</span>}
            </button>
            <span className="check-def" id={defId} role="tooltip">
              {c.def}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
