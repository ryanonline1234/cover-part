import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ABPlayer } from "./audio";
import { getToolkit, renderScore, type Rendered } from "./verovio";

interface Props {
  xml: string;
  label: string;
  /** Color each staff's notes by source line (used for the original, which arrives uncolored). */
  staffColors?: string[];
  player: ABPlayer | null;
  /** Only the score matching the player's side follows playback. */
  follow: boolean;
}

const MIN_RENDER_WIDTH = 560; // below this the score scrolls sideways instead of shrinking

export function ScoreView({ xml, label, staffColors, player, follow }: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | ({ status: "ready" } & Rendered)>({
    status: "loading",
  });

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    let t: number | undefined;
    const measure = () => {
      const w = Math.max(MIN_RENDER_WIDTH, Math.floor(el.clientWidth) - 4); // sheet border + rounding
      setWidth((prev) => (Math.abs(prev - w) > 24 ? w : prev));
    };
    measure();
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(measure, 120);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    getToolkit()
      .then((tk) => {
        if (cancelled) return;
        const r = renderScore(tk, xml, width);
        setState({ status: "ready", ...r });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [xml, width]);

  // Color the original's staves by source line, so a line's color is continuous from original to cover.
  useEffect(() => {
    const root = pagesRef.current;
    if (!root || state.status !== "ready" || !staffColors?.length) return;
    for (const measure of root.querySelectorAll<SVGGElement>("g.measure")) {
      const staves = [...measure.children].filter((c) => c.classList.contains("staff"));
      if (staves.length !== staffColors.length) continue;
      staves.forEach((staff, i) => {
        for (const layer of staff.querySelectorAll<SVGGElement>(":scope > g.layer")) {
          layer.setAttribute("fill", staffColors[i]);
          layer.setAttribute("color", staffColors[i]);
          layer.style.fill = staffColors[i];
          layer.style.color = staffColors[i];
        }
      });
    }
  }, [state, staffColors]);

  // Follow playback: a cursor band over the current system at the latest note onset.
  useEffect(() => {
    const root = pagesRef.current;
    const cursor = cursorRef.current;
    const outer = outerRef.current;
    if (!root || !cursor || !outer || !player || !follow || state.status !== "ready" || !state.timemap.length) return;
    const tm = state.timemap;
    let raf = 0;
    let lastIdx = -2;
    const place = (idx: number) => {
      if (idx < 0) {
        cursor.style.opacity = "0";
        return;
      }
      let el: Element | null = null;
      for (const id of tm[idx].on) {
        el = root.querySelector(`[id="${CSS.escape(id)}"]`);
        if (el) break;
      }
      if (!el) return;
      cursor.dataset.note = el.id; // which note the cursor marks (used by headless checks)
      const head = el.querySelector(".notehead") ?? el;
      const sys = el.closest("g.system") ?? el.closest("svg");
      if (!sys) return;
      const base = root.getBoundingClientRect();
      const r = head.getBoundingClientRect();
      const s = sys.getBoundingClientRect();
      const x = r.left + r.width / 2 - base.left;
      cursor.style.transform = `translate(${x}px, ${s.top - base.top - 8}px)`;
      cursor.style.height = `${s.height + 16}px`;
      cursor.style.opacity = "1";
      // On narrow screens the score scrolls sideways; keep the cursor in view.
      if (outer.scrollWidth > outer.clientWidth) {
        const vx = x - outer.scrollLeft;
        if (vx < 40 || vx > outer.clientWidth - 40) outer.scrollLeft = Math.max(0, x - 60);
      }
    };
    const loop = () => {
      let idx = -1;
      if (player.isPlaying || player.position > 0) {
        const q = player.quarterPosition;
        let lo = 0;
        let hi = tm.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (tm[mid].qstamp <= q + 1e-6) {
            idx = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
      }
      if (idx !== lastIdx) {
        place(idx);
        lastIdx = idx;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      cursor.style.opacity = "0";
    };
  }, [player, follow, state]);

  return (
    <div className="score" ref={outerRef} aria-label={label} role="img" aria-roledescription="music score">
      {state.status === "loading" && <p className="score-status">Engraving the score…</p>}
      {state.status === "error" && (
        <p className="score-status score-status--error">
          The score couldn't be drawn: {state.message} The parts below still download.
        </p>
      )}
      {state.status === "ready" && (
        <div className="score-pages" ref={pagesRef}>
          {state.pages.map((svg, i) => (
            <div className="sheet" key={i} dangerouslySetInnerHTML={{ __html: svg }} />
          ))}
          <div className="score-cursor" ref={cursorRef} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
