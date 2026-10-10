import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Side } from "../audio";
import type { Badness, DemoIndex, Revision } from "../types";
import { candidatesOf, chosenOf, qualifies, type Candidate } from "./candidates";
import { section } from "./copy";
import { loadResult, useABPlayer, useComparison, useNear, useResult } from "./hooks";
import { verdict } from "../Scoreboard";
import { BASS_MISSING_WEIGHT, mean1, shortPiece, totalProblems } from "./metrics";
import { SectionShell, type Values } from "./Prose";
import { PlayButton, shortBand, Switch } from "./Transport";

/**
 * Which pair demo 3 shows: the first in this order whose KEPT plan has at least one rejected and one kept
 * revision (so the stepper shows both outcomes of the gate), then any other pair in index order.
 * Decided from the data at load time, never hand-picked per rebuild.
 */
export const DEMO3_PREFERENCE: Array<{ piece: string; band: string }> = [
  { piece: "osq-haydn-op76no3-ii-m0-20", band: "church_brass" }, // Haydn "Emperor" theme
  { piece: "osq-hensel-eflat-iii-m1-16", band: "church_brass" },
  { piece: "osq-haydn-op20no2-i-m0-14", band: "church_brass" },
  { piece: "osq-dvorak-op96-ii-m1-18", band: "church_brass" }, // Dvořák Lento
];

interface Pick {
  piece: string;
  band: string;
  /** Position in the search order (0 = the first preference). */
  rank: number;
  qualifies: boolean;
}

function useDemoPair(index: DemoIndex | null, enabled: boolean): Pick | null {
  const [pick, setPick] = useState<Pick | null>(null);
  useEffect(() => {
    if (!enabled || !index) return;
    let cancelled = false;
    const order = [...DEMO3_PREFERENCE];
    for (const p of index.pieces)
      for (const r of index.rosters)
        if (!order.some((x) => x.piece === p.id && x.band === r.id) && p.results.some((x) => x.roster_id === r.id && x.planner === "ai"))
          order.push({ piece: p.id, band: r.id });
    void (async () => {
      for (let k = 0; k < order.length; k++) {
        const r = await loadResult(`${order[k].piece}__${order[k].band}__ai`).catch(() => null);
        if (cancelled) return;
        if (qualifies(r)) {
          setPick({ ...order[k], rank: k, qualifies: true });
          return;
        }
      }
      if (!cancelled) setPick({ ...order[0], rank: 0, qualifies: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [index, enabled]);
  return pick;
}

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

const listing = (xs: Array<string | number>) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** The AI's plans for this pair, each after its own revision loop; the kept one marked. */
function Candidates({ cands }: { cands: Candidate[] }) {
  const max = Math.max(1, ...cands.map((c) => c.total ?? 0));
  const ok = cands.filter((c) => c.total !== null);
  const best = ok.length ? Math.min(...ok.map((c) => c.total as number)) : null;
  const tied = ok.filter((c) => c.total === best);
  const chosen = chosenOf(cands);
  // candidate_key's last tie-break is the earlier plan, when problems, line-bars and hand-offs all tie.
  const sameKey = (a: Candidate, b: Candidate) => a.dropped === b.dropped && a.handoffs === b.handoffs;
  const fully = chosen ? tied.filter((t) => sameKey(t, chosen)) : [];
  let tieNote = "";
  if (chosen && tied.length > 1) {
    tieNote =
      fully.length === tied.length
        ? ` Plans ${listing(tied.map((c) => c.n))} tie on ${best} problems, and also on line-bars left out (${chosen.dropped ?? "–"}) and hand-offs (${chosen.handoffs ?? "–"}), so the plan written first is kept.`
        : ` Plans ${listing(tied.map((c) => c.n))} tie on ${best} problems; the tie goes to fewer line-bars left out (${listing(
            tied.map((c) => c.dropped ?? "–"),
          )}), then fewer hand-offs (${listing(tied.map((c) => c.handoffs ?? "–"))})${fully.length > 1 ? ", then the plan written first" : ""}.`;
  }
  return (
    <figure className="why-cands" data-figure="candidates" aria-label="The AI's plans for this pair, and the one the checker kept">
      <p className="why-cands-h">
        <span className="why-cands-k">Best of {cands.length}</span>
        The AI wrote {cands.length} plans on its own. Each went through the same revision loop (shown below for the kept plan), and
        the checker kept the one with the fewest problems.
      </p>
      <div className="why-cands-rows">
        {cands.map((c) => (
          <div
            key={c.n}
            className={`why-cand-row${c.chosen ? " is-chosen" : ""}`}
            data-cand={c.n}
            data-total={c.total ?? ""}
            data-chosen={c.chosen ? "true" : "false"}
          >
            <span className="why-cand-l">Plan {c.n}</span>
            <span className="why-cand-track">
              {c.total !== null && <span className="why-cand-bar" style={{ transform: `scaleX(${c.total / max})` } as CSSProperties} />}
            </span>
            <span className="why-num">{c.total ?? "–"}</span>
            <span className="why-cand-tag">{c.chosen ? "Kept" : c.error ? "Failed" : ""}</span>
          </div>
        ))}
      </div>
      <figcaption className="why-cap">
        Problems after each plan's own loop and repairs (same count as below).
        {tieNote}{" "}
        The choice never looks at the reference melody map.
      </figcaption>
    </figure>
  );
}

export function AskAI({ index }: { index: DemoIndex | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const pick = useDemoPair(index, near);
  const aiId = pick ? `${pick.piece}__${pick.band}__ai` : null;
  const gId = pick ? `${pick.piece}__${pick.band}__greedy` : null;
  const ai = useResult(aiId, near);
  const g = useResult(gId, near);
  const cmp = useComparison();
  const [i, setI] = useState(0);
  const [side, setSide] = useState<Side>("arranged");
  const player = useABPlayer(g.data?.midi.arranged, ai.data?.midi.arranged, ai.data?.musicxml.original, side);
  useEffect(() => setI(0), [aiId]);

  const cands = candidatesOf(ai.data);
  const chosen = chosenOf(cands);
  // The kept plan's own loop is the result's top-level first_plan / revisions / final.
  const c = ai.data?.checks;
  const loop = c ? { first_plan: c.first_plan ?? null, revisions: c.revisions ?? [], final: c.final ?? null } : null;

  const steps: Step[] = [];
  if (loop?.first_plan) steps.push({ kind: "draft", label: "First draft", bad: loop.first_plan, total: totalProblems(loop.first_plan) });
  (loop?.revisions ?? []).forEach((rev, k) =>
    steps.push({
      kind: "revision",
      label: `Revision ${k + 1}`,
      rev,
      total: rev.total_after ?? (rev.after ? totalProblems(rev.after) : null),
    }),
  );
  if (loop?.final) steps.push({ kind: "final", label: "Final", bad: loop.final, total: totalProblems(loop.final) });
  const gFinal = g.data?.checks.final ?? null;
  const gTotal = gFinal ? totalProblems(gFinal) : null;
  const step = steps[Math.min(i, Math.max(0, steps.length - 1))];
  const maxTotal = Math.max(1, ...steps.map((s) => s.total ?? 0), gTotal ?? 0);
  const values: Values = { ai_id: aiId, g_id: gId, bass_w: BASS_MISSING_WEIGHT };
  if (ai.data) {
    Object.assign(values, { pair_piece: shortPiece(ai.data), pair_band: shortBand(ai.data.roster.label) });
  }
  if (cands.length > 1 && chosen) {
    Object.assign(values, {
      n_cand: cands.length,
      cand_totals: listing(cands.map((x) => (x.total === null ? `none (plan ${x.n} failed)` : `${x.total} (plan ${x.n})`))),
      chosen_n: chosen.n,
    });
  }
  if (loop?.first_plan && loop.final) {
    const revs = loop.revisions;
    Object.assign(values, {
      fp_total: totalProblems(loop.first_plan),
      fp_oor: loop.first_plan.out_of_range,
      fp_under: loop.first_plan.under_bass,
      fp_missing: loop.first_plan.bass_missing_bars,
      rev_count: revs.length,
      rev_kept: revs.filter((r) => r.kept).length,
      rev_rejected: revs.filter((r) => !r.kept).length,
      final_total: totalProblems(loop.final),
    });
  }
  if (gTotal !== null) values.g_total = gTotal;
  const fuMetric = cmp?.metrics.find((m) => m.key === "first_unfit");
  if (cmp) {
    // Same rule as the scoreboard's summary (within one pair, or the same mean as shown, is about even).
    const v = fuMetric && cmp.totals.first_unfit ? verdict(cmp, fuMetric) : null;
    const fu = cmp.totals.first_unfit;
    Object.assign(values, {
      fu_cmp: v === "even" ? "about even" : v === "ai" ? "the AI ahead" : v === "base" ? "the rule-based plan ahead" : null,
      fu_ai_better: fu?.ai_better,
      fu_g_better: fu?.greedy_better,
      fu_tie: fu?.tie,
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
      source={aiId && gId ? `data: demos/${aiId}.json → checks.candidates, first_plan, revisions, final · demos/${gId}.json → checks.final` : undefined}
      section={section("ask-an-ai")}
      values={values}
    >
      <div className="why-panel" ref={ref} data-demo="ask-an-ai" data-step={i} data-pair={pick ? `${pick.piece}__${pick.band}` : ""}>
        <div className="why-panel-head">
          <p className="why-panel-title">{ai.data ? `${shortPiece(ai.data)} · ${ai.data.roster.label}` : "Loading…"}</p>
        </div>
        {pick && pick.rank > 0 && pick.qualifies && ai.data && (
          <p className="why-cap why-pair-why" data-pair-rank={pick.rank}>
            This pair is shown because its kept plan went through both a kept and a rejected revision. The scoreboard in §5 has every
            pair.
          </p>
        )}
        {(ai.error || g.error) && <p className="why-error">{ai.error ?? g.error}</p>}

        {cands.length > 1 && <Candidates cands={cands} />}

        {steps.length > 0 && (
          <>
            {chosen && cands.length > 1 && (
              <p className="why-cands-then" data-loop-of={chosen.n}>
                Plan {chosen.n}, the one kept, step by step:
              </p>
            )}
            <ol className="why-steps" aria-label="Steps of the revision loop">
              {steps.map((s, k) => (
                <li key={k}>
                  <button
                    type="button"
                    className={`why-step${k === i ? " is-on" : ""}${s.kind === "revision" ? (s.rev.kept ? " is-kept" : " is-rejected") : ""}`}
                    aria-current={k === i ? "step" : undefined}
                    onClick={() => setI(k)}
                    data-step={k}
                    data-rev={s.kind === "revision" ? (s.rev.kept ? "kept" : "rejected") : undefined}
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
                      {chosen ? "What the band gets: the plan the checker kept." : "What the band gets."}{" "}
                      {c ? `Single notes folded by an octave as a last resort: ${c.notes_folded}. Notes out of range in the parts: ${c.notes_out_of_range}.` : ""}
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
              { value: "arranged", label: chosen ? "AI plan, the one kept" : "AI plan, final" },
            ]}
          />
          <PlayButton player={player} label="Play" id="ask-an-ai" />
        </div>
      </div>
    </SectionShell>
  );
}

