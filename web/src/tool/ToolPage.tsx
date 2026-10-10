import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ABPlayer, parseMidi, type Side } from "../audio";
import { Checks } from "../Checks";
import { ServiceUnavailable, arrangeLive, loadIndex, loadResult, presetRef } from "../data";
import { LineMap } from "../LineMap";
import { PLANNER_LABEL, barMap, downloadText, mm, slug } from "../music";
import { Plan } from "../Plan";
import { PlayerBar } from "../PlayerBar";
import { ScoreView } from "../Score";
import type { ArrangeResult, DemoIndex, Planner } from "../types";
import { bandFromRoster, bandSummary, decodeBand, encodeBand, liveIds, liveLabels, matchPreset, signature, type BandPlayer } from "./band";
import { BandRow } from "./BandRow";
import { CheckLine } from "./CheckLine";
import { MusicPicker, shortWork, surname } from "./MusicPicker";
import { PartCard, type PlayMode } from "./PartCard";
import { playerTracks, usePlayerVersion } from "./parts";
import { PrintParts } from "./PrintParts";
import { flagsOf } from "./signals";
import "./tool.css";

/** A result on the desk, and what it was made for. */
interface Shown {
  result: ArrangeResult;
  /** piece|preset|planner for precomputed results, piece|custom|signature for live ones. */
  key: string;
  source: "preset" | "live";
  seconds?: number;
}

type Live =
  | { status: "idle" }
  /** key: what the run is for (piece|custom|signature); a run for something no longer wanted is cancelled. */
  | { status: "running"; started: number; key: string }
  | { status: "error"; message: string; unreachable: boolean };

/** Facts about a piece learned from any result file loaded for it (the index doesn't carry them). */
interface PieceFacts {
  /** Lines (source parts) in the excerpt. */
  lines: number;
  /** Length of the original excerpt, from its MIDI, in seconds (null if it couldn't be read). */
  seconds: number | null;
}

function factsOf(r: ArrangeResult): PieceFacts {
  let seconds: number | null = null;
  try {
    seconds = parseMidi(r.midi.original).duration;
  } catch {
    seconds = null;
  }
  return { lines: r.source_parts.length, seconds };
}

/** What differs between the parts on the desk and what's wanted (keys: piece|preset|planner or piece|custom|signature). */
function changedText(shownKey: string | null, wantKey: string): string {
  if (!shownKey) return "";
  const [sp, sb, sx] = shownKey.split("|");
  const [wp, wb, wx] = wantKey.split("|");
  const music = sp !== wp;
  const band = sb !== wb || (sb === "custom" && sx !== wx);
  if (music && band) return "The music and the band have changed.";
  if (music) return "The music has changed.";
  if (band) return "The band has changed.";
  return "";
}

/** "about 1 min 10 s" (rounded to 5 s), for a length in seconds. */
export function aboutDuration(sec: number): string {
  const s = Math.max(5, Math.round(sec / 5) * 5);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `about ${m ? `${m} min` : ""}${m && r ? " " : ""}${r ? `${r} s` : ""}`;
}

type View = "score" | "decided" | null;

interface Props {
  /** Query string of the tool route (the part after "#/?"). */
  query: string;
  /** Bumps on every hashchange, so following a link re-applies its query. */
  nav: number;
  /** false while another page (Why) is showing; the tool stays mounted to keep its state. */
  active: boolean;
  /** The tool's current hash, for the header's "Arrange" link. */
  onHash: (hash: string) => void;
}

/** Shown with any band that isn't a preset. presetCount comes from index.json. */
export function customNote(presetCount: number): string {
  return `Your band gets the rule-based arrangement, made and checked live. The AI arranger has only been run for the ${presetCount} preset ${presetCount === 1 ? "band" : "bands"}.`;
}

/** "a:b,c" kept readable in the hash: commas and colons are legal there. */
function hashValue(s: string): string {
  return encodeURIComponent(s).replace(/%3A/gi, ":").replace(/%2C/gi, ",");
}

export default function ToolPage({ query, nav, active, onHash }: Props) {
  const [index, setIndex] = useState<DemoIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [pieceId, setPieceId] = useState("");
  const [band, setBand] = useState<BandPlayer[]>([]);
  const [planner, setPlanner] = useState<Planner>("ai");
  const [shown, setShown] = useState<Shown | null>(null);
  const [other, setOther] = useState<ArrangeResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<Live>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<View>(null);
  const [side, setSide] = useState<Side>("arranged");
  const [activeCard, setActiveCard] = useState<{ id: string; mode: PlayMode } | null>(null);
  const [printOnly, setPrintOnly] = useState<string | null>(null);
  const [printReady, setPrintReady] = useState(false);
  const [printWaiting, setPrintWaiting] = useState(false);
  const [facts, setFacts] = useState<ReadonlyMap<string, PieceFacts>>(() => new Map());
  /** Screen-reader announcement: only state changes (started, done, failed), never the running clock. */
  const [announce, setAnnounce] = useState("");

  const written = useRef<string | null>(null);
  const autoLive = useRef(false);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  /** Set when the user pressed Arrange: focus moves to the parts when that run ends. */
  const focusParts = useRef(false);
  const partsHeading = useRef<HTMLHeadingElement>(null);
  const arrangeBtn = useRef<HTMLButtonElement>(null);

  const presets = useMemo(() => index?.rosters ?? [], [index]);
  const match = useMemo(() => matchPreset(band, presets), [band, presets]);
  const piece = index?.pieces.find((p) => p.id === pieceId) ?? null;
  const wantKey = match ? `${pieceId}|${match.id}|${planner}` : `${pieceId}|custom|${signature(band)}`;
  const upToDate = !!shown && shown.key === wantKey;
  const running = live.status === "running";

  useEffect(() => {
    loadIndex()
      .then(setIndex)
      .catch((e: unknown) => setIndexError(e instanceof Error ? e.message : String(e)));
    return () => abort.current?.abort();
  }, []);

  // Apply the URL: on first load and whenever a link changes the hash.
  useEffect(() => {
    if (!index || !index.pieces.length) return;
    if (query === written.current) return; // our own write coming back
    const q = new URLSearchParams(query);
    if (band.length && !q.get("piece") && !q.get("band") && !q.get("roster")) {
      // A bare "#/" (a link back to the tool) keeps the session; only a link that names a piece or a
      // band replaces it. Put the session's own URL back.
      if (written.current && active) window.history.replaceState(null, "", `#/?${written.current}`);
      return;
    }
    const p = index.pieces.find((x) => x.id === q.get("piece")) ?? index.pieces[0];
    // "roster" is accepted too (older links and the why page's scoreboard use it).
    const b = decodeBand(q.get("band") ?? q.get("roster"), presets) ?? (presets[0] ? bandFromRoster(presets[0]) : []);
    setPieceId(p.id);
    setBand(b);
    setPlanner(q.get("planner") === "greedy" ? "greedy" : "ai");
    autoLive.current = true; // a shared link to a custom band runs it once
  }, [index, nav]); // not on `query` alone: our own replaceState writes must not re-apply

  // Write the URL (replaceState: no history entry per edit, no hashchange back to us).
  useEffect(() => {
    if (!index || !pieceId || !band.length) return;
    const s = `piece=${hashValue(pieceId)}&band=${hashValue(encodeBand(band, match?.id ?? null))}&planner=${match ? planner : "greedy"}`;
    written.current = s;
    onHash(`#/?${s}`);
    if (active && window.location.hash !== `#/?${s}`) window.history.replaceState(null, "", `#/?${s}`);
  }, [index, pieceId, band, planner, match, active, onHash]);

  const loadPreset = useCallback(
    (presetId: string, want: Planner, key: string) => {
      if (!index) return;
      const ref = presetRef(index, pieceId, presetId, want) ?? presetRef(index, pieceId, presetId, want === "ai" ? "greedy" : "ai");
      abort.current?.abort();
      const n = ++seq.current;
      setLive({ status: "idle" });
      setLoadError(null);
      if (!ref) {
        setLoadError("No precomputed result for this band and piece.");
        return;
      }
      setLoading(true);
      loadResult(ref.result_id)
        .then((result) => {
          if (n !== seq.current) return;
          setShown({ result, key, source: "preset" });
          setLoadError(null);
        })
        .catch((e: unknown) => n === seq.current && setLoadError(e instanceof Error ? e.message : String(e)))
        .finally(() => n === seq.current && setLoading(false));
    },
    [index, pieceId],
  );

  const runLive = useCallback(() => {
    if (!band.length || !pieceId) return;
    const ids = liveIds(band);
    const labels = liveLabels(band);
    const key = `${pieceId}|custom|${signature(band)}`;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const n = ++seq.current;
    const started = Date.now();
    setNow(started);
    setLoading(false);
    setLoadError(null);
    setLive({ status: "running", started, key });
    setAnnounce("Arranging this band. This can take a few seconds.");
    arrangeLive(
      {
        piece_id: pieceId,
        planner: "greedy",
        roster: {
          id: "custom",
          label: `Custom: ${labels.join(", ")}`,
          players: band.map((p, i) => ({ id: ids[i], instrument: p.instrument, level: p.level, label: labels[i] })),
        },
      },
      ctl.signal,
    )
      .then((result) => {
        if (n !== seq.current) return;
        setShown({ result, key, source: "live", seconds: Math.max(1, Math.round((Date.now() - started) / 1000)) });
        setLive({ status: "idle" });
        const flags = flagsOf(result);
        setAnnounce(
          `Parts are ready for this band.${flags.length ? ` The checker flags: ${flags.map((f) => f.text).join("; ")}.` : ""}`,
        );
      })
      .catch((e: unknown) => {
        if (n !== seq.current) return;
        if (ctl.signal.aborted) {
          setLive({ status: "idle" });
          setAnnounce("Arranging cancelled.");
          focusParts.current = false;
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        setLive({ status: "error", message, unreachable: e instanceof ServiceUnavailable });
        setAnnounce(`Couldn't arrange this band. ${message}`);
      })
      .finally(() => {
        if (abort.current === ctl) abort.current = null;
      });
  }, [band, pieceId]);

  // Preset bands load their precomputed result as soon as they're picked; a custom band waits for
  // "Arrange for this band", except once when it arrives in a shared link.
  useEffect(() => {
    if (!index || !pieceId || !band.length) return;
    // What's wanted changed: an error or a run for the old piece/band no longer applies (a run that is
    // still for this band, e.g. after typing a name, keeps going).
    if (live.status === "running" && live.key !== wantKey) {
      abort.current?.abort();
      seq.current++;
      focusParts.current = false;
      setLive({ status: "idle" });
      setAnnounce("The music or the band changed, so that arrangement was cancelled.");
    } else if (live.status === "error") setLive({ status: "idle" });
    setLoadError(null);
    if (match) {
      autoLive.current = false;
      if (shown?.key !== wantKey) loadPreset(match.id, planner, wantKey);
    } else if (autoLive.current) {
      autoLive.current = false;
      if (shown?.key !== wantKey) runLive();
    }
  }, [index, wantKey]); // only when what's wanted changes, not on every new result

  // Learn the line count and length of each piece from results as they load. A custom band on a piece
  // with no result loaded yet fetches one precomputed file for it (cached), so the band-size note and
  // the length are known before arranging.
  useEffect(() => {
    if (!shown) return;
    const id = shown.result.piece.id;
    setFacts((f) => (f.has(id) ? f : new Map(f).set(id, factsOf(shown.result))));
  }, [shown]);
  useEffect(() => {
    if (!index || !pieceId || facts.has(pieceId) || match) return;
    const ref = index.pieces.find((p) => p.id === pieceId)?.results.find((r) => r.planner !== "as_written");
    if (!ref) return;
    let alive = true;
    loadResult(ref.result_id)
      .then((r) => alive && setFacts((f) => (f.has(pieceId) ? f : new Map(f).set(pieceId, factsOf(r)))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [index, pieceId, facts, match]);

  // When a run the user started ends, move focus to the parts (the Arrange button goes away).
  useEffect(() => {
    if (running || !focusParts.current) return;
    if (live.status === "error") {
      focusParts.current = false;
      return;
    }
    if (upToDate) {
      focusParts.current = false;
      partsHeading.current?.focus({ preventScroll: true });
    }
  }, [running, upToDate, live.status]);

  // The other planner's precomputed result, for "How it decided" (presets only).
  useEffect(() => {
    setOther(null);
    if (!index || !shown || shown.source !== "preset") return;
    const r = shown.result;
    const otherPlanner: Planner = r.planner === "ai" ? "greedy" : "ai";
    const ref = presetRef(index, r.piece.id, r.roster.id, otherPlanner);
    if (!ref) return;
    let live = true;
    loadResult(ref.result_id)
      .then((o) => live && setOther(o))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [index, shown]);

  // Elapsed-time clock while a live arrangement runs.
  useEffect(() => {
    if (live.status !== "running") return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [live.status]);

  // One audio player per result on the desk.
  const result = shown?.result ?? null;
  const [audio, setAudio] = useState<ABPlayer | null>(null);
  useEffect(() => {
    setActiveCard(null);
    setSide("arranged");
    if (!result) {
      setAudio(null);
      return;
    }
    const p = new ABPlayer(result.midi, "arranged", barMap(result.musicxml.original));
    setAudio(p);
    return () => p.dispose();
  }, [result]);
  usePlayerVersion(audio);
  useEffect(() => {
    if (!active) audio?.pause();
  }, [active, audio]);
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __coverPartPlayer?: ABPlayer | null }).__coverPartPlayer = audio;
  }, [audio]);
  const tracks = useMemo(() => (audio && result ? playerTracks(result, audio.tracks.arranged) : null), [audio, result]);

  const playCard = (id: string, mode: PlayMode) => {
    if (!audio) return;
    const same = activeCard?.id === id;
    if (same && activeCard?.mode === mode && audio.isPlaying) {
      audio.pause();
      return;
    }
    if (audio.side !== "arranged") {
      audio.setSide("arranged");
      setSide("arranged");
    }
    audio.setSolo(mode === "solo" ? tracks?.get(id) ?? null : null);
    if (!same) audio.seek(0);
    setActiveCard({ id, mode });
    if (!audio.isPlaying) void audio.play();
  };

  const openView = (v: View) => {
    const next = view === v ? null : v;
    setView(next);
    if (next === "score" && audio) {
      // The full-score player is the whole band, A/B; stop any one-part playback first.
      audio.pause();
      audio.setSolo(null);
      setActiveCard(null);
    }
  };

  // Display names typed in the band row, by result player id (only while the band still matches).
  const names = useMemo(() => {
    const out = new Map<string, string>();
    if (!shown || !upToDate) return out;
    if (shown.source === "preset" && match) {
      for (const [pid, bp] of match.byPlayer) if (bp.name.trim()) out.set(pid, bp.name.trim());
    } else if (shown.source === "live") {
      shown.result.roster.players.forEach((p, i) => {
        const nm = band[i]?.name.trim();
        if (nm) out.set(p.id, nm);
      });
    }
    return out;
  }, [shown, upToDate, match, band]);

  // Printing: engraved at print size in the background; "Print" waits for that if needed.
  const onPrintReady = useCallback((r: boolean) => setPrintReady(r), []);
  const print = (only: string | null) => {
    flushSync(() => setPrintOnly(only));
    if (!printReady) {
      setPrintWaiting(true);
      return;
    }
    window.print();
  };
  useEffect(() => {
    if (printReady && printWaiting) {
      setPrintWaiting(false);
      window.print();
    }
  }, [printReady, printWaiting]);
  useEffect(() => {
    const after = () => setPrintOnly(null);
    window.addEventListener("afterprint", after);
    return () => window.removeEventListener("afterprint", after);
  }, []);

  const download = (id: string) => {
    if (!result) return;
    const p = result.roster.players.find((x) => x.id === id);
    const xml = result.musicxml.parts[id];
    if (!p || !xml) return;
    // Unique per piece and player: two players with the same label ("Violin") get different files.
    const stand = result.roster.players.indexOf(p) + 1;
    downloadText(`${slug(result.piece.id)}-${stand}-${slug(p.id)}-${slug(names.get(id) || p.label)}.musicxml`, xml);
  };

  const arrange = () => {
    if (running) return; // aria-disabled, not disabled: the button keeps focus while it runs
    focusParts.current = true;
    if (match) loadPreset(match.id, planner, wantKey);
    else runLive();
  };

  const presetName = (id: string) => (presets.find((r) => r.id === id)?.label ?? id).split(": ")[0];
  const elapsed = live.status === "running" ? Math.max(0, Math.floor((now - live.started) / 1000)) : 0;
  const shownPiece = result?.piece;
  const availablePlanners = new Set(
    match && piece ? piece.results.filter((r) => r.roster_id === match.id).map((r) => r.planner) : [],
  );
  const effectivePlanner: Planner = match ? planner : "greedy";
  const pieceFacts = facts.get(pieceId) ?? null;
  const shownFacts = result ? facts.get(result.piece.id) ?? null : null;
  const flags = result && upToDate ? flagsOf(result, names) : [];
  const presetCount = presets.length;

  if (indexError) {
    return (
      <main className="tool">
        <p className="notice notice--error">The demo results didn't load ({indexError}). Reload the page to try again.</p>
      </main>
    );
  }
  if (!index || !piece) {
    return (
      <main className="tool">
        <p className="tool-opening">Opening the folder…</p>
      </main>
    );
  }

  return (
    <main className="tool" data-print={printOnly ?? "all"}>
      <div className="tool-screen">
        {/* What this is, in one breath, at every width (the header tagline hides on phones). */}
        <p className="tool-intro">
          Pick the music and the players you have, and get one printable part per player. An AI decided who covers each line
          for the {presetCount} preset bands; any other band gets a rule-based plan, made live. Code checks every note against
          each player's range. <a href="#/why">Why it works this way&nbsp;→</a>
        </p>

        {/* A. Music */}
        <section className="step" aria-labelledby="h-music">
          <h2 className="step-title" id="h-music">
            <span className="mark" aria-hidden="true">
              A
            </span>
            Music
          </h2>
          <p className="step-note">
            The library is {index.pieces.length} public-domain excerpts from string quartets. Bringing your own MusicXML isn't
            on the site yet.
          </p>
          <MusicPicker
            pieces={index.pieces}
            value={pieceId}
            onChange={setPieceId}
            length={pieceFacts?.seconds != null ? aboutDuration(pieceFacts.seconds) : null}
          />
        </section>

        {/* B. Band */}
        <section className="step" aria-labelledby="h-band">
          <h2 className="step-title" id="h-band">
            <span className="mark" aria-hidden="true">
              B
            </span>
            Your band
            <span className="step-aside">
              {band.length} {band.length === 1 ? "player" : "players"} · {match ? `preset: ${presetName(match.id)}` : "custom band"}
            </span>
          </h2>
          <BandRow band={band} onChange={setBand} presets={presets} presetId={match?.id ?? null} />
          {pieceFacts && band.length > pieceFacts.lines && (!upToDate || running) && (
            <p className="band-warn">
              This piece has {pieceFacts.lines} lines and your band has {band.length} players, so not everyone gets a line of their
              own: extra players double the tune or the bass where it fits them. After arranging, the checker names anyone still
              left with little or nothing to play.
            </p>
          )}
          <div className="arrange-bar">
            {/* The action shows only when there is something to do; an up-to-date band gets a status line. It stays
                mounted (aria-disabled) while it runs, so keyboard focus isn't lost. */}
            {(!upToDate || running) && (
              <button
                type="button"
                ref={arrangeBtn}
                className="btn-primary"
                onClick={arrange}
                disabled={!band.length}
                aria-disabled={running || undefined}
              >
                {running ? "Arranging…" : "Arrange for this band"}
              </button>
            )}
            {running && (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  abort.current?.abort();
                  // Cancel goes away with the run; keep focus on the Arrange button that stays.
                  window.requestAnimationFrame(() => arrangeBtn.current?.focus());
                }}
              >
                Cancel
              </button>
            )}
            {/* Visible status. Not a live region: the clock would be read out every second. */}
            <p className="arrange-status">
              {running && (
                <>
                  <span className="clock">{elapsed}&nbsp;s</span> Making the rule-based plan, then checking every note against
                  every player's range.
                </>
              )}
              {!running && live.status === "error" && (
                <span className="arrange-error">
                  {live.unreachable ? `Couldn't arrange this band: ${live.message}` : live.message}{" "}
                  {shown
                    ? "The parts below are from the last arrangement."
                    : `Try again, or pick one of the ${presetCount} preset bands (precomputed).`}
                </span>
              )}
              {!running && live.status !== "error" && !upToDate && !match && (
                <>
                  {changedText(shown?.key ?? null, wantKey)} Arrange to make the parts for this band.
                </>
              )}
              {!running && live.status !== "error" && !upToDate && match && loading && "Opening the precomputed parts…"}
              {!running && live.status !== "error" && upToDate && (
                <span className={`arrange-done ${flags.length ? "has-flags" : ""}`}>
                  Parts below are for this band.{" "}
                  {match
                    ? "It's a preset band, so they were precomputed with both plans."
                    : `Arranged live in ${shown?.seconds} s by the rule-based plan, then checked.`}{" "}
                  {flags.length > 0 ? (
                    <>
                      <strong>The checker flags:</strong> {flags.map((f) => f.text).join("; ")}. See the numbers below and{" "}
                      <em>How it decided</em>.
                    </>
                  ) : (
                    "Change a player to arrange for a different band."
                  )}
                </span>
              )}
            </p>
            <p className="sr-only" role="status" aria-live="polite">
              {announce}
            </p>
          </div>
        </section>

        {/* C. Parts */}
        <section className="step step--parts" aria-labelledby="h-parts">
          <h2 className="step-title" id="h-parts" ref={partsHeading} tabIndex={-1}>
            <span className="mark" aria-hidden="true">
              C
            </span>
            Parts
            {result && (
              <span className="step-aside">
                {result.roster.players.length} {result.roster.players.length === 1 ? "part" : "parts"}
              </span>
            )}
          </h2>

          <div className="planbar">
            <fieldset className="plan-seg">
              <legend className="planbar-label">Plan</legend>
              <div className="seg">
                {(["ai", "greedy"] as const).map((p) => {
                  const enabled = p === "greedy" ? true : !!match && availablePlanners.has("ai");
                  return (
                    <label key={p} className={`seg-opt ${effectivePlanner === p ? "is-on" : ""} ${enabled ? "" : "is-off"}`}>
                      <input
                        type="radio"
                        name="planner"
                        value={p}
                        checked={effectivePlanner === p}
                        disabled={!enabled}
                        onChange={() => setPlanner(p)}
                      />
                      {p === "ai" ? "AI plan" : "Rule-based"}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {result && (
              <p className="planbar-src">
                {!upToDate
                  ? `Below: the last arrangement (${PLANNER_LABEL[result.planner]}, ${shown?.source === "live" ? "made live" : "precomputed"}), not yet for this band.`
                  : shown?.source === "live"
                  ? `Rule-based plan, made and checked live${shown.seconds ? ` in ${shown.seconds} s` : ""}. No AI in this one.`
                  : result.planner === "ai"
                    ? `AI plan by ${result.model ?? "the AI planner"}, precomputed for this preset band. Plain code checked every note.`
                    : "Rule-based plan, precomputed. No AI: the highest line is the melody, the lowest the bass, the rest go to the best-fitting free player."}
              </p>
            )}
          </div>
          {(!match || shown?.source === "live") && <p className="custom-note">{customNote(presetCount)}</p>}

          {loadError && <p className="notice notice--error">{loadError}</p>}

          {result && shownPiece && (
            <div className={`desk ${upToDate ? "" : "is-stale"} ${loading ? "is-loading" : ""}`}>
              {!upToDate && !loading && (
                <p className="stale-note">
                  These parts are for{" "}
                  {shownPiece.id !== pieceId ? `${surname(shownPiece.composer)}, ${shortWork(shownPiece.title)}` : "the band you had before"}
                  {result.roster.label ? ` (${result.roster.label.replace(/^Custom:\s*/, "")})` : ""}.{" "}
                  {match ? "" : "Press Arrange for this band to update them."}
                </p>
              )}
              <CheckLine result={result} names={names} />

              <div className="folder-head">
                <div className="folder-title">
                  <p className="folder-work">
                    {surname(shownPiece.composer)}, {shortWork(shownPiece.title)}
                    {shownPiece.movement ? <span className="folder-mvt">, {shownPiece.movement}</span> : null}
                  </p>
                  <p className="folder-meta">
                    {mm(shownPiece.measures[0], shownPiece.measures[1])}
                    {shownFacts?.seconds != null ? `, ${aboutDuration(shownFacts.seconds)}` : ""} · for{" "}
                    {bandSummary(result.roster.players)} · {PLANNER_LABEL[result.planner]}
                  </p>
                </div>
                <button type="button" className="btn-print" onClick={() => print(null)} disabled={printWaiting}>
                  {printWaiting ? "Preparing parts for print…" : "Print all parts"}
                </button>
              </div>

              <ol className="folder">
                {result.roster.players.map((p, i) => (
                  <PartCard
                    key={`${result.result_id}-${p.id}`}
                    result={result}
                    player={p}
                    n={i + 1}
                    name={names.get(p.id) ?? ""}
                    audio={audio}
                    track={tracks?.get(p.id) ?? null}
                    active={activeCard}
                    onPlay={playCard}
                    onPrint={(id) => print(id)}
                    onDownload={download}
                  />
                ))}
              </ol>
              {!tracks && audio && <p className="field-note">This result's audio can't be split by player, so only the full band plays.</p>}
            </div>
          )}
        </section>

        {/* Secondary views */}
        {result && (
          <section className="more" aria-label="More about this arrangement">
            <div className="more-tabs">
              <button type="button" className={`more-tab ${view === "score" ? "is-on" : ""}`} aria-expanded={view === "score"} aria-controls="v-score" onClick={() => openView("score")}>
                Full score
              </button>
              <button type="button" className={`more-tab ${view === "decided" ? "is-on" : ""}`} aria-expanded={view === "decided"} aria-controls="v-decided" onClick={() => openView("decided")}>
                How it decided
              </button>
            </div>

            <div id="v-score" hidden={view !== "score"}>
              {view === "score" && (
                <>
                  <PlayerBar
                    player={audio}
                    side={side}
                    onSide={(s) => {
                      setSide(s);
                      audio?.setSide(s);
                    }}
                    coverLabel={`Cover, ${PLANNER_LABEL[result.planner]}`}
                  />
                  <div className="scores">
                    <div hidden={side !== "arranged"}>
                      <ScoreView xml={result.musicxml.arranged} label={`Cover score for ${result.roster.label}, concert pitch`} player={audio} follow={side === "arranged"} />
                      <p className="score-caption">Cover in concert pitch. Notes keep the color of the line they came from.</p>
                    </div>
                    <div hidden={side !== "original"}>
                      <ScoreView
                        xml={result.musicxml.original}
                        label="Original score"
                        staffColors={result.source_parts.map((s) => s.color)}
                        player={audio}
                        follow={side === "original"}
                      />
                      <p className="score-caption">Original, concert pitch, each line in its color.</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div id="v-decided" hidden={view !== "decided"}>
              {view === "decided" && (
                <>
                  <h3 className="more-title">Where each line went</h3>
                  <LineMap result={result} player={audio} />
                  <h3 className="more-title">What the checker found</h3>
                  <Checks result={result} other={other} />
                  <h3 className="more-title">Who plays what, and why</h3>
                  <Plan result={result} downloads={false} />
                </>
              )}
            </div>
          </section>
        )}
      </div>

      {result && <PrintParts result={result} names={names} only={printOnly} onReady={onPrintReady} />}
    </main>
  );
}
