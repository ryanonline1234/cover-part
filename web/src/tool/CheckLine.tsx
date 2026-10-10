import { useEffect, useId, useRef, useState } from "react";
import { pct } from "../music";
import type { ArrangeResult } from "../types";

interface Chip {
  key: string;
  label: string;
  value: string;
  sub?: string;
  def: string;
  /** true when the number is the ideal one (0 left out, 100%, ...): drawn with a solid mark. */
  clean: boolean;
}

function chipsFor(r: ArrangeResult): Chip[] {
  const c = r.checks;
  const folds = c.final?.folded ?? c.notes_folded;
  const melody = c.essential_coverage.melody;
  const bass = c.essential_coverage.bass;
  const left = c.measures_dropped;
  return [
    {
      key: "playable",
      label: "Playable",
      value: `${c.notes_out_of_range} out of range`,
      sub: `of ${c.notes_total} notes · ${folds} single-note ${folds === 1 ? "fold" : "folds"}`,
      def: "Notes outside a player's range for their level, after repair, of every note checked. A fold is a single note moved an octave so it fits.",
      clean: c.notes_out_of_range === 0,
    },
    {
      key: "melody",
      label: "Melody kept",
      value: melody === null ? "no map" : pct(melody),
      def: "Share of the reference melody's bars, mapped from the notes before any plan existed, that some player plays.",
      clean: melody === 1,
    },
    {
      key: "bass",
      label: "Bass at the bottom",
      value: pct(bass),
      def: "Share of the time the band's lowest note is the same pitch, in any octave, as the original's lowest note.",
      clean: bass === 1,
    },
    {
      key: "left",
      label: "Bars left out",
      value: left === undefined || left === null ? "n/a" : String(left),
      def: "Bars where a line of the original has notes but no player plays it.",
      clean: left === 0,
    },
  ];
}

/** Four numbers a director checks first, each with its definition on hover, focus or tap. */
export function CheckLine({ result }: { result: ArrangeResult }) {
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
      {chipsFor(result).map((c) => {
        const defId = `${base}-${c.key}`;
        return (
          <li key={c.key} className={`check ${c.clean ? "is-clean" : ""} ${open === c.key ? "is-open" : ""}`}>
            <button
              type="button"
              className="check-btn"
              aria-describedby={defId}
              aria-expanded={open === c.key}
              onClick={() => setOpen((o) => (o === c.key ? null : c.key))}
            >
              <span className="check-label">{c.label}</span>
              <span className="check-value">{c.value}</span>
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
