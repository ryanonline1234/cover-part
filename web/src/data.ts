import type { ArrangeResult, Comparison, DemoIndex, Planner } from "./types";

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

const resultCache = new Map<string, Promise<ArrangeResult>>();

/** Precomputed result at public/demos/<result_id>.json. Cached per session. */
export function loadResult(resultId: string): Promise<ArrangeResult> {
  let p = resultCache.get(resultId);
  if (!p) {
    p = fetch(`${DEMOS}${encodeURIComponent(resultId)}.json`).then(async (res) => {
      if (!res.ok) throw new Error(`Couldn't load result ${resultId} (HTTP ${res.status}).`);
      return (await res.json()) as ArrangeResult;
    });
    p.catch(() => resultCache.delete(resultId));
    resultCache.set(resultId, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// LIVE MODE HOOK
// ---------------------------------------------------------------------------
// Live mode is on with ?live=1 (or VITE_LIVE_API=1): RosterEditor.tsx posts a custom roster here.
// In dev, Vite proxies /api to the local engine (uvicorn coverpart.api:app --port 8000).
// If the API is ever deployed on another origin, set VITE_API_BASE.
// Contract: POST /api/arrange { piece_id, roster: {players[]}, planner } -> ArrangeResult
// (docs/01-architecture.md, "API").
export const LIVE_MODE =
  new URLSearchParams(window.location.search).get("live") === "1" || import.meta.env.VITE_LIVE_API === "1";
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

export async function arrangeLive(req: ArrangeRequest, signal?: AbortSignal): Promise<ArrangeResult> {
  const res = await fetch(`${API_BASE}/api/arrange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Arrange request failed (HTTP ${res.status}). ${detail.slice(0, 200)}`);
  }
  return res.json();
}
