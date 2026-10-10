// "Use your own score": a MusicXML file, read in the browser and sent with each request. Nothing is
// stored: /api/inspect reads it once to list its movements and bars, and every /api/arrange carries the
// file again with the bars to arrange.
import { useCallback, useEffect, useRef, useState } from "react";
import { ServiceUnavailable, inspectUpload, type Inspected, type InspectMovement, type UploadRef } from "../data";

export const ACCEPT = ".musicxml,.xml,.mxl";
const OK_EXT = new Set(["musicxml", "xml", "mxl"]);

/**
 * Largest file the site sends. The request carries the file as base64 (a third bigger), and Vercel
 * functions take request bodies up to 4.5 MB; the engine may set a lower limit of its own, and its own
 * message is shown then.
 */
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

/** Files people pick by mistake, and what to do instead. */
const WRONG_KIND: Record<string, string> = {
  mscz: "That's a MuseScore file (.mscz). In MuseScore, use File → Export → MusicXML, then choose that file here.",
  mscx: "That's a MuseScore file (.mscx). In MuseScore, use File → Export → MusicXML, then choose that file here.",
  mus: "That's a Finale file (.mus). In Finale, use File → Export → MusicXML, then choose that file here.",
  musx: "That's a Finale file (.musx). In Finale, use File → Export → MusicXML, then choose that file here.",
  sib: "That's a Sibelius file (.sib). In Sibelius, use File → Export → MusicXML, then choose that file here.",
  dorico: "That's a Dorico project. In Dorico, use File → Export → MusicXML, then choose that file here.",
  mid: "MIDI files can't be read: they don't say which notes belong to which part. Export MusicXML from your notation program instead.",
  midi: "MIDI files can't be read: they don't say which notes belong to which part. Export MusicXML from your notation program instead.",
  pdf: "PDF sheet music can't be read: it's a picture of the notes. Cover Part needs MusicXML, which notation programs export.",
};

export function prettySize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** A plain-words reason this file can't be used, or null if it can be sent. */
export function checkFile(file: File): string | null {
  const ext = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? "";
  if (!OK_EXT.has(ext)) {
    return WRONG_KIND[ext] ?? `“${file.name}” isn't a MusicXML file. Cover Part reads .musicxml, .xml or .mxl (in most notation programs: File → Export → MusicXML).`;
  }
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > MAX_FILE_BYTES) {
    return `This file is ${prettySize(file.size)}; the most the site takes is ${prettySize(MAX_FILE_BYTES)}. Export just the movement you need, or save it as compressed MusicXML (.mxl), which is much smaller.`;
  }
  return null;
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export interface LoadedFile {
  name: string;
  size: number;
  b64: string;
  /** Bumps with every file read, so two uploads of the same name are different pieces. */
  seq: number;
}

export type UploadStage =
  | { stage: "empty" }
  | { stage: "reading"; name: string; started: number }
  | { stage: "failed"; name: string | null; message: string }
  | { stage: "ready"; file: LoadedFile; info: Inspected };

/** The bar picker as typed (strings: a half-typed number isn't a choice yet). */
export interface BarChoice {
  movement: number;
  from: string;
  to: string;
}

export type Selection =
  | { ok: true; movement: InspectMovement; start: number; end: number }
  | { ok: false; message: string | null };

/** Default bars: the first 16 of the movement (fewer if it's shorter or the engine's limit is lower). */
export function defaultChoice(info: Inspected, movementIndex?: number): BarChoice {
  const m = info.movements.find((x) => x.index === movementIndex) ?? info.movements[0];
  const span = Math.min(16, info.maxBars);
  return { movement: m.index, from: String(m.first), to: String(Math.min(m.last, m.first + span - 1)) };
}

/** Is the typed choice something the engine can arrange? A plain-words message when not. */
export function selectionOf(info: Inspected, c: BarChoice | null): Selection {
  if (!c) return { ok: false, message: null };
  const m = info.movements.find((x) => x.index === c.movement);
  if (!m) return { ok: false, message: "Choose a movement." };
  const from = /^\s*-?\d+\s*$/.test(c.from) ? parseInt(c.from, 10) : NaN;
  const to = /^\s*-?\d+\s*$/.test(c.to) ? parseInt(c.to, 10) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, message: "Enter the first and last bar as numbers." };
  if (from < m.first || to > m.last || from > m.last || to < m.first) {
    return { ok: false, message: `This movement has bars ${m.first}–${m.last}.` };
  }
  if (to < from) return { ok: false, message: "The last bar comes before the first." };
  const n = to - from + 1;
  if (n > info.maxBars) {
    return {
      ok: false,
      message: `That's ${n} bars; the most at once is ${info.maxBars}. Try bars ${from}–${Math.min(m.last, from + info.maxBars - 1)}.`,
    };
  }
  return { ok: true, movement: m, start: from, end: to };
}

/** What a run of the arranger is for: changes whenever the file, movement or bars change. */
export function uploadKey(stage: UploadStage, sel: Selection): string {
  if (stage.stage !== "ready" || !sel.ok) return "up:none";
  return `up:${stage.file.seq}:${sel.movement.index}:${sel.start}-${sel.end}`;
}

export function uploadRef(stage: UploadStage, sel: Selection): UploadRef | null {
  if (stage.stage !== "ready" || !sel.ok) return null;
  return {
    filename: stage.file.name,
    data_base64: stage.file.b64,
    movement_index: sel.movement.index,
    start_measure: sel.start,
    end_measure: sel.end,
  };
}

/** The uploaded file, what the engine found in it, and the bars chosen. */
export function useUpload() {
  const [stage, setStage] = useState<UploadStage>({ stage: "empty" });
  const [choice, setChoice] = useState<BarChoice | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(() => () => ctl.current?.abort(), []);

  const choose = useCallback(async (file: File) => {
    ctl.current?.abort();
    const n = ++seq.current;
    const bad = checkFile(file);
    if (bad) {
      setStage({ stage: "failed", name: file.name, message: bad });
      setChoice(null);
      return;
    }
    const c = new AbortController();
    ctl.current = c;
    setStage({ stage: "reading", name: file.name, started: Date.now() });
    setChoice(null);
    try {
      const b64 = await fileToBase64(file);
      if (n !== seq.current) return;
      const info = await inspectUpload(file.name, b64, c.signal);
      if (n !== seq.current) return;
      setStage({ stage: "ready", file: { name: file.name, size: file.size, b64, seq: n }, info });
      setChoice(defaultChoice(info));
    } catch (e) {
      if (n !== seq.current || c.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      setStage({
        stage: "failed",
        name: file.name,
        message: e instanceof ServiceUnavailable ? `Couldn't read “${file.name}”: ${msg}` : msg,
      });
    } finally {
      if (ctl.current === c) ctl.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    ctl.current?.abort();
    seq.current++;
    setStage({ stage: "empty" });
    setChoice(null);
  }, []);

  return { stage, choice, setChoice, choose, clear };
}
