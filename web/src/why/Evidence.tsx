import { Scoreboard } from "../Scoreboard";
import type { DemoIndex } from "../types";
import { section } from "./copy";
import { useComparison, useResult } from "./hooks";
import { SectionShell, type Values } from "./Prose";

const REPO = "https://github.com/ryanonline1234/cover-part/blob/main/";

/** Pipeline steps; each links to the repo files that implement it. Labels only, no claims with numbers. */
const STEPS: Array<{ k: string; title: string; who: "code" | "ai"; body: string; files: string[] }> = [
  {
    k: "Read",
    title: "Read the score",
    who: "code",
    body: "music21 cuts the excerpt and summarizes every line, four bars at a time: range, activity, which lines double which.",
    files: ["engine/coverpart/score_io.py"],
  },
  {
    k: "Plan",
    title: "AI plans the cover",
    who: "ai",
    body: "Claude reads the summaries and the band, decides which line is the melody, what to keep, and who plays what. It returns a plan, not notes.",
    files: ["engine/coverpart/planner_ai.py", "engine/coverpart/arranger_rules.md"],
  },
  {
    k: "Check",
    title: "Code checks and repairs",
    who: "code",
    body: "Every note of every part against every player's range; at most one line per player at a time; notes sounding under the bass are counted. Whole phrases move by octaves; single-note folds are a counted last resort.",
    files: ["engine/coverpart/plan.py", "engine/coverpart/execute.py"],
  },
  {
    k: "Revise",
    title: "Kept only if fewer problems",
    who: "code",
    body: "Leftover problems go back to the AI. A revision is kept only if, after the same repairs, the problem count goes down.",
    files: ["engine/coverpart/arrange.py"],
  },
  {
    k: "Parts",
    title: "One part per player",
    who: "code",
    body: "Transposed to written pitch with the right clef, plus a colored full score and audio.",
    files: ["engine/coverpart/export.py", "engine/coverpart/instruments.py"],
  },
];

export function Evidence({ index }: { index: DemoIndex | null }) {
  const cmp = useComparison();
  const sample = useResult(index ? `${index.pieces[0]?.id}__${index.rosters[0]?.id}__ai` : null, !!index);
  const values: Values = {
    n_pieces: index?.pieces.length,
    n_bands: index?.rosters.length,
    n_pairs: cmp?.n_pairs,
    model: sample.data?.model ?? null,
  };
  const onPick = (piece: string, roster: string) => {
    const q = new URLSearchParams({ piece, band: roster });
    window.location.hash = `#/?${q.toString()}`;
  };

  return (
    <SectionShell
      id="evidence"
      index="§5"
      kicker="Evidence"
      source="data: demos/comparison.json · engine/coverpart/report.py"
      section={section("evidence")}
      values={values}
      wide
    >
      <div className="why-evidence">
        <figure className="why-pipe" aria-label="How it works">
          <ol>
            {STEPS.map((s, k) => (
              <li key={s.k} className={`why-pipe-step is-${s.who}`}>
                <span className="why-pipe-n">{k + 1}</span>
                <p className="why-pipe-who">{s.who === "ai" ? "AI" : "Plain code"}</p>
                <p className="why-pipe-t">{s.title}</p>
                <p className="why-pipe-b">{s.body}</p>
                <p className="why-pipe-files">
                  {s.files.map((f) => (
                    <a key={f} href={`${REPO}${f}`} target="_blank" rel="noreferrer">
                      {f.split("/").pop()}
                    </a>
                  ))}
                </p>
              </li>
            ))}
          </ol>
          <figcaption className="why-cap">
            The AI only decides; code does everything that can be checked. The no-AI baseline (
            <a href={`${REPO}engine/coverpart/planner_greedy.py`} target="_blank" rel="noreferrer">
              planner_greedy.py
            </a>
            ) gets the same reading, checks, repairs and parts, but no revision loop. Scoreboard:{" "}
            <a href={`${REPO}engine/coverpart/report.py`} target="_blank" rel="noreferrer">
              report.py
            </a>
            .
          </figcaption>
        </figure>

        <div className="why-board">
          {cmp && index ? <Scoreboard data={cmp} index={index} current={null} onPick={onPick} /> : <p className="why-loading">Loading the scoreboard…</p>}
        </div>
      </div>
    </SectionShell>
  );
}
