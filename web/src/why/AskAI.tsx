import { useRef, useState, type CSSProperties } from "react";
import type { Side } from "../audio";
import type { Badness, Revision } from "../types";
import { section } from "./copy";
import { useABPlayer, useComparison, useNear, useResult } from "./hooks";
import { BASS_MISSING_WEIGHT, mean1, shortPiece, totalProblems } from "./metrics";
import { SectionShell, type Values } from "./Prose";
import { PlayButton, Switch } from "./Transport";

export const DEMO3 = { piece: "osq-haydn-op76no3-ii-m0-20", band: "church_brass" };

type Step =
  | { kind: "draft"; label: string; bad: Badness; total: number }
  | { kind: "revision"; label: string; rev: Revision; total: number | null }
  | { kind: "final"; label: string; bad: Badness; total: number };

const KIND: Record<string, string> = { range: "range", voicing: "voicing", structure: "structure" };

function Ledger({ before, after }: { before: Badness | null; after?: Badness | null }) {
  const rows: Array<{ key: string; label: string; get: (b: Badness) => number }> = [
    { key: "out_of_range", label: "Notes still out of range after the octave repair", get: (b) => b.out_of_range },
    { key: "under_bass", label: "Notes sounding under the bass", get: (b) => b.under_bass },
    { key: "bass_missing_bars", label: `Bars with no bass (each counts ${BASS_MISSING_WEIGHT})`, get: (b) => b.bass_missing_bars },
  ];
  const two = after !== undefined;
  return (
    <table className="why-ledger">
      <thead>
        <tr>
          <th scope="col">Checked by code</th>
          <th scope="col" className="why-num">{two ? "Before" : "Count"}</th>
          {two && <th scope="col" className="why-num">After</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-metric={r.key}>
            <th scope="row">{r.label}</th>
            <td className="why-num">{before ? r.get(before) : "–"}</td>
            {two && <td className="why-num">{after ? r.get(after) : "–"}</td>}
          </tr>
        ))}
        <tr className="why-ledger-total" data-metric="total">
          <th scope="row">Problems</th>
          <td className="why-num">{before ? totalProblems(before) : "–"}</td>
          {two && <td className="why-num">{after ? totalProblems(after) : "–"}</td>}
        </tr>
      </tbody>
    </table>
  );
}

export function AskAI() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const aiId = `${DEMO3.piece}__${DEMO3.band}__ai`;
  const gId = `${DEMO3.piece}__${DEMO3.band}__greedy`;
  const ai = useResult(aiId, near);
  const g = useResult(gId, near);
  const cmp = useComparison();
  const [i, setI] = useState(0);
  const [side, setSide] = useState<Side>("arranged");
  const player = useABPlayer(g.data?.midi.arranged, ai.data?.midi.arranged, ai.data?.musicxml.original, side);

  const steps: Step[] = [];
  const c = ai.data?.checks;
  if (c?.first_plan) steps.push({ kind: "draft", label: "First draft", bad: c.first_plan, total: totalProblems(c.first_plan) });
  (c?.revisions ?? []).forEach((rev, k) =>
    steps.push({
      kind: "revision",
      label: `Revision ${k + 1}`,
      rev,
      total: rev.total_after ?? (rev.after ? totalProblems(rev.after) : null),
    }),
  );
  if (c?.final) steps.push({ kind: "final", label: "Final", bad: c.final, total: totalProblems(c.final) });
  const gFinal = g.data?.checks.final ?? null;
  const gTotal = gFinal ? totalProblems(gFinal) : null;
  const step = steps[Math.min(i, Math.max(0, steps.length - 1))];
  const maxTotal = Math.max(1, ...steps.map((s) => s.total ?? 0), gTotal ?? 0);

  const values: Values = { ai_id: aiId, g_id: gId };
  if (c?.first_plan && c.final) {
    const revs = c.revisions ?? [];
    Object.assign(values, {
      fp_total: totalProblems(c.first_plan),
      fp_oor: c.first_plan.out_of_range,
      fp_under: c.first_plan.under_bass,
      fp_missing: c.first_plan.bass_missing_bars,
      rev_count: revs.length,
      rev_kept: revs.filter((r) => r.kept).length,
      rev_rejected: revs.filter((r) => !r.kept).length,
      final_total: totalProblems(c.final),
      final_folded: c.notes_folded,
    });
  }
  if (gTotal !== null) values.g_total = gTotal;
  if (cmp) {
    Object.assign(values, {
      fu_ai: mean1(cmp.totals.first_unfit?.ai_mean),
      fu_g: mean1(cmp.totals.first_unfit?.greedy_mean),
      fold_ai: mean1(cmp.totals.folded?.ai_mean),
      fold_g: mean1(cmp.totals.folded?.greedy_mean),
    });
  }

  return (
    <SectionShell
      id="ask-an-ai"
      index="§3"
      kicker="Demo · the checker has the last word"
      source={`data: demos/${aiId}.json → checks.first_plan, revisions, final · demos/${gId}.json → checks.final`}
      section={section("ask-an-ai")}
      values={values}
    >
      <div className="why-panel" ref={ref} data-demo="ask-an-ai" data-step={i}>
        <div className="why-panel-head">
          <p className="why-panel-title">
            {ai.data ? `${shortPiece(ai.data)} · ${ai.data.roster.label}` : "Loading…"}
          </p>
        </div>
        {(ai.error || g.error) && <p className="why-error">{ai.error ?? g.error}</p>}

        {steps.length > 0 && (
          <>
            <ol className="why-steps" aria-label="Steps of the revision loop">
              {steps.map((s, k) => (
                <li key={k}>
                  <button
                    type="button"
                    className={`why-step${k === i ? " is-on" : ""}${s.kind === "revision" ? (s.rev.kept ? " is-kept" : " is-rejected") : ""}`}
                    aria-current={k === i ? "step" : undefined}
                    onClick={() => setI(k)}
                    data-step={k}
                  >
                    <span className="why-step-n">{k + 1}</span>
                    <span className="why-step-l">
                      {s.label}
                      {s.kind === "revision" && <small>{KIND[s.rev.kind] ?? s.rev.kind} · {s.rev.kept ? "kept" : "rejected"}</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            <div className="why-loop">
              <div className="why-loop-detail" key={i}>
                {step.kind === "draft" && (
                  <>
                    <p className="why-loop-head">
                      The AI's first plan, after the same deterministic octave repair every plan gets.
                      {step.bad.out_of_range_raw !== undefined && ` Before that repair: ${step.bad.out_of_range_raw} notes out of range.`}
                    </p>
                    <Ledger before={step.bad} />
                  </>
                )}
                {step.kind === "revision" && (
                  <>
                    <p className="why-loop-head">
                      The checker sends the remaining {KIND[step.rev.kind] ?? step.rev.kind} problems back to the AI. The revised plan gets
                      the same repairs, then is scored.
                    </p>
                    <Ledger before={step.rev.before} after={step.rev.after} />
                    <p className={`why-verdict ${step.rev.kept ? "is-kept" : "is-rejected"}`} data-verdict={step.rev.kept ? "kept" : "rejected"}>
                      <b>{step.rev.kept ? "Kept" : "Rejected"}</b>
                      <span>
                        {step.rev.total_before !== undefined && step.rev.total_after !== undefined
                          ? `${step.rev.total_before} → ${step.rev.total_after} problems${step.rev.kept ? "" : " (not fewer)"}`
                          : step.rev.why}
                      </span>
                    </p>
                  </>
                )}
                {step.kind === "final" && (
                  <>
                    <p className="why-loop-head">
                      What the band gets. {c ? `Single notes folded by an octave as a last resort: ${c.notes_folded}. Notes out of range in the parts: ${c.notes_out_of_range}.` : ""}
                    </p>
                    <Ledger before={step.bad} />
                  </>
                )}
              </div>

              <figure className="why-totals" aria-label="Problems at each step">
                {steps.map((s, k) => (
                  <div
                    key={k}
                    className={`why-total-row${k === i ? " is-on" : ""}${s.kind === "revision" && !s.rev.kept ? " is-rejected" : ""}`}
                    data-total={s.total ?? ""}
                  >
                    <span className="why-total-l">{s.label}</span>
                    <span className="why-total-track">
                      <span className="why-total-bar" style={{ transform: `scaleX(${(s.total ?? 0) / maxTotal})` } as CSSProperties} />
                    </span>
                    <span className="why-num">{s.total ?? "–"}</span>
                  </div>
                ))}
                {gTotal !== null && (
                  <div className="why-total-row is-baseline" data-total={gTotal} data-row="greedy">
                    <span className="why-total-l">Rule-based plan</span>
                    <span className="why-total-track">
                      <span className="why-total-bar" style={{ transform: `scaleX(${gTotal / maxTotal})` } as CSSProperties} />
                    </span>
                    <span className="why-num">{gTotal}</span>
                  </div>
                )}
                <figcaption className="why-cap">
                  Problems = still out of range + under the bass + {BASS_MISSING_WEIGHT} × bars with no bass, after the same repairs. A
                  revision is kept only if this goes down.
                </figcaption>
              </figure>
            </div>

            <div className="why-controls">
              <button type="button" className="why-btn" onClick={() => setI((k) => Math.max(0, k - 1))} disabled={i === 0} data-nav="prev">
                ← Back
              </button>
              <button
                type="button"
                className="why-btn"
                onClick={() => setI((k) => Math.min(steps.length - 1, k + 1))}
                disabled={i >= steps.length - 1}
                data-nav="next"
              >
                Next step →
              </button>
            </div>
          </>
        )}

        <div className="why-panel-foot">
          <Switch
            label="Which plan to hear"
            id="ask-an-ai"
            value={side}
            onChange={setSide}
            options={[
              { value: "original", label: "Rule-based plan" },
              { value: "arranged", label: "AI plan, final" },
            ]}
          />
          <PlayButton player={player} label="Play" id="ask-an-ai" />
        </div>
      </div>
    </SectionShell>
  );
}
