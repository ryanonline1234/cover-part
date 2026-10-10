import { useEffect, useRef, type CSSProperties } from "react";
import type { ABPlayer } from "./audio";
import { mm, octaveNote, onColor, playerById, steadyRole } from "./music";
import type { ArrangeResult, CoverageSegment } from "./types";

interface Props {
  result: ArrangeResult;
  player: ABPlayer | null;
}

function segmentsFor(result: ArrangeResult, sourcePart: string): CoverageSegment[] {
  const cov = result.coverage.find((c) => c.source_part === sourcePart);
  if (cov && cov.segments.length) return mergeAdjacent(cov.segments);
  // Fallback: derive from the plan if coverage is missing.
  const segs: CoverageSegment[] = result.plan.assignments
    .filter((a) => a.source_part === sourcePart)
    .map((a) => ({ start_measure: a.start_measure, end_measure: a.end_measure, role: "", covered_by: [a.player], dropped: false }));
  for (const d of result.plan.dropped.filter((x) => x.source_part === sourcePart)) {
    segs.push({ start_measure: d.start_measure, end_measure: d.end_measure, role: "", covered_by: [], dropped: true });
  }
  return segs.sort((a, b) => a.start_measure - b.start_measure);
}

/** The engine reports coverage per phrase; draw consecutive phrases with the same players as one bar. */
function mergeAdjacent(segs: CoverageSegment[]): CoverageSegment[] {
  const out: CoverageSegment[] = [];
  for (const seg of [...segs].sort((a, b) => a.start_measure - b.start_measure)) {
    const prev = out[out.length - 1];
    const key = (x: CoverageSegment) => `${x.dropped || x.covered_by.length === 0}|${[...x.covered_by].sort().join(",")}`;
    if (prev && key(prev) === key(seg) && seg.start_measure <= prev.end_measure + 1) {
      prev.end_measure = Math.max(prev.end_measure, seg.end_measure);
    } else out.push({ ...seg, covered_by: [...seg.covered_by] });
  }
  return out;
}

function rulerStep(n: number): number {
  if (n <= 24) return 1;
  if (n <= 48) return 4;
  return 8;
}

export function LineMap({ result, player }: Props) {
  const [m0, m1] = result.piece.measures;
  const n = Math.max(1, m1 - m0 + 1);
  const players = playerById(result);
  const step = rulerStep(n);
  const rootRef = useRef<HTMLDivElement>(null);

  // Playhead: one CSS variable on the root, drawn by every row's ::after, no React re-render.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !player) return;
    let raf = 0;
    const loop = () => {
      const pos = player.measurePosition;
      const visible = player.isPlaying || player.position > 0;
      root.style.setProperty("--ph-o", visible ? "1" : "0");
      root.style.setProperty("--ph", `${Math.min(100, Math.max(0, (pos / n) * 100))}%`);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      root.style.setProperty("--ph-o", "0");
    };
  }, [player, n]);

  const seekTo = (measure: number) => {
    if (!player) return;
    const track = player.tracks[player.side];
    player.seek(track.timeAtMeasure(measure - m0));
  };

  const col = (a: number, b: number): CSSProperties => ({
    gridColumn: `${Math.max(1, a - m0 + 1)} / ${Math.min(n, b - m0 + 1) + 1}`,
  });

  return (
    <div className="linemap" ref={rootRef} style={{ "--measures": n } as CSSProperties}>
      <div className="lm-grid">
        <div className="lm-corner" aria-hidden="true" />
        <div className="lm-ruler" aria-hidden="true">
          {Array.from({ length: n }, (_, i) => m0 + i).map((m) =>
            (m - m0) % step === 0 ? (
              <button
                type="button"
                className="lm-mnum"
                data-major={n <= 8 || (m - m0) % 4 === 0 ? "" : undefined}
                key={m}
                style={col(m, m)}
                onClick={() => seekTo(m)}
                tabIndex={-1}
                title={`Play from m. ${m}`}
              >
                {m}
              </button>
            ) : null,
          )}
        </div>

        {result.source_parts.map((sp) => {
          const role = steadyRole(result, sp.id);
          return (
            <div className="lm-row" key={sp.id} style={{ "--line": sp.color, "--on-line": onColor(sp.color) } as CSSProperties}>
              <div className="lm-name">
                <span className="lm-part">{sp.name}</span>
                {role && <span className="lm-role">{role}</span>}
              </div>
              <div className="lm-track">
                {segmentsFor(result, sp.id).map((seg) => {
                  const where = mm(seg.start_measure, seg.end_measure);
                  if (seg.dropped || seg.covered_by.length === 0) {
                    return (
                      <button
                        type="button"
                        key={`${seg.start_measure}-d`}
                        className="lm-gap"
                        style={col(seg.start_measure, seg.end_measure)}
                        onClick={() => seekTo(seg.start_measure)}
                        title={`${sp.name}, ${where}: left out`}
                      >
                        <span>left out</span>
                      </button>
                    );
                  }
                  const names = seg.covered_by.map((id) => players.get(id)?.label ?? id).join(" + ");
                  return (
                    <button
                      type="button"
                      key={`${seg.start_measure}-${seg.covered_by.join(".")}`}
                      className="lm-seg"
                      style={col(seg.start_measure, seg.end_measure)}
                      onClick={() => seekTo(seg.start_measure)}
                      title={`${sp.name}, ${where}: ${names}. Click to play from here.`}
                    >
                      <span>{names}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <ul className="routes">
        {result.source_parts.map((sp) => {
          const role = steadyRole(result, sp.id);
          const asg = result.plan.assignments
            .filter((a) => a.source_part === sp.id)
            .sort((a, b) => a.start_measure - b.start_measure);
          const drops = result.plan.dropped
            .filter((d) => d.source_part === sp.id)
            .sort((a, b) => a.start_measure - b.start_measure);
          return (
            <li key={sp.id} style={{ "--line": sp.color } as CSSProperties}>
              <p className="route">
                <span className="route-line">
                  {sp.name}
                  {role ? ` ${role}` : ""}
                </span>{" "}
                <span className="route-arrow" aria-label="goes to">
                  →
                </span>{" "}
                {asg.length === 0
                  ? "not played"
                  : asg.map((a, i) => {
                      const shift = octaveNote(a.octave_shift);
                      return (
                        <span key={i}>
                          {i > 0 && ", "}
                          <span className="route-player">{players.get(a.player)?.label ?? a.player}</span>
                          {shift && ` ${shift}`} <span className="mnums">({mm(a.start_measure, a.end_measure)})</span>
                        </span>
                      );
                    })}
              </p>
              {drops.map((d, i) => (
                <p className="route-drop" key={i}>
                  <span className="route-drop-where">Left out, {mm(d.start_measure, d.end_measure)}.</span> {d.reason}
                </p>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
