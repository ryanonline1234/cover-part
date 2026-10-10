// All prose on the why page lives here.
//
//   heading  a short draft heading (Ryan may change it)
//   facts    verified facts, each ending in [source: ...]. Shown as the section's numbered points; the
//            [source: ...] part shows only when the reader turns on "Show sources" (top of the page).
//   text     EMPTY until Ryan writes it. When non-empty it is shown above the facts. Blank lines split paragraphs.
//
// Numbers are never typed here. A {{token}} is filled in by the page from the result / comparison JSON
// (the tokens each section offers are listed above it). Tokens work in `text` too.

/**
 * Who wrote the reference melody map that every melody score on the page is measured against (stated
 * wherever the map is used). Source: corpus/manifest.json → melody_map; notes-local/video/ground/facts.md G5.
 */
export const REFERENCE_MAP = {
  /** One sentence for facts. */
  fact: "The reference melody map was written by a separate Claude Code agent reading the notes, before any plan existed. No musician has checked it.",
  /** Under "Where the tune is" on the melody timelines. */
  label: "reference map, written by a Claude Code agent",
  /** Legend line beside the timelines. */
  legend: "Reference map: written by a separate Claude Code agent reading the notes, before any plan existed; not checked by a musician.",
};

export interface Section {
  id: string;
  heading: string;
  facts: string[];
  text: string;
}

export const SECTIONS: Section[] = [
  {
    // tokens: n_pieces, n_bands, band_list, line_names, piece, band, v1_range, cello_range, band_hi, band_hi_player, band_lo,
    //         band_lo_player, result_id
    id: "situation",
    heading: "Music written for one group, played by another",
    facts: [
      "The demo excerpts are {{n_pieces}} passages from string quartets, each written for four lines: {{line_names}}. [source: demos/index.json → pieces; demos/{{result_id}}.json → source_parts]",
      "The {{n_bands}} sample bands: {{band_list}}. [source: demos/index.json → rosters]",
      "In {{piece}}, Violin 1 plays {{v1_range}} and the cello {{cello_range}}. Band “{{band}}”: the highest note anyone has is {{band_hi}} ({{band_hi_player}}), the lowest {{band_lo}} ({{band_lo_player}}). All sounding pitch. [source: demos/{{result_id}}.json → musicxml.original, roster.players[].range_sounding]",
    ],
    text: "",
  },
  {
    // tokens: piece, band, mapping, asw_oor, asw_total, asw_worst_player, asw_worst_count, asw_id,
    //         ai_oor, ai_folded, ai_dropped, ai_id
    id: "as-written",
    heading: "Hand the parts out as written",
    facts: [
      "Handing {{piece}} to {{band}} line for line ({{mapping}}): {{asw_oor}} of {{asw_total}} notes are outside the player's assumed range. [source: demos/{{asw_id}}.json → checks.notes_out_of_range, checks.notes_total]",
      "The most land on one player: {{asw_worst_player}}, {{asw_worst_count}} notes. [source: demos/{{asw_id}}.json → checks.violations]",
      "Each player's range is a typical school-level range assumed for their level (beginner, intermediate or advanced), not a hard limit. In the tool you set each player's level. [source: engine/coverpart/instruments.py → ranges per level; README.md → Limits]",
      "Cover Part's version for the same band: notes out of range {{ai_oor}}; single notes moved by an octave as a last resort {{ai_folded}}; line-bars left out {{ai_dropped}} (a line-bar is one bar of one original line). [source: demos/{{ai_id}}.json → checks.notes_out_of_range, notes_folded, measures_dropped]",
      "Zero out of range is guaranteed by construction: code repairs whatever the plan leaves. The honest numbers are the notes it had to fold and the line-bars it left out. [source: DECISIONS.md, 2026-10-10]",
    ],
    text: "",
  },
  {
    // tokens: handoff_from, handoff_to, handoff_bar, band, ref_bars, g_hit, g_pct, ai_hit, ai_pct, ai_id, g_id,
    //         n_pairs, all_ai_pct, all_g_pct, all_ai_better, all_g_better, all_tie, n_bands
    id: "simple-rule",
    heading: "Why not a simple rule?",
    facts: [
      "In the Lento of Dvořák's “American” Quartet the tune moves from {{handoff_from}} to {{handoff_to}} at bar {{handoff_bar}}, according to the reference melody map. [source: corpus/manifest.json → melody_map]",
      `${REFERENCE_MAP.fact} [source: corpus/manifest.json → melody_map]`,
      "The rule-based plan treats the top line as the melody. For {{band}} it labels {{g_hit}} of the {{ref_bars}} reference melody bars as melody ({{g_pct}}); the AI plan labels {{ai_hit}} ({{ai_pct}}). [source: demos/{{g_id}}.json, demos/{{ai_id}}.json → plan.roles; corpus/manifest.json → melody_map]",
      "Over all {{n_pairs}} piece-and-band pairs, melody identified against the same reference map: AI {{all_ai_pct}}, rule-based {{all_g_pct}}. AI better in {{all_ai_better}} pairs, rule-based in {{all_g_better}}, tied in {{all_tie}}. [source: demos/comparison.json → totals.melody_id]",
      "This rule-based plan is the one a band you build yourself gets in the tool, made and checked live. The AI plans are precomputed for the {{n_bands}} sample bands only. [source: demos/index.json → rosters; DECISIONS.md, 2026-10-10 (redesign)]",
    ],
    text: "",
  },
  {
    // tokens: pair_piece, pair_band, n_cand, cand_totals, chosen_n, fp_total, fp_oor, fp_under, fp_missing, rev_count,
    //         rev_kept, rev_rejected, final_total, g_total, ai_id, g_id, fu_cmp, fu_ai_better, fu_g_better, fu_tie, fu_ai, fu_g,
    //         fold_ai, fold_g, bass_w
    id: "ask-an-ai",
    heading: "Why not just ask an AI?",
    facts: [
      "For each sample pair the AI writes {{n_cand}} plans on its own. Each goes through the same revision loop and repairs, and the checker keeps the one with the fewest problems; a tie goes to fewer line-bars left out, then fewer hand-offs. The choice never looks at the reference melody map. [source: demos/{{ai_id}}.json → checks.candidates, selection_rule; engine/coverpart/arrange.py → AI_CANDIDATES, candidate_key]",
      "{{pair_piece}}, band “{{pair_band}}”: after each plan's own loop, the problem counts were {{cand_totals}}. The checker kept plan {{chosen_n}}. [source: demos/{{ai_id}}.json → checks.candidates[].total_final, chosen]",
      "That plan's first draft still had {{fp_total}} problems after the octave repair: {{fp_oor}} notes out of range, {{fp_under}} notes under the bass, {{fp_missing}} bars with no bass. [source: demos/{{ai_id}}.json → checks.first_plan (the kept plan's)]",
      "Problems = notes still out of range + notes under the bass + {{bass_w}} × bars with no bass. [source: engine/coverpart/arrange.py → total_problems, BASS_MISSING_WEIGHT]",
      "Revisions the checker asked for on that plan: {{rev_count}}. Kept: {{rev_kept}}; rejected: {{rev_rejected}}. A revision is kept only if the total goes down. [source: demos/{{ai_id}}.json → checks.revisions (the kept plan's)]",
      "Final AI plan: {{final_total}} problems. Rule-based plan for the same band: {{g_total}}. [source: demos/{{ai_id}}.json, demos/{{g_id}}.json → checks.final]",
      "The scoreboard's first-draft numbers use the first plan the AI wrote, before the checker chooses, so picking the best of {{n_cand}} doesn't flatter them. Over all pairs, those drafts needed fewer single-note folds than the rule-based plan in {{fu_ai_better}} pairs and more in {{fu_g_better}} ({{fu_tie}} tied): {{fu_cmp}}. Averages {{fu_ai}} vs {{fu_g}}; in the final parts, {{fold_ai}} vs {{fold_g}}. [source: demos/comparison.json → totals.first_unfit, totals.folded; demos/*__ai.json → checks.first_plan_unselected; engine/coverpart/report.py]",
    ],
    text: "",
  },
  {
    // tokens: drop_lead, drop_ai_mean, drop_g_mean, drop_ai_sum, drop_g_sum, drop_ai_better, drop_g_better, drop_tie, drop_cb,
    //         v2_ai, v2_g, v2_bands, n_metrics
    id: "still-wrong",
    heading: "What it still gets wrong",
    facts: [
      "Music left out is counted in line-bars: one bar of one original line that has notes but no player. Two lines missing in the same bar count 2. [source: engine/coverpart/arrange.py → measures_dropped]",
      "{{drop_lead}}: {{drop_ai_mean}} line-bars per pair on average, against {{drop_g_mean}} for the rule-based plan ({{drop_ai_sum}} vs {{drop_g_sum}} line-bars in all). The rule-based plan leaves out fewer in {{drop_g_better}} pairs, the AI in {{drop_ai_better}}. [source: demos/comparison.json → totals.dropped, rows[].dropped]",
      "{{drop_cb}} of the AI's {{drop_ai_sum}} left-out line-bars are in the church-brass band. [source: demos/comparison.json → rows]",
      "In Haydn's Var. II the reference melody map puts the hymn in the cello, under a busy Violin 1 countermelody. Both planners label the violin as the melody: melody identified {{v2_ai}} for the AI and {{v2_g}} for the rule-based plan, in {{v2_bands}}. The map was written by a separate Claude Code agent; no musician has checked it. [source: demos/comparison.json → rows[].melody_id; corpus/manifest.json → melody_map]",
      "Whether a cover sounds good is not measured. The {{n_metrics}} metrics are properties code can check. [source: demos/comparison.json → metrics; README.md]",
    ],
    text: "",
  },
  {
    // tokens: n_pieces, n_bands, n_pairs, model, n_cand
    id: "evidence",
    heading: "The evidence",
    facts: [
      "{{n_pieces}} excerpts × {{n_bands}} bands = {{n_pairs}} pairs, each planned by the AI and by the rule-based baseline. Both go through the same checker and the same repairs. [source: demos/comparison.json → n_pairs]",
      "The AI plans on this site were precomputed ({{model}}) for the {{n_bands}} sample bands only. For each pair the AI wrote {{n_cand}} plans and the checker kept the one with the fewest problems; that kept plan is the AI side of every number below. A band you build yourself gets the rule-based plan, made and checked live, and is labeled that way. [source: demos/*__ai.json → model, checks.candidates; DECISIONS.md, 2026-10-10 (redesign; pre-recording upgrades)]",
      `${REFERENCE_MAP.fact} Melody identified and reference melody kept are both scored against it. [source: corpus/manifest.json → melody_map]`,
    ],
    text: "",
  },
  {
    // tokens: n_bands
    id: "close",
    heading: "Try it with your band",
    facts: [
      "A band you build yourself, or a score you upload as MusicXML (what MuseScore, Finale and Sibelius export), gets the rule-based plan, made and checked live; uploaded scores are not stored. The AI plans on this page were precomputed for the {{n_bands}} sample bands only. [source: demos/index.json → rosters; web/src/tool/UploadPanel.tsx; DECISIONS.md, 2026-10-10 (redesign; pre-recording upgrades)]",
    ],
    text: "",
  },
];

export function section(id: string): Section {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`copy.ts has no section "${id}"`);
  return s;
}
