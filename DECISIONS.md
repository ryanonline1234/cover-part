# Decisions — Cover Part

## 2026-10-10 — Planner reads phrase summaries, never raw notation
LLMs read MusicXML badly. music21 summarizes each source line per 4-bar segment (range, activity, stepwise share, repeated notes, doublings, opening notes) and Claude plans from that. Rejected: sending MusicXML to the model.

## 2026-10-10 — Code disposes: validate → revise → octave repair → single-note fold
The plan is never trusted. Structure errors go back to the model (≤2 rounds), then are auto-fixed by dropping, never by inventing music. Range violations get one model revision, then whole-phrase octave repair, then single-note octave folding as a counted last resort. "0 notes out of range" is therefore guaranteed by construction; the honest quality numbers are notes out of range before repair and notes folded.

## 2026-10-10 — Baseline is reasonable, not a strawman
The no-AI baseline uses register (highest = melody, lowest = bass), activity ranking and best range fit with octave shifts. The AI must beat a sensible heuristic, not a dumb one.

## 2026-10-10 — Demo corpus: OpenScore String Quartets (CC0)
Public-domain band scores are mostly PDFs. OpenScore String Quartets ships 196 .mxl files under CC0. OpenScore files hold every movement in one stream with measure numbers restarting, so excerpts are selected by movement index + measure range.

## 2026-10-10 — Local AI via headless `claude -p`, API key optional
ANTHROPIC_API_KEY not set on the Mac. Planner uses the Anthropic SDK (structured outputs, claude-opus-5-5) when a key is set, else the local `claude -p --safe-mode --json-schema` on Ryan's subscription. Forced tool_choice is rejected on Opus 5.5, so the SDK path uses output_config.format.

## 2026-10-10 — Bass metric = lowest-note pitch class over time, not "lowest line per 4 bars"
The first metric labeled the lowest line of each 4-bar block as "the bass" and checked it was assigned. It said 6% on a plan where the bass line was played in every bar, because a viola pedal sat under the cello melody. Replaced with: share of sounding time where the cover's lowest note has the same pitch class as the original's (via chordify). Octave-agnostic, planner-independent, and it catches texture inversions. Known floor: string double stops reduced to one note can lose a bass note (Emperor theme 1:1 mapping = 0.95).

## 2026-10-10 — Checker feeds voicing and role problems back to the AI
First full run: the AI beat the baseline on continuity and folds but lost on melody kept (dropped wide melody fragments rather than fold notes) and bass (moved accompaniment an octave down under the bass). Added two checks fed back for revision: dropping a span the AI itself labeled melody/bass is an error; notes sounding under the bass carrier (≥3 semitones) or a missing bass line trigger one voicing revision. Lento/church brass: bass preserved 0.371 → 0.857, inversions 1 → 0.

## 2026-10-10 — Revision gate: total problems must go down (bass-missing bar = 12)
A strict "no metric may get worse" gate rejected 14 of 25 AI revisions, including clear wins (14 out-of-range notes fixed at the cost of 1 note under the bass). Now a revision is kept iff out_of_range + under_bass + 12 × bars_with_no_bass strictly decreases. The weight 12 is a judgment call: a bar with no bass is audibly worse than a few displaced notes; at 8 it would accept trading 11 out-of-range notes for one bass-less bar, which we judged a bad trade.

## 2026-10-10 — Adversarial engine review: 13 confirmed findings fixed
A 19-agent review (3 dimension reviewers, one skeptic per finding) confirmed 13 defects. Notable: pickup/split half-bars exported as full bars with hidden rests; octave shifts used a 12-semitone Interval, which respelled notes (D♭→C♯) and dropped naturals, so parts printed wrong notes (fixed: change pitch.octave, then recompute accidentals per bar); "notes under the bass" counted the composer's own voicing (Dvořák 1:1 = 10; fixed: bass chosen per moment, so the 1:1 rendering scores 0); the revision gate scored plans before octave repair (fixed: every candidate gets the same repairs, then is scored); "out of range before repair" compared the planners at different stages and "dropped spans" counted plan entries (replaced with first-plan folds and bars of music left out). Also: unknown ids crashed the pipeline, a failed revision call discarded a valid plan, autofix dropped whole melody spans on a one-bar overlap, API accepted duplicate ids and sub-octave ranges. Found while fixing: playback MIDI drifted 8 beats on Haydn Var. II because music21 gave grace notes in voiced bars real time; grace notes are now omitted from playback only.

## 2026-10-10 — Redesign to a practical tool + a "why" page (Ryan's direction)
Ryan redirected the site from a report-style page to a practical tool and asked for a whole page on the why. He chose from three layouts: the "band folder" (one printable part per player, an editable band row on top), with full score and "how it decided" as secondary views. Custom bands run live (checker + rule-based plan, engine deployed as a Vercel Python function). AI plans stay precomputed for the 4 preset bands, because Ryan declined a live API key for now. The why page's prose is Ryan's to write: builders put verified facts in web/src/why/copy.ts, and the text fields stay empty for him.

## 2026-10-10 — "As written" demo planner: pair parts in score order, no repair, count as engraved
For the why page's first demo, the "as_written" planner models a director handing out the original parts: source parts in score order are paired with players sorted from highest to lowest range centre, with no octave shifts and no repair. Leftover parts are dropped as "nobody left to play it". Out-of-range notes stay where they are and are engraved with x noteheads. The count follows the engraving: music21 splits a fingered-tremolo note into two tied notes on export, so as_written counts after that split (notes_total can be 1 higher than ai/greedy on Dvořák I). It is demo data only; the tool never loads it, and comparison.json ignores it.

## 2026-10-10 — Live engine on Vercel with a trimmed music21 wheel
Stock music21 plus matplotlib comes to about 251 MB on Linux, over the roughly 225 MB at which Vercel's Python build stops bundling dependencies, and Vercel can't exclude files from installed packages. So api/_wheels holds a music21 10.5.0 wheel without the sample-score corpus and without matplotlib (rebuild with api/_tools/trim_music21_wheel.py). All engine tests pass without them. Function: 45.9 MB reported, cold request ~15 s, warm 5–9 s. The AI planner returns 403 in production (no API key). If a key is ever enabled, add anthropic to requirements.txt and raise maxDuration to 300 s: precomputed AI runs took 20–270 s.

## 2026-10-10 — Review fixes: bars-with-no-bass counted correctly; baseline improved (and the AI's lead shrank)
A four-lens review confirmed 17 problems. Two changed the evidence.
- **The counting bug.** "Bars with no bass" counted bass-missing entries (one per line), not bars. That let the Var. II church-brass AI revision be kept although the stated rule would have rejected it (re-scored: 204 vs 42). It now counts distinct bars, and the AI results were re-run under the corrected gate.
- **A better baseline.** The rule-based planner reshuffled players every 4 bars, made one-bar hand-offs, and left extra players idle in bands larger than the piece's 4 lines. That planner is both the comparison baseline and what custom bands get live, so we improved it:
  - sticky lines (a line stays with its player while they fit it as well as anyone free);
  - a last phrase shorter than 2 bars merges into the one before;
  - idle players double the melody or bass at an octave that doesn't sound under the bass.
  
  This was done after seeing the results, and it made the baseline stronger, not weaker. The AI's hand-off advantage fell from 20/1/3 (1.9 vs 5.25) to 10/7/7 (2.2 vs 2.6). The README reports the new numbers.
- **The merge trade-off.** It costs Var. II winds4 and no_viola 28 notes under the bass each in the baseline, against a one-bar line swap without it. We kept it because the review flagged one-bar hand-offs as unusable parts. Set MIN_LAST_PHRASE = 1 in planner_greedy.py to revert; that's a ~3-minute rule-based rebuild.
- **Run-to-run variation.** Re-running the AI changed some results substantially: Var. II winds4 went from 0 to 68 notes under the bass, and Dvořák Lento winds4 now has 91 because the corrected gate rejected a voicing revision. Each published AI result is a single run, and the README says so.

## 2026-10-10 — Arranger rules stay as written; video next
Ryan decided not to rewrite arranger_rules.md: he isn't a musician, so hand-written musical rules from him wouldn't be better grounded. The why-page prose is deferred too. The demo video proceeds on the current site, and its narration credits Ryan only with what he did (picked the project, chose the redesign and band-folder layout, asked for the why page, decided live-vs-precomputed, approved publishing).

## 2026-10-10 — Pre-recording upgrades: upload your own score; AI best-of-3 chosen by the checker
Ryan invited last-minute changes that would make a real difference before the video is recorded.
- **Upload your own score.** A director can upload MusicXML (the format MuseScore, Finale and Sibelius export), choose a movement and up to 32 bars, and get live, checked rule-based parts. Nothing is stored. This was the director reviewer's main blocker to real use.
- **AI best-of-3.** For the precomputed preset results, the AI writes 3 independent plans, and each goes through the same revision loop and repairs. The checker keeps the one with the fewest problems (the revision-gate formula; ties go to fewer line-bars left out, then fewer hand-offs). This addresses the honest weakness of single AI runs (e.g. 91 notes under the bass on one plan). Generate-and-verify is the project's own principle.
- **Guarding against inflated comparisons.** Selection never looks at the reference melody maps. The reported "first plan" metric uses the unselected first candidate's first draft, so the AI-vs-baseline first-draft comparison isn't flattered by selection. The final metrics describe what the product outputs, which is the selected plan.
