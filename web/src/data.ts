import type { ArrangeResult, Comparison, DemoIndex, Planner, ResultRef } from "./types";

const DEMOS = `${import.meta.env.BASE_URL}demos/`;

export async function loadIndex(): Promise<DemoIndex> {
  const res = await fetch(`${DEMOS}index.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load demos/index.json (HTTP ${res.status}).`);
  return res.json();
}

/** All-pairs AI vs baseline summary from the engine (optional; null if absent). */
export async function loadComparison(): Promise<Comparison | null> {
  try {
    const res = await fetch(`${DEMOS}comparison.json`, { cache: "no-cache" });
    if (!res.ok) return null;
    return (await res.json()) as Comparison;
  } catch {
    return null;
  }
}

/**
 * Does this look like an ArrangeResult the pages can render? Checks the fields every view reads, so a
 * wrong-but-valid JSON body (an error object from a proxy, a changed engine) is reported as an error
 * instead of crashing the page.
 */
export function looksLikeResult(x: unknown): x is ArrangeResult {
  if (!x || typeof x !== "object") return false;
  const r = x as Partial<ArrangeResult>;
  return (
    !!r.piece &&
    Array.isArray(r.piece.measures) &&
    Array.isArray(r.source_parts) &&
    !!r.roster &&
    Array.isArray(r.roster.players) &&
    !!r.plan &&
    Array.isArray(r.plan.assignments) &&
    Array.isArray(r.plan.roles) &&
    Array.isArray(r.plan.dropped) &&
    !!r.checks &&
    typeof r.checks.notes_total === "number" &&
    !!r.checks.essential_coverage &&
    Array.isArray(r.coverage) &&
    !!r.musicxml &&
    typeof r.musicxml.original === "string" &&
    typeof r.musicxml.arranged === "string" &&
    !!r.musicxml.parts &&
    !!r.midi &&
    typeof r.midi.original === "string" &&
    typeof r.midi.arranged === "string"
  );
}

const resultCache = new Map<string, Promise<ArrangeResult>>();

/** Precomputed result at public/demos/<result_id>.json. Cached per session. */
export function loadResult(resultId: string): Promise<ArrangeResult> {
  let p = resultCache.get(resultId);
  if (!p) {
    p = fetch(`${DEMOS}${encodeURIComponent(resultId)}.json`)
      .catch(() => {
        // fetch() rejects only on network failure; its own text ("Failed to fetch") means nothing to a director.
        throw new Error("Couldn't open the precomputed parts (network error).");
      })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Couldn't open the precomputed parts (HTTP ${res.status}).`);
        const body: unknown = await res.json().catch(() => null);
        if (!looksLikeResult(body)) throw new Error("The precomputed parts file is damaged.");
        return body;
      });
    p.catch(() => resultCache.delete(resultId));
    resultCache.set(resultId, p);
  }
  return p;
}

/** Precomputed AI / rule-based results for one piece and preset band ("as_written" demo results excluded). */
export function presetRef(index: DemoIndex, pieceId: string, rosterId: string, planner: Planner): ResultRef | null {
  const piece = index.pieces.find((p) => p.id === pieceId);
  return piece?.results.find((r) => r.roster_id === rosterId && r.planner === planner) ?? null;
}

// ---------------------------------------------------------------------------
// LIVE ARRANGING (custom bands)
// ---------------------------------------------------------------------------
// The tool posts every custom band here with planner "greedy" (rule-based plan + the full checker).
// Production: a Vercel Python function serves /api/arrange on the same origin.
// Dev: Vite proxies /api to the local engine (uvicorn coverpart.api:app --port 8000).
// If the API is ever deployed on another origin, set VITE_API_BASE.
// Contract: POST /api/arrange { piece_id, roster: {id, label, players[]}, planner } -> ArrangeResult
// (docs/01-architecture.md, "API"). No live AI: the deployed function has no API key.

/** Kept for older callers: live arranging is always available now (custom bands use it). */
export const LIVE_MODE = true;
const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

export interface LivePlayer {
  id: string;
  instrument: string;
  level?: string;
  label?: string;
}

export interface ArrangeRequest {
  piece_id: string;
  roster: { id?: string; label?: string; players: LivePlayer[] };
  planner: Planner;
}

/** The arranging service didn't answer (network error, 404/5xx, timeout) as opposed to rejecting the band. */
export class ServiceUnavailable extends Error {}

const LIVE_TIMEOUT_MS = 120_000;

export async function arrangeLive(req: ArrangeRequest, signal?: AbortSignal): Promise<ArrangeResult> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = window.setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), LIVE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/arrange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: ctl.signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (ctl.signal.aborted) throw new ServiceUnavailable("The arranging service took longer than two minutes to answer.");
    throw new ServiceUnavailable("The arranging service couldn't be reached (network error).");
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let msg = detail;
    try {
      const j = JSON.parse(detail) as { detail?: unknown };
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* not JSON */
    }
    if (res.status === 404 || res.status >= 500) {
      throw new ServiceUnavailable(`The arranging service isn't answering (HTTP ${res.status}).`);
    }
    throw new Error(`The engine rejected this band (HTTP ${res.status}): ${msg.slice(0, 200)}`);
  }
  const text = await res.text().catch(() => "");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!looksLikeResult(body)) throw new ServiceUnavailable("The arranging service answered with something that isn't a result.");
  return body;
}
