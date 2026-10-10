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
// LIVE ARRANGING (custom bands, uploaded scores)
// ---------------------------------------------------------------------------
// The tool posts every custom band, and every uploaded score, here with planner "greedy" (rule-based
// plan + the full checker).
// Production: a Vercel Python function serves /api/arrange on the same origin.
// Dev: Vite proxies /api to the local engine (uvicorn coverpart.api:app --port 8000).
// If the API is ever deployed on another origin, set VITE_API_BASE.
// Contract: POST /api/arrange { piece_id | upload, roster: {id, label, players[]}, planner } -> ArrangeResult
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

export interface UploadRef {
  filename: string;
  data_base64: string;
  movement_index: number;
  start_measure: number;
  end_measure: number;
}

/** A library piece (piece_id) or an uploaded score (upload): exactly one of the two. */
export interface ArrangeRequest {
  piece_id?: string;
  upload?: UploadRef;
  roster: { id?: string; label?: string; players: LivePlayer[] };
  planner: Planner;
}

/** The arranging service didn't answer (network error, 404/5xx, timeout) as opposed to rejecting the band. */
export class ServiceUnavailable extends Error {}

const LIVE_TIMEOUT_MS = 120_000;

/** The `detail` of a FastAPI error body when it is a plain sentence; null otherwise (422 arrays, HTML, empty). */
function plainDetail(text: string): string | null {
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    if (typeof j.detail === "string" && j.detail.trim()) return j.detail.trim();
  } catch {
    /* not JSON */
  }
  return null;
}

/**
 * POST a JSON body to the engine with the live timeout. Throws ServiceUnavailable when the service
 * doesn't answer; otherwise returns the response (ok or not) and its text.
 */
async function postEngine(path: string, body: unknown, signal: AbortSignal | undefined, timeoutText: string): Promise<{ res: Response; text: string }> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = window.setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), LIVE_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (ctl.signal.aborted) throw new ServiceUnavailable(timeoutText);
      throw new ServiceUnavailable("The arranging service couldn't be reached (network error).");
    }
    const text = await res.text().catch(() => "");
    return { res, text };
  } catch (e) {
    if (signal?.aborted || e instanceof ServiceUnavailable) throw e;
    if (ctl.signal.aborted) throw new ServiceUnavailable(timeoutText);
    throw new ServiceUnavailable("The arranging service stopped answering (network error).");
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function arrangeLive(req: ArrangeRequest, signal?: AbortSignal): Promise<ArrangeResult> {
  const { res, text } = await postEngine("/api/arrange", req, signal, "The arranging service took longer than two minutes to answer.");
  if (!res.ok) {
    const detail = plainDetail(text);
    if (req.upload) {
      // Uploads: the engine's own sentence (limits, bars that aren't in the file, a score it can't read).
      if (res.status === 413) throw new Error(detail ?? "This file is too large to send to the arranging service.");
      if (res.status === 404 || res.status >= 500) {
        throw new ServiceUnavailable(detail && res.status < 500 ? detail : `The arranging service couldn't arrange this file (HTTP ${res.status}).`);
      }
      throw new Error(detail ?? `The arranging service couldn't use this file or these bars (HTTP ${res.status}).`);
    }
    if (res.status === 404 || res.status >= 500) {
      throw new ServiceUnavailable(`The arranging service isn't answering (HTTP ${res.status}).`);
    }
    throw new Error(`The engine rejected this band (HTTP ${res.status}): ${(detail ?? text).slice(0, 200)}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!looksLikeResult(body)) throw new ServiceUnavailable("The arranging service answered with something that isn't a result.");
  return body;
}

// ---------------------------------------------------------------------------
// UPLOADED SCORES
// ---------------------------------------------------------------------------
// POST /api/inspect { filename, data_base64 } -> what the file holds (title, composer, parts, movements).
// Nothing is stored: the file travels with each request (inspect, then every arrange) and is discarded.

export interface InspectMovement {
  index: number;
  label: string;
  /** First and last bar numbers of the movement as printed (a pickup can be bar 0). */
  first: number;
  last: number;
  /** The engine's note about this movement (e.g. bar numbers counted through), if any. */
  note: string | null;
}

export interface Inspected {
  title: string;
  composer: string | null;
  parts: string[];
  movements: InspectMovement[];
  /** Most bars one arrangement may span (the engine's limit). */
  maxBars: number;
  /** Things the engine wants the director to know about the whole file (e.g. parts left out). */
  notes: string[];
}

/** Bars per arrangement when the engine doesn't say. */
export const DEFAULT_MAX_BARS = 32;

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

/** Reads the engine's inspect answer, tolerating the field names it might use; null if it isn't one. */
export function normalizeInspect(x: unknown, filename: string): Inspected | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const rawParts = Array.isArray(o.parts) ? o.parts : [];
  const parts = rawParts
    .map((p, i) => (typeof p === "string" ? p : str((p as Record<string, unknown>)?.name) ?? str((p as Record<string, unknown>)?.label) ?? `Part ${i + 1}`))
    .filter((p): p is string => !!p);
  const rawMovs = Array.isArray(o.movements) ? o.movements : [];
  const movements: InspectMovement[] = [];
  rawMovs.forEach((m, i) => {
    const r = (m ?? {}) as Record<string, unknown>;
    const range = Array.isArray(r.measures) ? (r.measures as unknown[]) : null;
    const first = num(r.first_measure) ?? num(r.start_measure) ?? num(r.first) ?? (range ? num(range[0]) : null);
    const last = num(r.last_measure) ?? num(r.end_measure) ?? num(r.last) ?? (range ? num(range[1]) : null);
    if (first === null || last === null || last < first) return;
    const index = num(r.index) ?? num(r.movement_index) ?? i;
    const label = str(r.label) ?? str(r.name) ?? str(r.title) ?? `Movement ${index + 1}`;
    movements.push({ index, label, first, last, note: str(r.note) });
  });
  if (!parts.length || !movements.length) return null;
  const limits = (o.limits ?? {}) as Record<string, unknown>;
  const maxBars = num(o.max_measures) ?? num(o.max_bars) ?? num(limits.max_measures) ?? num(limits.max_bars) ?? DEFAULT_MAX_BARS;
  const title = str(o.title) ?? str((o.piece as Record<string, unknown> | undefined)?.title) ?? filename.replace(/\.[^.]+$/, "");
  const composer = str(o.composer) ?? str((o.piece as Record<string, unknown> | undefined)?.composer);
  // Top-level notes repeat each movement's own note; those are shown with their movement instead.
  const perMovement = new Set(movements.map((m) => m.note).filter(Boolean));
  const notes = (Array.isArray(o.notes) ? o.notes : []).map(str).filter((n): n is string => !!n && !perMovement.has(n));
  return { title, composer, parts, movements, maxBars: Math.max(1, Math.floor(maxBars)), notes };
}

export async function inspectUpload(filename: string, dataBase64: string, signal?: AbortSignal): Promise<Inspected> {
  const { res, text } = await postEngine("/api/inspect", { filename, data_base64: dataBase64 }, signal, "Reading the file took longer than two minutes.");
  if (!res.ok) {
    const detail = plainDetail(text);
    if (res.status === 413) throw new Error(detail ?? "This file is too large to send to the arranging service.");
    if (res.status === 404 || res.status >= 500) {
      throw new ServiceUnavailable(detail && res.status < 500 ? detail : `The arranging service couldn't read files just now (HTTP ${res.status}).`);
    }
    throw new Error(detail ?? `This file couldn't be read as MusicXML (HTTP ${res.status}).`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const info = normalizeInspect(body, filename);
  if (!info) throw new Error("The file was read, but no parts or bars were found in it.");
  return info;
}
