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
