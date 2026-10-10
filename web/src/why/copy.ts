// All prose on the why page lives here.
//
//   heading  a short draft heading (Ryan may change it)
//   facts    verified facts, each ending in [source: ...]. Shown as margin "Notes" while `text` is empty.
//   text     EMPTY until Ryan writes it. When non-empty it replaces the notes. Blank lines split paragraphs.
//
// Numbers are never typed here. A {{token}} is filled in by the page from the result / comparison JSON
// (the tokens each section offers are listed above it). Tokens work in `text` too.

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
      "The {{n_bands}} preset bands: {{band_list}}. [source: demos/index.json → rosters]",
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
      "Handing {{piece}} to {{band}} line for line ({{mapping}}): {{asw_oor}} of {{asw_total}} notes are outside the player's range. [source: demos/{{asw_id}}.json → checks.notes_out_of_range, checks.notes_total]",
      "The most land on one player: {{asw_worst_player}}, {{asw_worst_count}} notes. [source: demos/{{asw_id}}.json → checks.violations]",
      "Cover Part's version for the same band: notes out of range {{ai_oor}}; single notes moved by an octave as a last resort {{ai_folded}}; bars left out {{ai_dropped}}. [source: demos/{{ai_id}}.json → checks.notes_out_of_range, notes_folded, measures_dropped]",
      "Zero out of range is guaranteed by construction: code repairs whatever the plan leaves. The honest numbers are the notes it had to fold and the bars it left out. [source: DECISIONS.md, 2026-10-10]",
    ],
    text: "",
  },
  {
    // tokens: handoff_from, handoff_to, handoff_bar, band, ref_bars, g_hit, g_pct, ai_hit, ai_pct, ai_id, g_id,
    //         n_pairs, all_ai_pct, all_g_pct, all_ai_better, all_g_better, all_tie
    id: "simple-rule",
    heading: "Why not a simple rule?",
    facts: [
      "In the Lento of Dvořák's “American” Quartet the tune moves from {{handoff_from}} to {{handoff_to}} at bar {{handoff_bar}}. [source: corpus/manifest.json → melody_map, written from the notes before any plan existed]",
      "The rule-based plan treats the top line as the melody. For {{band}} it labels {{g_hit}} of the {{ref_bars}} melody bars correctly ({{g_pct}}); the AI plan labels {{ai_hit}} ({{ai_pct}}). [source: demos/{{g_id}}.json, demos/{{ai_id}}.json → plan.roles]",
      "Over all {{n_pairs}} piece-and-band pairs, melody identified: AI {{all_ai_pct}}, rule-based {{all_g_pct}}. AI better in {{all_ai_better}} pairs, rule-based in {{all_g_better}}, tied in {{all_tie}}. [source: demos/comparison.json → totals.melody_id]",
    ],
    text: "",
  },
  {
    // tokens: fp_total, fp_oor, fp_under, fp_missing, rev_count, rev_kept, rev_rejected, final_total, final_folded,
    //         g_total, ai_id, g_id, fu_ai, fu_g, fold_ai, fold_g
    id: "ask-an-ai",
    heading: "Why not just ask an AI?",
    facts: [
      "Haydn's “Emperor” theme for church brass: the AI's first draft still had {{fp_total}} problems after the octave repair: {{fp_oor}} notes out of range, {{fp_under}} notes under the bass, {{fp_missing}} bars with no bass. [source: demos/{{ai_id}}.json → checks.first_plan]",
      "Problems = notes still out of range + notes under the bass + 12 × bars with no bass. [source: engine/coverpart/arrange.py → total_problems]",
      "Revisions the checker asked for: {{rev_count}}. Kept: {{rev_kept}}; rejected: {{rev_rejected}}. A revision is kept only if the total goes down. [source: demos/{{ai_id}}.json → checks.revisions]",
      "Final AI plan: {{final_total}} problems. Rule-based plan for the same band: {{g_total}}. [source: demos/{{ai_id}}.json, demos/{{g_id}}.json → checks.final]",
      "Over all pairs, first drafts needed about as many single-note folds as the rule-based plan ({{fu_ai}} vs {{fu_g}} on average); after the revision loop, {{fold_ai}} vs {{fold_g}}. [source: demos/comparison.json → totals.first_unfit, totals.folded]",
    ],
    text: "",
  },
  {
    // tokens: drop_ai_mean, drop_g_mean, drop_ai_sum, drop_g_sum, drop_ai_better, drop_g_better, drop_tie, drop_cb,
    //         v2_ai, v2_g, v2_bands, n_metrics
    id: "still-wrong",
    heading: "What it still gets wrong",
    facts: [
      "The AI leaves out more music: {{drop_ai_mean}} bars per pair on average, against {{drop_g_mean}} for the rule-based plan ({{drop_ai_sum}} vs {{drop_g_sum}} bars in all). The rule-based plan leaves out fewer in {{drop_g_better}} pairs, the AI in {{drop_ai_better}}. [source: demos/comparison.json → totals.dropped, rows[].dropped]",
      "{{drop_cb}} of the AI's {{drop_ai_sum}} left-out bars are in the church-brass band. [source: demos/comparison.json → rows]",
      "In Haydn's Var. II the hymn is in the cello, under a busy Violin 1 countermelody. Both planners label the violin as the melody: melody identified {{v2_ai}} for the AI and {{v2_g}} for the rule-based plan, in {{v2_bands}}. [source: demos/comparison.json → rows[].melody_id; corpus/manifest.json]",
      "Whether a cover sounds good is not measured. The {{n_metrics}} metrics are properties code can check. [source: demos/comparison.json → metrics; README.md]",
    ],
    text: "",
  },
  {
    // tokens: n_pieces, n_bands, n_pairs, model
    id: "evidence",
    heading: "The evidence",
    facts: [
      "{{n_pieces}} excerpts × {{n_bands}} bands = {{n_pairs}} pairs, each planned by the AI and by the rule-based baseline. Both go through the same checker and the same repairs. [source: demos/comparison.json → n_pairs]",
      "The AI plans on this site were precomputed ({{model}}). A band you build yourself gets the rule-based plan, run live, and is labeled that way. [source: demos/*__ai.json → model; DECISIONS.md, 2026-10-10]",
    ],
    text: "",
  },
  {
    id: "close",
    heading: "Try it with your band",
    facts: [],
    text: "",
  },
];

export function section(id: string): Section {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`copy.ts has no section "${id}"`);
  return s;
}
