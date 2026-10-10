import type { ArrangeResult, DemoIndex, Planner, Roster } from "./types";

const DEMOS = `${import.meta.env.BASE_URL}demos/`;

export async function loadIndex(): Promise<DemoIndex> {
  const res = await fetch(`${DEMOS}index.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load demos/index.json (HTTP ${res.status}).`);
  return res.json();
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
// TODO(live): wire this into App once engine/coverpart/api.py is deployed.
//   1. Set VITE_LIVE_API=1 (and, if the API is on another origin, VITE_API_BASE).
//   2. In App.tsx, where a selection has no precomputed result_id, call
//      arrangeLive({ piece_id, roster, planner }) instead of showing "not computed".
//   3. A roster editor (add/remove players, pick levels) would build `roster` here;
//      not built yet on purpose.
// Contract: POST /api/arrange { piece_id, roster: {players[]}, planner } -> ArrangeResult
// (docs/01-architecture.md, "API").
export const LIVE_MODE = import.meta.env.VITE_LIVE_API === "1";
const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

export interface ArrangeRequest {
  piece_id: string;
  roster: Pick<Roster, "players"> & Partial<Pick<Roster, "id" | "label">>;
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
