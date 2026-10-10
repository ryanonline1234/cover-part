// A/B MIDI player: one clock, two note lists. Switching sides keeps the playback
// position, so a listener hears the original and the cover at the same bar.
// Samples: smplr Soundfont (gleitz midi-js-soundfonts, FluidR3_GM kit), one instrument
// per General MIDI program found in the files.
import { Midi } from "@tonejs/midi";
import type { Bar } from "./music";
import { Soundfont, getSoundfontNames } from "smplr";

export type Side = "original" | "arranged";

interface NoteEv {
  t: number; // seconds
  d: number;
  midi: number;
  vel: number; // 0..127
  prog: number;
}

export interface Track {
  events: NoteEv[];
  duration: number;
  programs: number[];
  /** Seconds -> fractional bar offset from the excerpt's first bar number (column index in the line map). */
  measureAt: (sec: number) => number;
  /** Fractional measure offset -> seconds. */
  timeAtMeasure: (m: number) => number;
  /** Seconds -> quarter notes from the start (Verovio timemap's qstamp unit). */
  quarterAt: (sec: number) => number;
}

// General MIDI program number -> gleitz soundfont name.
const GM = (
  "acoustic_grand_piano bright_acoustic_piano electric_grand_piano honkytonk_piano electric_piano_1 electric_piano_2 harpsichord clavinet " +
  "celesta glockenspiel music_box vibraphone marimba xylophone tubular_bells dulcimer " +
  "drawbar_organ percussive_organ rock_organ church_organ reed_organ accordion harmonica tango_accordion " +
  "acoustic_guitar_nylon acoustic_guitar_steel electric_guitar_jazz electric_guitar_clean electric_guitar_muted overdriven_guitar distortion_guitar guitar_harmonics " +
  "acoustic_bass electric_bass_finger electric_bass_pick fretless_bass slap_bass_1 slap_bass_2 synth_bass_1 synth_bass_2 " +
  "violin viola cello contrabass tremolo_strings pizzicato_strings orchestral_harp timpani " +
  "string_ensemble_1 string_ensemble_2 synth_strings_1 synth_strings_2 choir_aahs voice_oohs synth_choir orchestra_hit " +
  "trumpet trombone tuba muted_trumpet french_horn brass_section synth_brass_1 synth_brass_2 " +
  "soprano_sax alto_sax tenor_sax baritone_sax oboe english_horn bassoon clarinet " +
  "piccolo flute recorder pan_flute blown_bottle shakuhachi whistle ocarina"
).split(" ");

function programName(prog: number): string {
  const known = new Set(getSoundfontNames());
  const name = GM[prog];
  return name && known.has(name) ? name : "acoustic_grand_piano";
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseMidi(b64: string, bars: Bar[] = []): Track {
  const midi = new Midi(decodeBase64(b64));
  const events: NoteEv[] = [];
  const programs = new Set<number>();
  for (const tr of midi.tracks) {
    if (tr.channel === 9 || tr.instrument.percussion) continue;
    const prog = tr.instrument.number ?? 0;
    if (tr.notes.length) programs.add(prog);
    for (const n of tr.notes) {
      events.push({ t: n.time, d: Math.max(0.05, n.duration), midi: n.midi, vel: Math.round(n.velocity * 127), prog });
    }
  }
  events.sort((a, b) => a.t - b.t);

  const { ppq } = midi.header;
  const quarterAt = (sec: number) => midi.header.secondsToTicks(Math.max(0, sec)) / ppq;
  const secAtQuarter = (q: number) => midi.header.ticksToSeconds(Math.max(0, q) * ppq);

  let measureAt: (sec: number) => number;
  let timeAtMeasure: (m: number) => number;
  if (bars.length) {
    // Bar map from the score (real bar lengths: pickups and split half-bars). Offsets are counted
    // from the first bar's number, matching the line map's columns.
    const n0 = bars[0].n;
    measureAt = (sec) => {
      const q = quarterAt(sec);
      let i = bars.length - 1;
      while (i > 0 && bars[i].startQ > q) i--;
      const b = bars[i];
      return b.n - n0 + Math.min(1, Math.max(0, (q - b.startQ) / b.lenQ));
    };
    timeAtMeasure = (m) => {
      const target = n0 + Math.floor(m);
      const b = bars.find((x) => x.n === target) ?? (m <= 0 ? bars[0] : bars[bars.length - 1]);
      const frac = b.n === target ? m - Math.floor(m) : m <= 0 ? 0 : 1;
      return secAtQuarter(b.startQ + frac * b.lenQ);
    };
  } else {
    // Fallback: full bars from the time signatures.
    const sigs = (midi.header.timeSignatures.length
      ? midi.header.timeSignatures
      : [{ ticks: 0, timeSignature: [4, 4] }]
    ).map((s) => ({ ticks: s.ticks, len: (ppq * 4 * s.timeSignature[0]) / s.timeSignature[1] }));
    const starts: number[] = [];
    let acc = 0;
    for (let i = 0; i < sigs.length; i++) {
      starts.push(acc);
      if (i + 1 < sigs.length) acc += (sigs[i + 1].ticks - sigs[i].ticks) / sigs[i].len;
    }
    measureAt = (sec) => {
      const ticks = midi.header.secondsToTicks(Math.max(0, sec));
      let i = sigs.length - 1;
      while (i > 0 && sigs[i].ticks > ticks) i--;
      return starts[i] + (ticks - sigs[i].ticks) / sigs[i].len;
    };
    timeAtMeasure = (m) => {
      let i = starts.length - 1;
      while (i > 0 && starts[i] > m) i--;
      return midi.header.ticksToSeconds(sigs[i].ticks + (m - starts[i]) * sigs[i].len);
    };
  }
  const lastEnd = events.reduce((mx, e) => Math.max(mx, e.t + e.d), 0);
  return { events, duration: Math.max(midi.duration, lastEnd), programs: [...programs], measureAt, timeAtMeasure, quarterAt };
}

type Listener = () => void;

const LOOKAHEAD = 0.12; // s; below smplr's own 200 ms dispatch window, so stop() silences everything queued
const TICK_MS = 25;

let sharedCtx: AudioContext | null = null;
const instruments = new Map<number, Promise<Soundfont>>();

function audioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext({ latencyHint: "interactive" });
  return sharedCtx;
}

function instrumentFor(prog: number): Promise<Soundfont> {
  let p = instruments.get(prog);
  if (!p) {
    const ctx = audioContext();
    const inst = Soundfont(ctx, { instrument: programName(prog), kit: "FluidR3_GM", volume: 100 });
    p = inst.ready.then(() => inst);
    p.catch(() => instruments.delete(prog));
    instruments.set(prog, p);
  }
  return p;
}

export type LoadState = { status: "idle" } | { status: "loading"; done: number; total: number } | { status: "ready" } | { status: "error"; message: string };

export class ABPlayer {
  readonly tracks: Record<Side, Track>;
  side: Side;
  load: LoadState = { status: "idle" };
  private insts = new Map<number, Soundfont>();
  private playing = false;
  private anchorCtx = 0;
  private anchorPos = 0;
  private pausedPos = 0;
  private cursor = 0;
  private timer: number | undefined;
  private listeners = new Set<Listener>();
  private disposed = false;

  constructor(midi: { original: string; arranged: string }, side: Side = "arranged", bars: Bar[] = []) {
    this.tracks = { original: parseMidi(midi.original, bars), arranged: parseMidi(midi.arranged, bars) };
    this.side = side;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  get isPlaying() {
    return this.playing;
  }
  get duration() {
    return Math.max(this.tracks.original.duration, this.tracks.arranged.duration);
  }
  get position(): number {
    if (!this.playing || !sharedCtx) return this.pausedPos;
    return Math.min(this.duration, this.anchorPos + (sharedCtx.currentTime - this.anchorCtx));
  }
  /** Fractional measure offset (0 = first bar's downbeat) of the current position. */
  get measurePosition(): number {
    return this.tracks[this.side].measureAt(this.position);
  }
  get quarterPosition(): number {
    return this.tracks[this.side].quarterAt(this.position);
  }

  async ensureLoaded(): Promise<boolean> {
    if (this.load.status === "ready") return true;
    const progs = [...new Set([...this.tracks.original.programs, ...this.tracks.arranged.programs])];
    let done = 0;
    this.load = { status: "loading", done, total: progs.length };
    this.emit();
    try {
      await Promise.all(
        progs.map(async (prog) => {
          const inst = await instrumentFor(prog);
          this.insts.set(prog, inst);
          done++;
          if (!this.disposed) {
            this.load = { status: "loading", done, total: progs.length };
            this.emit();
          }
        }),
      );
      this.load = { status: "ready" };
      this.emit();
      return true;
    } catch (err) {
      this.load = { status: "error", message: err instanceof Error ? err.message : String(err) };
      this.emit();
      return false;
    }
  }

  async play() {
    if (this.playing) return;
    const ctx = audioContext();
    if (ctx.state !== "running") await ctx.resume();
    if (!(await this.ensureLoaded()) || this.disposed) return;
    if (this.pausedPos >= this.duration - 0.05) this.pausedPos = 0;
    this.startAt(this.pausedPos);
  }

  pause() {
    if (!this.playing) return;
    this.pausedPos = this.position;
    this.halt();
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(sec: number) {
    const pos = Math.max(0, Math.min(this.duration, sec));
    if (this.playing) {
      this.halt();
      this.startAt(pos);
    } else {
      this.pausedPos = pos;
      this.emit();
    }
  }

  /** Switch A/B at the same musical position (measure-aligned, in case tempi differ). */
  setSide(side: Side) {
    if (side === this.side) return;
    const m = this.tracks[this.side].measureAt(this.position);
    const pos = this.tracks[side].timeAtMeasure(m);
    this.side = side;
    if (this.playing) {
      this.halt();
      this.startAt(pos);
    } else {
      this.pausedPos = Math.min(pos, this.duration);
      this.emit();
    }
  }

  dispose() {
    this.disposed = true;
    this.halt();
    this.listeners.clear();
  }

  private startAt(pos: number) {
    const ctx = audioContext();
    this.anchorCtx = ctx.currentTime + 0.03;
    this.anchorPos = pos;
    this.cursor = 0;
    this.playing = true;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.emit();
  }

  private halt() {
    this.playing = false;
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    for (const inst of this.insts.values()) inst.stop();
  }

  private schedule() {
    const ctx = audioContext();
    const now = ctx.currentTime;
    const pos = this.anchorPos + (now - this.anchorCtx);
    if (pos >= this.duration) {
      this.halt();
      this.pausedPos = 0;
      this.emit();
      return;
    }
    const horizon = pos + LOOKAHEAD;
    const evs = this.tracks[this.side].events;
    while (this.cursor < evs.length && evs[this.cursor].t < horizon) {
      const e = evs[this.cursor++];
      const when = this.anchorCtx + (e.t - this.anchorPos);
      const end = when + e.d;
      if (end <= now + 0.01) continue; // already over (or seeking into its tail)
      const t0 = Math.max(when, now);
      const inst = this.insts.get(e.prog);
      inst?.start({ note: e.midi, velocity: e.vel, time: t0, duration: end - t0 });
    }
  }
}
