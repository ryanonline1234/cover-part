import { useEffect, useRef, useState } from "react";
import { AskAI } from "./AskAI";
import { AsWritten, Situation } from "./AsWritten";
import { SECTIONS, section } from "./copy";
import { Evidence } from "./Evidence";
import { useIndex, useReducedMotion } from "./hooks";
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

/**
 * The why page (#/why). `bare` hides this page's own top bar, for when the router already
 * draws a shared header.
 */
export default function WhyPage({ bare = false }: { bare?: boolean }) {
  const index = useIndex();
  const [band, setBand] = useState("church_brass");
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const drafting = SECTIONS.every((s) => !s.text.trim());

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
    <div className="why" ref={rootRef}>
      {!bare && (
        <header className="why-top">
          <a className="why-wordmark" href="#/">
            Cover Part
          </a>
          <span className="why-top-k">Why it exists</span>
          <a className="why-top-cta" href="#/">
            Try it with your band <span aria-hidden="true">→</span>
          </a>
        </header>
      )}

      <main className="why-main">
        {drafting && (
          <p className="why-draft" role="note">
            Draft. The notes beside each demo are verified facts from the data; the author's text is still to be written.
          </p>
        )}
        <nav className="why-toc" aria-label="On this page">
          {TOC.map((t) => (
            <button key={t.id} type="button" onClick={() => go(t.id)}>
              <span className="why-toc-n">({t.n})</span> {section(t.id).heading}
            </button>
          ))}
        </nav>

        <Situation index={index} band={band} setBand={setBand} />
        <AsWritten index={index} band={band} setBand={setBand} />
        <SimpleRule index={index} />
        <AskAI />
        <StillWrong index={index} />
        <Evidence index={index} />

        <section className="why-close" id="why-close" aria-labelledby="why-close-h">
          <div className="why-apparatus" aria-hidden="true">
            <span className="why-app-n">§6</span>
            <span className="why-app-k">The tool</span>
          </div>
          <h2 className="why-close-h" id="why-close-h">
            <a href="#/">
              {section("close").heading} <span aria-hidden="true">→</span>
            </a>
          </h2>
          {section("close").text.trim() && <p className="why-text">{section("close").text}</p>}
        </section>
      </main>
    </div>
  );
}
