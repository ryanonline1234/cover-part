import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Section } from "./copy";

export type Values = Record<string, string | number | null | undefined>;

/** Fill {{token}}s. Missing values render as an ellipsis (still loading, or the data isn't there). */
function fill(s: string, values: Values): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\{\{(\w+)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const v = values[m[1]];
    out.push(
      v === null || v === undefined || v === "" ? (
        <span key={i++} className="why-pending" title={`waiting for data: ${m[1]}`}>
          …
        </span>
      ) : (
        <span key={i++} className="why-val" data-token={m[1]}>
          {String(v)}
        </span>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function fillPlain(s: string, values: Values): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = values[k];
    return v === null || v === undefined || v === "" ? "…" : String(v);
  });
}

/** "Fact text. [source: file → field[].x]" -> ["Fact text.", "file → field[].x"] (the last "[source:" wins). */
function splitSource(fact: string): [string, string | null] {
  const t = fact.trimEnd();
  const i = t.lastIndexOf("[source:");
  if (i < 0 || !t.endsWith("]")) return [fact, null];
  return [t.slice(0, i).trimEnd(), t.slice(i + "[source:".length, -1).trim()];
}

/** Ryan's text when written; until then the verified facts as numbered margin notes. */
export function Prose({ section, values }: { section: Section; values: Values }) {
  if (section.text.trim()) {
    return (
      <div className="why-text">
        {section.text
          .split(/\n\s*\n/)
          .filter((p) => p.trim())
          .map((p, i) => (
            <p key={i}>{fill(p.trim(), values)}</p>
          ))}
      </div>
    );
  }
  if (!section.facts.length) return null;
  return (
    <aside className="why-notes" aria-label="Notes: verified facts for this section">
      <p className="why-notes-label">
        <span>Notes</span>
        <span className="why-notes-hint">verified facts · author's text to come</span>
      </p>
      <ol>
        {section.facts.map((f, i) => {
          const [body, source] = splitSource(f);
          return (
            <li key={i} data-fact={`${section.id}-${i + 1}`}>
              <span className="why-note-n" aria-hidden="true">
                ({i + 1})
              </span>
              <span className="why-note-body">{fill(body, values)}</span>
              {source && <span className="why-note-src">{fillPlain(source, values)}</span>}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/**
 * One idea per section: a ruled apparatus row, then the prose column beside the demo.
 * The prose column sticks while the demo scrolls past, but only when it fits the viewport
 * (a long text would otherwise be cut off under the fold).
 */
export function SectionShell({
  id,
  index,
  kicker,
  source,
  section,
  values,
  children,
  wide = false,
  hero = false,
}: {
  id: string;
  index: string;
  kicker: string;
  source?: string;
  section: Section;
  values: Values;
  children: ReactNode;
  /** Demo spans the full width under the prose instead of beside it. */
  wide?: boolean;
  /** Page opener: the heading is the page's h1, set full width above the grid. */
  hero?: boolean;
}) {
  const proseRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = proseRef.current;
    if (!el) return;
    const check = () => setFits(el.offsetHeight < window.innerHeight - 48);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <section
      className={`why-sec${wide ? " why-sec--wide" : ""}${hero ? " why-sec--hero" : ""}`}
      id={`why-${id}`}
      data-section={id}
      aria-labelledby={`why-${id}-h`}
    >
      <div className="why-apparatus" aria-hidden="true">
        <span className="why-app-n">{index}</span>
        <span className="why-app-k">{kicker}</span>
        {source && <span className="why-app-src">{source}</span>}
      </div>
      {hero && (
        <h1 className="why-h why-h--hero" id={`why-${id}-h`}>
          {section.heading}
        </h1>
      )}
      <div className="why-sec-grid">
        <div className={`why-prose${fits ? " is-sticky" : ""}`} ref={proseRef}>
          {!hero && (
            <h2 className="why-h" id={`why-${id}-h`}>
              {section.heading}
            </h2>
          )}
          <Prose section={section} values={values} />
        </div>
        <div className="why-demo">{children}</div>
      </div>
    </section>
  );
}
