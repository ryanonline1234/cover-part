import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { ABPlayer, type Side } from "../audio";
import { loadComparison, loadIndex } from "../data";
import { barMap } from "../music";
import type { ArrangeResult, Comparison, DemoIndex } from "../types";

const DEMOS = `${import.meta.env.BASE_URL}demos/`;

// Local result cache (not data.ts's) so a missing file can be retried: the as-written files are
// generated in parallel and may appear after the page first asks for them.
const cache = new Map<string, Promise<ArrangeResult>>();

function fetchResult(id: string): Promise<ArrangeResult> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`${DEMOS}${encodeURIComponent(id)}.json`).then(async (res) => {
      if (!res.ok) throw new Error(`demos/${id}.json is not available (HTTP ${res.status}).`);
      return (await res.json()) as ArrangeResult;
    });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Load demos/<id>.json once `enabled` is true. With `retryMs`, a missing file is polled for. */
export function useResult(id: string | null, enabled = true, retryMs = 0): Loaded<ArrangeResult> {
  const [state, setState] = useState<{ id: string | null; data: ArrangeResult | null; error: string | null }>({
    id: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!id || !enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const attempt = () => {
      fetchResult(id)
        .then((data) => !cancelled && setState({ id, data, error: null }))
        .catch((e: unknown) => {
          if (cancelled) return;
          setState({ id, data: null, error: e instanceof Error ? e.message : String(e) });
          if (retryMs > 0) timer = window.setTimeout(attempt, retryMs);
        });
    };
    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, enabled, retryMs]);
  const current = state.id === id;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !!id && enabled && (!current || (!state.data && !state.error)),
  };
}

let comparisonP: Promise<Comparison | null> | null = null;
let indexP: Promise<DemoIndex> | null = null;

export function useComparison(): Comparison | null {
  const [c, setC] = useState<Comparison | null>(null);
  useEffect(() => {
    comparisonP ??= loadComparison();
    let cancelled = false;
    void comparisonP.then((v) => !cancelled && setC(v));
    return () => {
      cancelled = true;
    };
  }, []);
  return c;
}

export function useIndex(): DemoIndex | null {
  const [ix, setIx] = useState<DemoIndex | null>(null);
  useEffect(() => {
    indexP ??= loadIndex();
    indexP.catch(() => (indexP = null));
    let cancelled = false;
    indexP.then((v) => !cancelled && setIx(v)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return ix;
}

/** True once the element has come within `margin` of the viewport (stays true). */
export function useNear(ref: RefObject<Element | null>, margin = "600px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: `${margin} 0px ${margin} 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}

// ---------------------------------------------------------------------------
// Audio: one ABPlayer per demo, and only one demo plays at a time on the page.
// ---------------------------------------------------------------------------

let active: ABPlayer | null = null;

/** Pause whatever else is playing on the page, then make `p` the active player. */
export function claimAudio(p: ABPlayer) {
  if (active && active !== p) active.pause();
  active = p;
}

/**
 * An A/B player over two MIDI files that share a bar map. Created in an effect so StrictMode's
 * double mount disposes the throwaway instance. `a` plays on side "original", `b` on side "arranged".
 */
export function useABPlayer(a: string | null | undefined, b: string | null | undefined, barsXml: string | null | undefined, side: Side): ABPlayer | null {
  const [player, setPlayer] = useState<ABPlayer | null>(null);
  const sideRef = useRef(side);
  sideRef.current = side;
  useEffect(() => {
    if (!a || !b) {
      setPlayer(null);
      return;
    }
    let p: ABPlayer;
    try {
      p = new ABPlayer({ original: a, arranged: b }, sideRef.current, barsXml ? barMap(barsXml) : []);
    } catch {
      setPlayer(null);
      return;
    }
    setPlayer(p);
    return () => {
      if (active === p) active = null;
      p.dispose();
    };
  }, [a, b, barsXml]);
  useEffect(() => {
    player?.setSide(side);
  }, [player, side]);
  return player;
}

/** Re-render on every player event (play, pause, load progress). */
export function usePlayerState(player: ABPlayer | null): { playing: boolean; loading: boolean; error: string | null } {
  const subscribe = useCallback((fn: () => void) => (player ? player.subscribe(fn) : () => undefined), [player]);
  const snap = useSyncExternalStore(
    subscribe,
    () => (player ? `${player.isPlaying ? 1 : 0}|${player.load.status}|${player.load.status === "error" ? player.load.message : ""}` : "0|idle|"),
  );
  const [playing, status, message] = snap.split("|");
  return { playing: playing === "1", loading: status === "loading", error: status === "error" ? message || "Audio failed to load." : null };
}

/** Matches the user's reduced-motion preference, live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}
