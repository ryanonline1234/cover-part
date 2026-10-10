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
