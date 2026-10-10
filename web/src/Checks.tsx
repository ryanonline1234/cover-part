import { PLANNER_LABEL, mm, pct, playerById, prettyPitch, prettyRange, sourceById } from "./music";
import type { ArrangeResult, Badness } from "./types";

interface Props {
  result: ArrangeResult;
  /** The same piece and roster under the other planner, for comparison. */
  other: ArrangeResult | null;
}

type C = ArrangeResult["checks"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const has = (x: unknown) => x !== undefined && x !== null;

const BASS_MISSING_WEIGHT = 12; // engine/coverpart/arrange.py

/** The engine's gate: single-note folds + notes under the bass + 12 x bars with no bass. */
function problems(b: Badness): number {
  return b.out_of_range + b.under_bass + BASS_MISSING_WEIGHT * b.bass_missing_bars;
}

const BAD_NAME: Record<string, [string, string]> = {
  out_of_range: ["note needing a fold", "notes needing a fold"],
  under_bass: ["note under the bass", "notes under the bass"],
  bass_missing_bars: ["bar with no bass", "bars with no bass"],
};

/** "notes needing a fold 3 -> 2, notes under the bass 1 -> 12" for the gate's inputs that changed. */
function changes(before: Badness, after: Badness): string {
  return (Object.keys(BAD_NAME) as (keyof Badness)[])
    .filter((k) => before[k] !== after[k])
    .map((k) => `${BAD_NAME[k][1]} ${before[k]} \u2192 ${after[k]}`)
    .join(", ");
}

function listing(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** What a plan looks like after the automatic repairs, in words. */
function describe(b: Badness): string {
  const parts: string[] = [];
  const raw = b.out_of_range_raw ?? b.out_of_range;
  if (raw > 0) {
    const byPhrase = raw - b.out_of_range;
    parts.push(
      `${plural(raw, "note", "notes")} out of range` +
        (byPhrase > 0 || b.out_of_range > 0
          ? ` (${[
              byPhrase > 0 ? `${byPhrase} fixed by moving whole phrases an octave` : "",
              b.out_of_range > 0 ? `${b.out_of_range} needed single-note folds` : "",
            ]
              .filter(Boolean)
              .join(", ")})`
          : ""),
    );
  }
  if (b.under_bass > 0) parts.push(plural(b.under_bass, "note", "notes") + " under the bass");
  if (b.bass_missing_bars > 0) parts.push(plural(b.bass_missing_bars, "bar", "bars") + " with no bass");
  return parts.length ? listing(parts) : "nothing out of range and nothing under the bass";
}

const WHAT: Record<string, string> = { range: "notes that needed folds", voicing: "the bass line", structure: "the plan's structure" };

type Step = { name: string; text: string; tone?: "rejected" | "result" };

/** First plan, what the checker found, each AI revision (kept, rejected or failed), the result. */
function loopSteps(r: ArrangeResult): Step[] {
  const c = r.checks;
  const ai = r.planner === "ai";
  const revs = c.revisions ?? [];
  const steps: Step[] = [];

  steps.push(
    ai
      ? { name: "AI plan", text: `First draft${r.model ? ` from ${r.model}` : ""}: who covers each line, bar by bar.` }
      : { name: "Baseline rule", text: "No AI: fixed rules call the highest line the melody and the lowest the bass, rank the rest by activity, and give each line to the free player whose range fits it best." },
  );

  // Successful structure revisions aren't listed; they're the rounds no list entry accounts for.
  const listedCalls = revs.filter((v) => v.kind !== "structure" && !/^planner call failed/.test(v.why)).length;
  const structural = Math.max(0, (c.repair_rounds ?? 0) - listedCalls);
  if (ai && structural > 0) {
    steps.push({
      name: structural === 1 ? "Structure check" : `Structure check, ${structural}\u00D7`,
      text: "Sent back before scoring: a line covered twice, or a melody or bass bar with nobody on it.",
    });
  }

  const fp = c.first_plan;
  if (fp) {
    steps.push({
      name: "Checker",
      text: `Every plan gets the same automatic repairs before it is scored. The ${ai ? "first plan" : "baseline"} then had ${describe(fp)}. Problem count ${problems(fp)}.`,
    });
  } else {
    const before = c.notes_out_of_range_before_repair;
    steps.push({ name: "Checker", text: before > 0 ? `Found ${plural(before, "note", "notes")} out of range.` : "Nothing out of range." });
  }

  for (const v of revs) {
    const what = WHAT[v.kind] ?? v.kind;
    if (/^planner call failed/.test(v.why)) {
      const err = v.why.split(":").slice(1).join(":").trim();
      steps.push({
        tone: "rejected",
        name: "AI revision failed",
        text: `Asked to fix ${what}, but the planner call didn't come back${err ? ` (${err})` : ""}. The previous plan stands.`,
      });
    } else if (!v.after) {
      const n = /^(\d+) structural/.exec(v.why);
      steps.push({
        tone: "rejected",
        name: "AI revision rejected",
        text: `Asked to fix ${what}, but the revised plan failed the structure check${n ? ` (${plural(Number(n[1]), "problem", "problems")})` : ""}. The previous plan stands.`,
      });
    } else {
      const tb = v.total_before ?? (v.before ? problems(v.before) : undefined);
      const ta = v.total_after ?? problems(v.after);
      const delta = v.before ? changes(v.before, v.after) : "";
      steps.push(
        v.kept
          ? {
              name: "AI revision kept",
              text: `Asked to fix ${what}. After the same repairs, problem count ${tb} \u2192 ${ta}${delta ? ` (${delta})` : ""}. Fewer problems, so the checker kept it.`,
            }
          : {
              tone: "rejected",
              name: "AI revision rejected",
              text: `Asked to fix ${what}. After the same repairs, problem count ${tb} \u2192 ${ta}${delta ? ` (${delta})` : ""}: not fewer, so the checker threw it out and kept the previous plan.`,
            },
      );
    }
  }

  if (!ai) {
    steps.push({ name: "No revision loop", text: "The baseline can't re-plan; it only gets the same automatic repairs." });
  }

  const fin = c.final;
  if (fin) {
    const raw = fin.out_of_range_raw ?? 0;
    if (raw > 0) {
      const folded = fin.folded ?? c.notes_folded;
      const byPhrase = raw - fin.out_of_range;
      steps.push({
        name: "Repairs on the final plan",
        text:
          byPhrase > 0 && folded > 0
            ? `${byPhrase} of ${raw} out-of-range notes fixed by moving whole phrases an octave; ${folded} folded one by one as a last resort.`
            : byPhrase > 0
              ? `All ${raw} out-of-range ${raw === 1 ? "note" : "notes"} fixed by moving whole phrases an octave.`
              : `${plural(folded || raw, "out-of-range note", "out-of-range notes")} folded one by one as a last resort; no whole-phrase octave move fit.`,
      });
    }
    const res = [`${c.notes_out_of_range} out of range`, `${fin.under_bass} under the bass`];
    if (fin.bass_missing_bars > 0) res.push(plural(fin.bass_missing_bars, "bar", "bars") + " with no bass");
    steps.push({ name: "Result", text: `${res.join(", ")}. Problem count ${problems(fin)}.`, tone: "result" });
  } else {
    steps.push({ name: "Result", text: `${c.notes_out_of_range} out of range.`, tone: "result" });
  }
  return steps;
}

interface Row {
  label: string;
  def: string;
  value: (r: ArrangeResult) => string;
  show?: (r: ArrangeResult) => boolean;
}

const n = (x: number | null | undefined) => (x === undefined || x === null ? "n/a" : String(x));

const ROWS: Row[] = [
  {
    label: "Out of range, final",
    def: "Notes the player given them can't play, after every repair. Folding brings this to 0 whenever a player's range spans at least an octave.",
    value: (r) => String(r.checks.notes_out_of_range),
  },
  {
    label: "First plan: out of range before any repair",
    def: "As the plan was written, before octave moves or folds.",
    value: (r) => n(r.checks.first_plan?.out_of_range_raw ?? r.checks.notes_out_of_range_before_repair),
  },
  {
    label: "First plan: notes that needed a single-note fold",
    def: "Still out of range after whole phrases were moved an octave.",
    value: (r) => n(r.checks.first_plan?.out_of_range),
    show: (r) => !!r.checks.first_plan,
  },
  {
    label: "Single notes folded, final",
    def: "Notes moved by an octave on their own, as a last resort.",
    value: (r) => n(r.checks.final?.folded ?? r.checks.notes_folded),
  },
  {
    label: "Notes under the bass, final",
    def: "Notes sounding below the bass line where the original has none, checked moment by moment. The original itself scores 0.",
    value: (r) => n(r.checks.final?.under_bass ?? r.checks.bass_inversions),
  },
  {
    label: "Notes under the bass, first plan",
    def: "The same measure on the first plan, after its automatic repairs.",
    value: (r) => n(r.checks.first_plan?.under_bass ?? r.checks.bass_inversions_before_revision),
  },
  {
    label: "Bars with no bass, final",
    def: "Bars where no player carries the original bass line.",
    value: (r) => n(r.checks.final?.bass_missing_bars),
    show: (r) => !!r.checks.final,
  },
  {
    label: "Problem count, first plan to final",
    def: "Single-note folds + notes under the bass + 12 per bar with no bass. An AI revision is kept only if this goes down.",
    value: (r) => (r.checks.first_plan && r.checks.final ? `${problems(r.checks.first_plan)} \u2192 ${problems(r.checks.final)}` : "n/a"),
    show: (r) => !!r.checks.final,
  },
  {
    label: "Harmonic bass preserved",
    def: "Share of the time the cover's lowest note is the same pitch, in any octave, as the original's lowest note.",
    value: (r) => pct(r.checks.essential_coverage.bass),
  },
  {
    label: "Reference melody kept",
    def: "Share of the reference melody bars (mapped from the notes by an AI agent before any plan existed) that some player actually plays.",
    value: (r) => (r.checks.essential_coverage.melody === null ? "no map" : pct(r.checks.essential_coverage.melody)),
  },
  {
    label: "AI revisions kept",
    def: "Each revision gets the same automatic repairs and is kept only if the problem count goes down.",
    value: (r) => {
      if (r.planner !== "ai") return "none";
      const revs = r.checks.revisions ?? [];
      return revs.length ? `${revs.filter((v) => v.kept).length} of ${revs.length}` : "none needed";
    },
  },
  {
    label: "Line handoffs",
    def: "Times a line moves from one player to another. Fewer is easier to rehearse.",
    value: (r) => n(r.checks.handoffs),
    show: (r) => has(r.checks.handoffs),
  },
  {
    label: "Bars of music left out",
    def: "Bars of a line that has notes in the original but that no player plays.",
    value: (r) => n(r.checks.measures_dropped),
    show: (r) => has(r.checks.measures_dropped),
  },
  {
    label: "Chords thinned",
    def: "Double stops reduced to one note for an instrument that plays one at a time.",
    value: (r) => String(r.checks.chords_reduced),
  },
];

function RoleProblems({ result }: { result: ArrangeResult }) {
  const left = result.checks.role_problems_left ?? [];
  if (!left.length) return null;
  return (
    <div className="issues-block">
      <p className="issues-title">Melody or bass the plan still leaves out</p>
      <ul className="issues">
        {left.slice(0, 5).map((t, i) => (
          <li key={i}>{t}</li>
        ))}
        {left.length > 5 && <li>and {left.length - 5} more</li>}
      </ul>
    </div>
  );
}

function Violations({ c, result }: { c: C; result: ArrangeResult }) {
  const players = playerById(result);
  if (!c.violations?.length) return null;
  return (
    <ul className="issues">
      {c.violations.slice(0, 6).map((v, i) => (
        <li key={i}>
          {players.get(v.player)?.label ?? v.player}, {mm(v.measure, v.measure)}: {prettyPitch(v.pitch)}, outside{" "}
          {prettyRange(v.range_sounding)} (concert)
        </li>
      ))}
      {c.violations.length > 6 && <li>and {c.violations.length - 6} more</li>}
    </ul>
  );
}

function VoicingIssues({ result }: { result: ArrangeResult }) {
  const players = playerById(result);
  const sources = sourceById(result);
  const seen = new Set<string>();
  const issues = (result.checks.voicing_issues ?? []).filter((v) => {
    const k = JSON.stringify(v);
    return seen.has(k) ? false : (seen.add(k), true);
  });
  if (!issues.length) return null;
  const who = (id: string) => players.get(id)?.label ?? id;
  // measures: "10", "9-10" or "10, 17, 19"
  const bars = (s: string) => (/[-,]/.test(s) ? `mm.\u00A0${s.replace(/-/g, "\u2013")}` : `m.\u00A0${s}`);
  return (
    <div className="issues-block">
      <p className="issues-title">Left under the bass after checking</p>
      <ul className="issues">
        {issues.slice(0, 5).map((v, i) => {
          // bass_line: "P3" or "P3 on tp1/tp2" (source line, then who carries it)
          const [src, carriers] = v.bass_line.split(" on ");
          const line = sources.get(src)?.name ?? src;
          const carriedBy = carriers ? ` (played by ${carriers.split("/").map(who).join(" and ")})` : "";
          const semis = Math.round(v.max_semitones);
          return (
            <li key={i}>
              {v.kind === "bass_missing"
                ? `The ${line} bass line has no player, ${bars(v.measures)}.`
                : `${who(v.player ?? "")} sounds under the ${line} bass line${carriedBy}, ${bars(v.measures)}: ${plural(
                    v.events,
                    "note",
                    "notes",
                  )}, up to ${plural(semis, "semitone", "semitones")} below.`}
            </li>
          );
        })}
        {issues.length > 5 && <li>and {issues.length - 5} more</li>}
      </ul>
    </div>
  );
}

export function Checks({ result, other }: Props) {
  const c = result.checks;
  const clean = c.notes_out_of_range === 0;
  const cols = !other ? [result] : result.planner === "ai" ? [result, other] : [other, result];
  const steps = loopSteps(result);
  const rows = ROWS.filter((row) => !row.show || cols.some((r) => row.show!(r)));

  return (
    <div className={`checks ${clean ? "checks--clean" : "checks--fail"}`}>
      <div className="verdict" aria-live="polite">
        <p className="verdict-figure">
          <span className="verdict-n">{c.notes_out_of_range}</span>
          <span className="verdict-of">
            of {c.notes_total} notes
            <br />
            out of range
          </span>
        </p>
        {has(c.bass_inversions) && (
          <p className="verdict-second">
            <span className="verdict-second-n">{c.bass_inversions}</span>{" "}
            {c.bass_inversions === 1 ? "note sounds" : "notes sound"} under the bass line
          </p>
        )}
        <p className="verdict-text">
          {clean
            ? "Every note sits inside the written range of the player it was given to, checked one by one."
            : `${plural(c.notes_out_of_range, "note is", "notes are")} still outside a player's range; a player would have to skip or fake ${c.notes_out_of_range === 1 ? "it" : "them"}.`}
        </p>
        <Violations c={c} result={result} />
      </div>

      <div className="loop-wrap">
        <p className="loop-title">How it got there</p>
        <ol className="loop">
          {steps.map((s, i) => (
            <li key={i} className={`loop-step ${s.tone ? `loop-step--${s.tone}` : ""}`}>
              <span className="loop-name">{s.name}</span>
              <span className="loop-text">{s.text}</span>
            </li>
          ))}
        </ol>
        <RoleProblems result={result} />
        <VoicingIssues result={result} />
      </div>

      <div className="ledger-wrap">
        <table className="ledger">
          <caption className="sr-only">Arrangement checks{other ? ", compared across planners" : ""}</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Check</span>
              </th>
              {cols.map((r) => (
                <th scope="col" key={r.planner} className={r.planner === result.planner ? "is-current" : ""}>
                  {PLANNER_LABEL[r.planner]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  <span className="ledger-label">{row.label}</span>
                  <span className="ledger-def">{row.def}</span>
                </th>
                {cols.map((r) => (
                  <td key={r.planner} className={r.planner === result.planner ? "is-current" : ""}>
                    {row.value(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!other && <p className="ledger-note">No precomputed {result.planner === "ai" ? "baseline" : "AI plan"} for these players to compare against.</p>}
      </div>
    </div>
  );
}
