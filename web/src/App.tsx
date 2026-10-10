import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import ToolPage from "./tool/ToolPage";

// The why page is its own chunk; it loads the first time someone opens it.
const WhyPage = lazy(() => import("./why/WhyPage"));

/**
 * Hash routes:
 *   #/                                        the tool (default piece and preset band)
 *   #/?piece=<id>&band=<preset id | custom>&planner=ai|greedy
 *   #/why  (and anything under #/why/…)       the why page
 * Custom band: comma-separated instrument:level[:name], level b|i|a, e.g. flute:i,trumpet:b:Sam.
 * Old links (#piece=…&roster=…&planner=…, #scoreboard) still land somewhere sensible.
 */
type Route = { page: "tool"; query: string } | { page: "why" };

function parseHash(raw: string): Route {
  const h = raw.replace(/^#/, "");
  if (h === "/why" || h.startsWith("/why/") || h.startsWith("/why?") || h === "scoreboard") return { page: "why" };
  if (h.startsWith("/")) {
    const q = h.indexOf("?");
    return { page: "tool", query: q >= 0 ? h.slice(q + 1) : "" };
  }
  // Legacy: "#piece=…&roster=…&planner=…" from the first version of the site.
  const old = new URLSearchParams(h);
  const q = new URLSearchParams();
  if (old.get("piece")) q.set("piece", old.get("piece")!);
  if (old.get("roster")) q.set("band", old.get("roster")!);
  if (old.get("planner")) q.set("planner", old.get("planner")!);
  return { page: "tool", query: q.toString() };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  // The tool's last query and a counter that bumps on every hashchange to a tool URL (the same
  // query can arrive twice, e.g. a link followed after edits), so the tool re-applies it.
  const [tool, setTool] = useState(() => ({ query: route.page === "tool" ? route.query : "", nav: 0 }));
  const [toolHash, setToolHash] = useState("#/");
  // The tool mounts the first time it's shown, then stays mounted (hidden) so the band and parts survive a visit to Why.
  const [toolSeen, setToolSeen] = useState(route.page === "tool");
  const page = useRef(route.page);

  useEffect(() => {
    const onHash = () => {
      const r = parseHash(window.location.hash);
      setRoute(r);
      if (r.page === "tool") {
        setTool((t) => ({ query: r.query, nav: t.nav + 1 }));
        setToolSeen(true);
      }
      if (r.page !== page.current) window.scrollTo({ top: 0, behavior: "auto" });
      page.current = r.page;
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title = route.page === "why" ? "Why Cover Part" : "Cover Part: arrange a piece for the players you have";
  }, [route.page]);

  const onToolHash = useCallback((h: string) => setToolHash(h), []);
  const isTool = route.page === "tool";

  return (
    <div className={`app app--${route.page}`}>
      <header className="site-header">
        <a className="wordmark" href={toolHash}>
          Cover Part
        </a>
        <p className="site-tagline">Parts for the players you actually have.</p>
        <nav className="site-nav" aria-label="Pages">
          <a href={toolHash} aria-current={isTool ? "page" : undefined}>
            Arrange
          </a>
          <a href="#/why" aria-current={!isTool ? "page" : undefined}>
            Why
          </a>
        </nav>
      </header>

      {toolSeen && (
        <div hidden={!isTool}>
          <ErrorBoundary what="the arranging tool" resetKey={`tool-${tool.nav}`}>
            <ToolPage query={tool.query} nav={tool.nav} active={isTool} onHash={onToolHash} />
          </ErrorBoundary>
        </div>
      )}
      {!isTool && (
        <ErrorBoundary what="the why page" resetKey="why">
          <Suspense fallback={<p className="tool-opening">Opening…</p>}>
            {/* Links back to the tool keep the reader's piece and band. */}
            <WhyPage bare toolHref={toolHash} />
          </Suspense>
        </ErrorBoundary>
      )}

      <footer className="colophon">
        <p>
          Built for EvoHacks 2026. Scores engraved in the browser with Verovio; playback uses the FluidR3_GM General MIDI soundfont
          (CC BY 3.0, via gleitz/midi-js-soundfonts). Source excerpts are public domain (CC0, OpenScore String Quartets).
        </p>
      </footer>
    </div>
  );
}
