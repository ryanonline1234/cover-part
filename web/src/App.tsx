import { useEffect, useRef, useState } from "react";
import { ABPlayer, type Side } from "./audio";
import { Checks } from "./Checks";
import { LIVE_MODE, loadComparison, loadIndex, loadResult } from "./data";
import { LineMap } from "./LineMap";
import { PLANNER_LABEL, barMap, mm } from "./music";
import { Plan } from "./Plan";
import { PlayerBar } from "./PlayerBar";
import { RosterEditor } from "./RosterEditor";
import { Scoreboard } from "./Scoreboard";
import { ScoreView } from "./Score";
import type { ArrangeResult, Comparison, DemoIndex, IndexPiece, Planner } from "./types";

interface Sel {
  piece: string;
  roster: string;
  planner: Planner;
}

function readHash(): Partial<Sel> {
  const h = new URLSearchParams(window.location.hash.slice(1));
  const planner = h.get("planner");
  return {
    piece: h.get("piece") ?? undefined,
    roster: h.get("roster") ?? undefined,
    planner: planner === "ai" || planner === "greedy" ? planner : undefined,
  };
}

function writeHash(sel: Sel) {
  const h = new URLSearchParams({ piece: sel.piece, roster: sel.roster, planner: sel.planner });
  window.history.replaceState(null, "", `#${h.toString()}`);
}

/** Snap a (possibly partial) selection to a combination that has a precomputed result. */
function normalize(index: DemoIndex, want: Partial<Sel>): Sel | null {
  const piece = index.pieces.find((p) => p.id === want.piece) ?? index.pieces[0];
  if (!piece) return null;
  const rosters = [...new Set(piece.results.map((r) => r.roster_id))];
  const roster = want.roster && rosters.includes(want.roster) ? want.roster : rosters[0];
  if (!roster) return null;
  const planners = piece.results.filter((r) => r.roster_id === roster).map((r) => r.planner);
  const planner = want.planner && planners.includes(want.planner) ? want.planner : planners.includes("ai") ? "ai" : planners[0];
  return { piece: piece.id, roster, planner };
}

/** "String Quartet in C major, Hob.III:77, Op.76 No.3" -> ["String Quartet in C major", "Hob.III:77, Op.76 No.3"]. */
function splitTitle(title: string): [string, string | null] {
  const i = title.indexOf(", ");
  return i > 0 ? [title.slice(0, i), title.slice(i + 2)] : [title, null];
}

function pieceLabel(p: IndexPiece): string {
  const surname = p.composer.replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(-1)[0];
  const mv = p.movement ? ` ${p.movement.split(/[.\s]/)[0]}` : "";
  const bars = p.measures ? `, ${mm(p.measures[0], p.measures[1])}` : "";
  return `${surname}: ${p.title}${mv}${bars}`;
}

function useResult(id: string | undefined) {
  const [state, setState] = useState<{ id?: string; result: ArrangeResult | null; error: string | null }>({
    result: null,
    error: null,
  });
  useEffect(() => {
    if (!id) {
      setState({ result: null, error: null });
      return;
    }
    let cancelled = false;
    loadResult(id)
      .then((result) => !cancelled && setState({ id, result, error: null }))
      .catch((e: unknown) => !cancelled && setState({ id, result: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [id]);
  return { ...state, loading: !!id && state.id !== id };
}

export default function App() {
  const [index, setIndex] = useState<DemoIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [side, setSide] = useState<Side>("arranged");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  /** A result re-scored live for a custom roster (?live=1); shown instead of the precomputed one. */
  const [live, setLive] = useState<{ result: ArrangeResult; seconds: number } | null>(null);

  useEffect(() => {
    void loadComparison().then(setComparison);
    loadIndex()
      .then((ix) => {
        setIndex(ix);
        setSel(normalize(ix, readHash()));
      })
      .catch((e: unknown) => setIndexError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (sel) writeHash(sel);
  }, [sel]);

  const piece = index?.pieces.find((p) => p.id === sel?.piece) ?? null;
  const ref = piece?.results.find((r) => r.roster_id === sel?.roster && r.planner === sel?.planner);
  const otherRef = piece?.results.find((r) => r.roster_id === sel?.roster && r.planner !== sel?.planner);
  const current = useResult(ref?.result_id);
  const otherLoaded = useResult(otherRef?.result_id);
  const result = live?.result ?? current.result;
  const otherResult = live ? null : otherLoaded.result;

  // New player per result, created in an effect so StrictMode's double-mount disposes the
  // throwaway instance, not the live one. It starts on whichever side is showing.
  const sideRef = useRef(side);
  sideRef.current = side;
  const [player, setPlayer] = useState<ABPlayer | null>(null);
  useEffect(() => {
    if (!result) {
      setPlayer(null);
      return;
    }
    const p = new ABPlayer(result.midi, sideRef.current, barMap(result.musicxml.original));
    setPlayer(p);
    return () => p.dispose();
  }, [result]);

  // Dev-only handle for headless playback checks; stripped from production builds.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __coverPartPlayer?: ABPlayer | null }).__coverPartPlayer = player;
  }, [player]);

  const changeSide = (s: Side) => {
    setSide(s);
    player?.setSide(s);
  };

  const update = (patch: Partial<Sel>) => {
    if (!index || !sel) return;
    setLive(null);
    setSel(normalize(index, { ...sel, ...patch }));
  };

  const pickPair = (pieceId: string, rosterId: string) => {
    if (!index) return;
    setLive(null);
    setSel(normalize(index, { piece: pieceId, roster: rosterId, planner: "ai" }));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  // Rosters from index.rosters, plus any roster a result names that the list lacks.
  const rosterOptions = (() => {
    const list = [...(index?.rosters ?? [])].map((r) => ({ id: r.id, label: r.label }));
    for (const r of piece?.results ?? []) if (!list.some((x) => x.id === r.roster_id)) list.push({ id: r.roster_id, label: r.roster_label });
    return list;
  })();
  const availablePlanners = new Set(piece?.results.filter((r) => r.roster_id === sel?.roster).map((r) => r.planner) ?? []);
  const rosterHasResult = (id: string) => !!piece?.results.some((r) => r.roster_id === id);
  const isMock = !!result?.result_id.startsWith("mock-");
  const shown = result?.piece ?? piece;

  return (
    <div className="page">
      <header className="masthead">
        <p className="wordmark">Cover Part</p>
        <p className="tagline">
          Arrange a piece for the players you actually have. An AI decides who covers each line; plain code
          transposes and checks every note against every player's range.
        </p>
        {comparison && (
          <a className="masthead-link" href="#scoreboard">
            Scoreboard
          </a>
        )}
      </header>

      {indexError && (
        <p className="notice notice--error">
          No demo results found ({indexError}). Generate them with the engine CLI into web/public/demos/.
        </p>
      )}

      <section className="titlepage" aria-label="Piece and players">
        <div className="work">
          {shown ? (
            <>
              <h1 className="work-title">
                {splitTitle(shown.title)[0]}
                {splitTitle(shown.title)[1] && <span className="work-catalog">{splitTitle(shown.title)[1]}</span>}
              </h1>
              <p className="work-meta">
                {shown.composer}
                {shown.movement ? <>, {shown.movement}</> : null}
                {shown.measures ? <>, <i>{mm(shown.measures[0], shown.measures[1])}</i></> : null}
              </p>
              {"why" in shown && shown.why && <p className="work-why">{shown.why}</p>}
              {shown.source && (
                <p className="work-source">
                  Score:{" "}
                  {shown.source_url ? (
                    <a href={shown.source_url} target="_blank" rel="noreferrer">
                      {shown.source}
                    </a>
                  ) : (
                    shown.source
                  )}
                </p>
              )}
            </>
          ) : (
            <h1 className="work-title work-title--empty">{indexError ? "Nothing to show yet" : "Opening the score…"}</h1>
          )}
        </div>

        {index && sel && (
          <form className="controls" onSubmit={(e) => e.preventDefault()}>
            <label className="field">
              <span className="field-label">Piece</span>
              <select value={sel.piece} onChange={(e) => update({ piece: e.target.value })}>
                {index.pieces.map((p) => (
                  <option key={p.id} value={p.id}>
                    {pieceLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Players you have</span>
              <select value={sel.roster} onChange={(e) => update({ roster: e.target.value })}>
                {rosterOptions.map((r) => (
                  <option key={r.id} value={r.id} disabled={!rosterHasResult(r.id) && !LIVE_MODE}>
                    {r.label}
                    {!rosterHasResult(r.id) && !LIVE_MODE ? " (not computed for this piece)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="field planner">
              <legend className="field-label">Who decides</legend>
              <div className="seg">
                {(["ai", "greedy"] as const).map((p) => (
                  <label key={p} className={`seg-opt ${sel.planner === p ? "is-on" : ""} ${availablePlanners.has(p) ? "" : "is-off"}`}>
                    <input
                      type="radio"
                      name="planner"
                      value={p}
                      checked={sel.planner === p}
                      disabled={!availablePlanners.has(p)}
                      onChange={() => update({ planner: p })}
                    />
                    {PLANNER_LABEL[p]}
                  </label>
                ))}
              </div>
              {availablePlanners.size < 2 && (
                <p className="field-note">
                  Only the {PLANNER_LABEL[[...availablePlanners][0] ?? "ai"]} was computed for these players.
                </p>
              )}
            </fieldset>
          </form>
        )}
        <div className="staff-rule" aria-hidden="true" />
      </section>

      {LIVE_MODE && index && sel && (
        <section className="block" aria-labelledby="h-live">
          <h2 id="h-live" className="block-title">
            Your players
          </h2>
          <RosterEditor
            pieceId={sel.piece}
            seed={index.rosters.find((r) => r.id === sel.roster) ?? null}
            planner={sel.planner}
            onResult={(r, seconds) => setLive({ result: r, seconds })}
          />
        </section>
      )}
      {live && (
        <p className="notice notice--live">
          Re-scored live for {live.result.roster.label.replace(/^Custom:\s*/, "")} in {live.seconds}&nbsp;s. Not saved.{" "}
          <button type="button" className="btn btn--quiet btn--inline" onClick={() => setLive(null)}>
            Show the precomputed result
          </button>
        </p>
      )}
      {isMock && (
        <p className="notice">
          Mock data: a hand-written 4-bar sketch standing in until the engine's real results land.
        </p>
      )}
      {current.error && <p className="notice notice--error">{current.error}</p>}

      {result && (
        <main className={`result ${current.loading ? "is-loading" : ""}`} key={result.result_id}>
          <section className="block" aria-labelledby="h-checks">
            <h2 id="h-checks" className="block-title">
              What the checker found
            </h2>
            <Checks result={result} other={otherResult} />
          </section>

          <section className="block" aria-labelledby="h-lines">
            <h2 id="h-lines" className="block-title">
              Where each line went
            </h2>
            <p className="block-lede">
              Each color is one line of the original. It keeps that color in whichever player's part carries it, here
              and in the score below.
            </p>
            <LineMap result={result} player={player} />
          </section>

          <section className="block" aria-labelledby="h-score">
            <h2 id="h-score" className="block-title">
              Listen and read
            </h2>
            <PlayerBar player={player} side={side} onSide={changeSide} coverLabel={`Cover, ${PLANNER_LABEL[result.planner]}`} />
            <div className="scores">
              <div hidden={side !== "arranged"}>
                <ScoreView
                  xml={result.musicxml.arranged}
                  label={`Cover score for ${result.roster.label}, concert pitch`}
                  player={player}
                  follow={side === "arranged"}
                />
                <p className="score-caption">Cover in concert pitch. Notes keep the color of the line they came from.</p>
              </div>
              <div hidden={side !== "original"}>
                <ScoreView
                  xml={result.musicxml.original}
                  label="Original score"
                  staffColors={result.source_parts.map((s) => s.color)}
                  player={player}
                  follow={side === "original"}
                />
                <p className="score-caption">Original, concert pitch, each line in its color.</p>
              </div>
            </div>
          </section>

          <section className="block" aria-labelledby="h-plan">
            <h2 id="h-plan" className="block-title">
              Who plays what, and why
            </h2>
            <Plan result={result} />
          </section>
        </main>
      )}

      {comparison && index && (
        <section className="block" id="scoreboard" aria-labelledby="h-scoreboard">
          <h2 id="h-scoreboard" className="block-title">
            Scoreboard
          </h2>
          <Scoreboard data={comparison} index={index} current={sel} onPick={pickPair} />
        </section>
      )}

      <footer className="colophon">
        <p>
          Built for EvoHacks 2026. Scores engraved in the browser with Verovio; playback uses the FluidR3 General MIDI
          soundfont. Source excerpts are public domain (CC0).
        </p>
      </footer>
    </div>
  );
}
