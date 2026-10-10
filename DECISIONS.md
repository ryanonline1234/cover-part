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
