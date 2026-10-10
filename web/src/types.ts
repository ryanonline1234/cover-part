// Mirrors the ArrangeResult contract in docs/01-architecture.md.
// Optional (`?`) marks fields the UI tolerates being absent; everything else is required.

export type Planner = "ai" | "greedy";
/** Every planner a result file can name. "as_written" results are why-page demo data (one player per
 *  source line, no plan); the arranging tool ignores them. */
export type ResultPlanner = Planner | "as_written";

export interface Piece {
  id: string;
  title: string;
  composer: string;
  movement?: string | null;
  measures: [number, number];
  source?: string;
  source_url?: string;
  license?: string;
  /** Why this excerpt is a good test (shown under the title). */
  why?: string;
}

export interface SourcePart {
  id: string;
  name: string;
  instrument: string;
  color: string;
}

export interface Player {
  id: string;
  label: string;
  instrument: string;
  level?: string;
  range_written: [string, string];
  range_sounding: [string, string];
}

export interface Roster {
  id: string;
  label: string;
  players: Player[];
}

export interface RoleSpan {
  source_part: string;
  start_measure: number;
  end_measure: number;
  role: string;
}

export interface Assignment {
  source_part: string;
  start_measure: number;
  end_measure: number;
  player: string;
  octave_shift: number;
  chord_policy: string;
  reason: string;
}

export interface Dropped {
  source_part: string;
  start_measure: number;
  end_measure: number;
  reason: string;
}

export interface Violation {
  player: string;
  measure: number;
  pitch: string;
  range_sounding: [string, string];
}

export interface Checks {
  notes_total: number;
  notes_out_of_range: number;
  notes_out_of_range_before_repair: number;
  notes_folded: number;
  chords_reduced: number;
  repair_rounds?: number;
  /** Optional repair stages: AI re-plan first, then octave folding as a last resort. */
  notes_out_of_range_after_ai_revision?: number;
  notes_out_of_range_after_octave_repair?: number;
  lines_dropped?: number;
  /** Times a source line changes player. */
  handoffs?: number;
  /** Notes sounding under the player carrying the original bass line (final / before AI revision). */
  bass_inversions?: number;
  bass_inversions_before_revision?: number;
  voicing_issues?: VoicingIssue[];
  /** Each AI revision; kept only if, after the same repairs, the problem count goes down. */
  revisions?: Revision[];
  first_plan?: Badness;
  final?: Badness;
  /** Bars of music (part x bar with notes) that no player plays. */
  measures_dropped?: number;
  /** Melody/bass spans the plan labeled but still drops after autofix. */
  role_problems_left?: string[];
  /** melody: share of reference-melody bars some player plays (null: no melody map).
   *  bass: share of sounding time the cover's lowest pitch class matches the original's. */
  essential_coverage: { melody: number | null; bass: number | null };
  violations?: Violation[];
}

/** Problems measured on a plan after the deterministic repairs (phrase octave repair, then folds). */
export interface Badness {
  /** Out of range before any repair. */
  out_of_range_raw?: number;
  /** Still out of range after the phrase-level octave repair, i.e. needed single-note folds. */
  out_of_range: number;
  folded?: number;
  under_bass: number;
  bass_missing_bars: number;
}

export interface Revision {
  kind: "structure" | "range" | "voicing" | string;
  kept: boolean;
  /** "problems 35 -> 13", "problems 9 -> 14 (not fewer)", "planner call failed: X", "2 structural/role problem(s)" */
  why: string;
  before: Badness | null;
  after: Badness | null;
  total_before?: number;
  total_after?: number;
}

export interface VoicingIssue {
  player: string | null;
  bass_line: string;
  kind: "below_bass" | "bass_missing" | string;
  measures: string;
  events: number;
  max_semitones: number;
}

export interface ComparisonMetric {
  key: string;
  label: string;
  better: "higher" | "lower";
}

export interface ComparisonTotals {
  ai_mean: number | null;
  greedy_mean: number | null;
  ai_better: number;
  greedy_better: number;
  tie: number;
  n: number;
}

export interface ComparisonRow {
  piece: string;
  roster: string;
  ai: Record<string, number | string | null>;
  greedy: Record<string, number | string | null>;
}

export interface Comparison {
  n_pairs: number;
  metrics: ComparisonMetric[];
  totals: Record<string, ComparisonTotals>;
  rows: ComparisonRow[];
}

export interface CoverageSegment {
  start_measure: number;
  end_measure: number;
  role: string | null;
  covered_by: string[];
  dropped: boolean;
}

export interface Coverage {
  source_part: string;
  segments: CoverageSegment[];
}

export interface ArrangeResult {
  result_id: string;
  piece: Piece;
  source_parts: SourcePart[];
  roster: Roster;
  planner: ResultPlanner;
  model: string | null;
  plan: {
    summary: string;
    roles: RoleSpan[];
    assignments: Assignment[];
    dropped: Dropped[];
  };
  checks: Checks;
  coverage: Coverage[];
  musicxml: {
    original: string;
    arranged: string;
    parts: Record<string, string>;
  };
  midi: { original: string; arranged: string };
  /** Present on live results (engine log lines) and some precomputed ones. */
  log?: string[];
  elapsed_s?: number;
}

export interface ResultRef {
  result_id: string;
  roster_id: string;
  roster_label: string;
  planner: ResultPlanner;
}

export interface IndexPiece extends Piece {
  results: ResultRef[];
}

export interface DemoIndex {
  pieces: IndexPiece[];
  rosters: Roster[];
}
