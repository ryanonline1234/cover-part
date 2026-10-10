// Mirrors the ArrangeResult contract in docs/01-architecture.md.
// Optional (`?`) marks fields the UI tolerates being absent; everything else is required.

export type Planner = "ai" | "greedy";

export interface Piece {
  id: string;
  title: string;
  composer: string;
  movement?: string | null;
  measures: [number, number];
  source?: string;
  source_url?: string;
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
  essential_coverage: { melody: number; bass: number };
  violations?: Violation[];
}

export interface CoverageSegment {
  start_measure: number;
  end_measure: number;
  role: string;
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
  planner: Planner;
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
}

export interface ResultRef {
  result_id: string;
  roster_id: string;
  roster_label: string;
  planner: Planner;
}

export interface IndexPiece extends Piece {
  results: ResultRef[];
}

export interface DemoIndex {
  pieces: IndexPiece[];
  rosters: Roster[];
}
