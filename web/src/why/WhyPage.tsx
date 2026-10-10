import { useEffect, useRef, useState } from "react";
import { AskAI } from "./AskAI";
import { AsWritten, Situation } from "./AsWritten";
import { section } from "./copy";
import { Evidence } from "./Evidence";
import { useIndex, useReducedMotion } from "./hooks";
import { Prose } from "./Prose";
import { SimpleRule } from "./SimpleRule";
import { StillWrong } from "./StillWrong";
import "./why.css";

const TOC: Array<{ id: string; n: string }> = [
  { id: "as-written", n: "1" },
  { id: "simple-rule", n: "2" },
  { id: "ask-an-ai", n: "3" },
  { id: "still-wrong", n: "4" },
  { id: "evidence", n: "5" },
];

/** "Show sources" starts on when the why URL carries sources=1 (e.g. #/why?sources=1). */
function sourcesFromUrl(): boolean {
  try {
    return /[?&]sources=1(?:&|$)/.test(window.location.hash);
  } catch {
    return false;
  }
}

/**
 * The why page (#/why). `bare` hides this page's own top bar, for when the router already
 * draws a shared header. `toolHref` is where every link back to the tool goes: pass the tool's
 * current hash so the reader's piece and band survive the round trip (default "#/").
 */
export default function WhyPage({ bare = false, toolHref = "#/" }: { bare?: boolean; toolHref?: string }) {
  const index = useIndex();
  const [band, setBand] = useState("church_brass");
  const [sources, setSources] = useState(sourcesFromUrl);
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  // Section entrances: a class per section when it first nears the viewport (CSS does the motion).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduced || typeof IntersectionObserver === "undefined") return;
    root.classList.add("why--motion");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    root.querySelectorAll(".why-sec").forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove("why--motion");
    };
  }, [reduced]);

  const go = (id: string) => {
    document.getElementById(`why-${id}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className={`why${sources ? " why--sources" : ""}`} ref={rootRef}>
      {!bare && (
        <header className="why-top">
          <a className="why-wordmark" href={toolHref}>
            Cover Part
          </a>
          <span className="why-top-k">Why it exists</span>
          <a className="why-top-cta" href={toolHref}>
            Try it with your band <span aria-hidden="true">→</span>
          </a>
        </header>
      )}

      <main className="why-main">
        <div className="why-toc-row">
          <nav className="why-toc" aria-label="On this page">
            {TOC.map((t) => (
              <button key={t.id} type="button" onClick={() => go(t.id)}>
                <span className="why-toc-n">({t.n})</span> {section(t.id).heading}
              </button>
            ))}
          </nav>
          <label className="why-src-toggle">
            <input type="checkbox" checked={sources} onChange={(e) => setSources(e.target.checked)} data-toggle="sources" />
            <span>Show sources</span>
          </label>
        </div>

        <Situation index={index} band={band} setBand={setBand} />
        <AsWritten index={index} band={band} setBand={setBand} />
        <SimpleRule index={index} />
        <AskAI index={index} />
        <StillWrong index={index} />
        <Evidence index={index} />

        <section className="why-close" id="why-close" aria-labelledby="why-close-h">
          <div className="why-apparatus" aria-hidden="true">
            <span className="why-app-n">§6</span>
            <span className="why-app-k">The tool</span>
          </div>
          <h2 className="why-close-h" id="why-close-h">
            <a href={toolHref} data-link="tool">
              {section("close").heading} <span aria-hidden="true">→</span>
            </a>
          </h2>
          <div className="why-close-text">
            <Prose section={section("close")} values={{ n_bands: index?.rosters.length }} />
          </div>
        </section>
      </main>
    </div>
  );
}
