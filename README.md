# Cover Part

**Re-score a piece for the players you actually have.** Upload a score and your roster ("no horns, one bassoon, three altos, the second trumpet is a beginner"). An AI arranger decides which lines carry the piece and who covers each one; plain code transposes every part and checks every note against every player's range before anything prints.

Built in 27 hours for [EvoHacks 2026](https://evohackathon2026.devpost.com) (theme: AI for Automation).

## The problem

Small school, church, camp and community ensembles rarely have the instruments a published arrangement assumes. Today the director rewrites parts by hand in notation software: deciding what matters, who covers it, transposing for B♭ and E♭ instruments, and checking that nobody is asked for a note they can't play. That takes hours per piece, every concert cycle.

## How it works

```
MusicXML ──► music21 summarizes each line, 4 bars at a time ──► Claude plans the cover (JSON)
                                                                       │
         per-player parts (written pitch) + MIDI ◄── execute + check every note ◄── validate (→ revise)
```

1. **Read.** music21 cuts the excerpt and summarizes every source line phrase by phrase: range, rhythmic activity, stepwise motion, repeated notes, which lines double which, and the opening notes. The model never reads raw notation.
2. **Plan (the AI part).** Claude (`claude-opus-5-5`) finds the melody *from the music*, not from which line is on top: in Haydn's Emperor Variation II the tune is in the cello under a busy violin. It decides what to keep and what to drop when there are fewer players than lines, who covers each line based on register and idiom, and where a hand-off should happen. It returns a JSON plan with a reason for every decision.
3. **Check (plain code).** The plan is never trusted:
   - **Structure:** every player plays at most one line at a time, and every sounding bar is either covered or explicitly dropped. Problems go back to the model for revision; anything left is auto-fixed by dropping, never by inventing music.
   - **Range:** every note of every part is checked against that player's sounding range for their level, and violations go back to the model. Whole phrases are then moved by octaves, and single-note octave folds are a counted last resort. Zero unplayable notes is guaranteed by construction; the honest quality numbers are *notes out of range before repair* and *notes folded*.
4. **Output.** A colored concert score (each source line keeps its color as it moves between players), per-player parts in written pitch with the right key signatures and clefs, and an A/B playback of the original against the cover.

## Does the AI beat a sensible heuristic?

The baseline is deliberately not a strawman. It treats the highest line as the melody and the lowest as the bass, ranks the rest by activity, and gives each line to the free player whose range fits best, with octave shifts. Both planners go through the same checker and the same deterministic repairs. The AI additionally gets its revision loop: the checker sends back problems it can't repair, and a revision is kept only if it leaves fewer problems in total.

Six CC0 excerpts × four rosters = 24 pairs (`python -m coverpart.report`, results in `web/public/demos/comparison.json`):

| Metric | AI | Baseline | AI better / worse / tie |
|---|---|---|---|
| Melody identified (bars of the reference melody the planner itself labels "melody") | **73%** | 54% | 15 / 0 / 9 |
| Harmonic bass preserved (share of time the cover's lowest note has the original's bass pitch class) | **94.9%** | 88.2% | 18 / 1 / 5 |
| Notes sounding under the bass line (measured per moment against the original; the original itself scores 0) | **5.4** | 13.1 | 16 / 2 / 6 |
| Single notes octave-folded in the final parts | **0.9** | 3.9 | 9 / 1 / 14 |
| Times a line changes hands between players | **1.9** | 5.25 | 20 / 1 / 3 |
| Reference melody kept (melody maps written before any plan existed) | 97.8% | 96.5% | 2 / 2 / 20 |
| First plan only, after the same octave repair: notes still needing a fold | 3.8 | 3.9 | 6 / 5 / 13 |
| Bars of music left out | 6.9 | **4.2** | 0 / 9 / 15 |

What this does and doesn't show:
- The AI **finds the tune when it leaves the top line** in four of the five excerpts where that happens: 94–97% of the reference melody bars on the Dvořák Lento, Haydn Op. 20 and Hensel, against 50–69% for the baseline. It **fails on Haydn's Emperor Variation II**: in all four rosters it labels the busy violin countermelody as the tune, which is the baseline's mistake too. The cello's hymn is still kept, because a line doesn't need the "melody" label to be played.
- The AI's advantage is in **voicing and continuity**: it keeps the bass at the bottom and keeps each line with one player. Its first drafts are no better than the baseline at fitting ranges. The revision loop is what removes the folded notes.
- The AI **leaves out more music**: 59 of its 165 dropped bars are in the church-brass roster. There it rests the beginner trumpet on lines it can't play, while the baseline gives every line to someone and octave-folds the notes that don't fit. Every bar the AI drops is a line it labeled inner, accompaniment, countermelody or doubling, never melody or bass. Whether that's the right call is a director's judgment.
- These are code-checkable properties. **Whether a cover sounds good needs a musician's ear**, and that hasn't been measured yet.

## Run it

```bash
uv venv .venv && uv pip install --python .venv/bin/python music21 anthropic fastapi "uvicorn[standard]" pytest
cd engine && ../.venv/bin/python -m pytest -q tests                # engine invariants
../.venv/bin/python -m coverpart.cli build                          # precompute demos into web/public/demos
../.venv/bin/uvicorn coverpart.api:app --port 8000                  # optional live mode
cd ../web && npm install && npm run dev
```

The AI planner uses the Anthropic API when `ANTHROPIC_API_KEY` is set (structured outputs), and otherwise uses a local `claude -p` CLI.

## Music

Excerpts come from the [OpenScore String Quartets](https://github.com/OpenScore/StringQuartets) corpus (CC0): Haydn Op. 76 No. 3 "Emperor" (theme and Var. II) and Op. 20 No. 2, Dvořák Op. 96 "American" (I and II), and Fanny Hensel's String Quartet in E♭ (Romanza). The reference melody maps in `corpus/manifest.json` were made by reading the notes, before any plan was generated.

## Limits (honest)

- Instrument ranges are typical school-level ranges, not hard limits, and each player can override them.
- Wind players play one note at a time, so string double stops are reduced to one note. Where a double stop's lower note was the lowest sound, the harmonic bass changes briefly (a one-to-one mapping of the Emperor theme preserves the bass 95% of the time, not 100%).
- Slurs and string-specific marks (bowings, pizzicato) are not carried into wind parts. Measured tremolo plays back as written.
- Musical quality can't be fully proven by code. The checker proves playability; whether the cover *sounds right* needs a musician's ear.
