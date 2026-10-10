import { useLayoutEffect, useRef, useState } from "react";
import { withoutStaffLabels } from "./parts";
import { queueRender } from "./renderQueue";

interface Props {
  xml: string;
  /** Accessible name, e.g. "Flute part, written pitch". */
  label: string;
  /** false: only the first system shows (the preview); true: the whole part. */
  expanded: boolean;
  /** Reports whether the part has more than one system (so the card can offer "Show the whole part"). */
  onSystems?: (n: number) => void;
}

/** Staff size by sheet width: smaller on phones so a system still holds a few bars. */
function scaleFor(w: number): number {
  return w >= 520 ? 34 : w >= 420 ? 31 : 28;
}

/** One player's part engraved by Verovio at the card's width. */
export function PartSheet({ xml, label, expanded, onSystems }: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; pages: string[] }>({
    status: "loading",
  });
  const [firstSystem, setFirstSystem] = useState<number | null>(null);
  const onSystemsRef = useRef(onSystems);
  onSystemsRef.current = onSystems;

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    let t: number | undefined;
    const measure = () => {
      const w = Math.max(300, Math.floor(el.clientWidth));
      setWidth((prev) => (Math.abs(prev - w) > 24 ? w : prev));
    };
    measure();
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(measure, 150);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  useLayoutEffect(() => {
    if (!width) return;
    let live = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    const job = queueRender(withoutStaffLabels(xml), width, { scale: scaleFor(width), marginTop: 40, marginX: 30, timemap: false }, "high");
    job.promise
      .then((r) => live && setState({ status: "ready", pages: r.pages }))
      .catch((e: unknown) => {
        if (live) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
      job.cancel();
    };
  }, [xml, width]);

  // Measure where the first system ends, so the preview can stop there.
  useLayoutEffect(() => {
    const root = pagesRef.current;
    if (!root || state.status !== "ready") return;
    const systems = root.querySelectorAll<SVGGElement>("g.system");
    onSystemsRef.current?.(systems.length);
    const first = systems[0];
    if (!first) {
      setFirstSystem(null);
      return;
    }
    const top = root.getBoundingClientRect().top;
    const b = first.getBoundingClientRect();
    setFirstSystem(Math.ceil(b.bottom - top + 14));
  }, [state]);

  const clip = !expanded && firstSystem !== null;

  return (
    <div className="partsheet" ref={outerRef} role="img" aria-roledescription="music score" aria-label={label}>
      {state.status === "loading" && <p className="partsheet-status">Engraving…</p>}
      {state.status === "error" && <p className="partsheet-status">This part couldn't be drawn ({state.message}). The download still works.</p>}
      {state.status === "ready" && (
        <div
          className={`partsheet-pages ${clip ? "is-clipped" : ""}`}
          ref={pagesRef}
          style={clip ? { maxHeight: `${firstSystem}px` } : undefined}
        >
          {state.pages.map((svg, i) => (
            <div className="partsheet-page" key={i} dangerouslySetInnerHTML={{ __html: svg }} />
          ))}
        </div>
      )}
    </div>
  );
}
