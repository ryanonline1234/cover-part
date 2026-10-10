# Cover Part

**Re-score a piece for the players you actually have.** The demo site uses six public-domain string-quartet excerpts with precomputed results; the engine takes any MusicXML. Give it a score (MusicXML) and your roster ("no horns, one bassoon, three altos, the second trumpet is a beginner"). An AI arranger decides which lines carry the piece and who covers each one; plain code transposes every part and checks every note against every player's range before anything prints.

**Live:** https://cover-part.vercel.app

Built in 27 hours for [EvoHacks 2026](https://evohackathon2026.devpost.com) (theme: AI for Automation).

## The problem

Small school, church, camp and community ensembles rarely have the instruments a published arrangement assumes. Today the director rewrites parts by hand in notation software: deciding what matters, who covers it, transposing for B♭ and E♭ instruments, and checking that nobody is asked for a note they can't play. It is slow, fiddly work that comes back every time the roster or the music changes.

## How it works

```
MusicXML ──► music21 summarizes each line, 4 bars at a time ──► Claude plans the cover (JSON)
                                                                       │
         per-player parts (written pitch) + MIDI ◄── execute + check every note ◄── validate (→ revise)
```

1. **Read.** music21 cuts the excerpt and summarizes every source line phrase by phrase: range, rhythmic activity, stepwise motion, repeated notes, which lines double which, and the opening notes. The model never reads raw notation.
2. **Plan (the AI part).** Claude (`claude-opus-5-5`) finds the melody *from the music*, not from which line is on top: in the Dvořák "American" Lento the theme passes from the first violin to the cello at bar 11, and the AI follows it. It can also get this wrong (see the results below). It decides what to keep and what to drop when there are fewer players than lines, who covers each line based on register and idiom, and where a hand-off should happen. It returns a JSON plan with a reason for every decision.
3. **Check (plain code).** The plan is never trusted:
   - **Structure:** every player plays at most one line at a time, and every sounding bar is either covered or explicitly dropped. Problems go back to the model for revision; anything left is auto-fixed by dropping, never by inventing music.
   - **Range:** every note of every part is checked against that player's sounding range for their level, and violations go back to the model. Whole phrases are then moved by octaves, and single-note octave folds are a counted last resort. Zero unplayable notes is guaranteed by construction; the honest quality numbers are *notes out of range before repair* and *notes folded*.
4. **Output.** A colored concert score (each source line keeps its color as it moves between players), per-player parts in written pitch with the right key signatures and clefs, and an A/B playback of the original against the cover.

## Does the AI beat a sensible heuristic?

The baseline is deliberately not a strawman. It treats the highest line as the melody and the lowest as the bass, ranks the rest by activity, and gives each line to the free player whose range fits best, with octave shifts. It keeps a line with the same player while that player still fits it, and any player left without a line doubles the melody or the bass. Custom bands on the site get this plan, live. Both planners go through the same checker and the same deterministic repairs. The AI additionally gets its revision loop: the checker sends back problems it can't repair, and a revision is kept only if it leaves fewer problems in total.

Six CC0 excerpts × four rosters = 24 pairs (`python -m coverpart.report`, results in `web/public/demos/comparison.json`). Each AI result is a single run.

| Metric | AI | Rule-based baseline | AI better / worse / tie |
|---|---|---|---|
| Melody identified (bars of the reference melody the planner itself labels "melody") | 73% | 54% | 16 / 0 / 8 |
| Reference melody kept | 99% | 96% | 3 / 2 / 19 |
| Harmonic bass preserved (share of time the cover's lowest note has the original's bass pitch class) | 94% | 87% | 17 / 4 / 3 |
| Notes sounding under the bass line (measured per moment against the original; the original itself scores 0) | 10.9 | 14.7 | 17 / 3 / 4 |
| First plan only, after the same octave repair: notes still needing a fold | 3.6 | 4.2 | 6 / 5 / 13 |
| Single notes octave-folded in the final parts | 1.3 | 4.2 | 9 / 2 / 13 |
| Times a line changes hands between players | 2.2 | 2.6 | 10 / 7 / 7 |
| Line-bars left out (one bar of one original line that nobody plays) | 6.6 | 4.2 | 0 / 7 / 17 |

What this does and doesn't show:
- **Melody.** The AI finds the tune when it leaves the top line in three of the five excerpts where that happens: 88–100% of the reference melody bars on the Dvořák Lento, Haydn Op. 20 and Hensel, against 50–69% for the baseline. In Dvořák I it finds about half (55% vs 45%). It **fails on Haydn's Emperor Variation II**: in all four rosters it labels the busy violin countermelody as the tune, which is the baseline's mistake too. The cello's hymn is still kept, because a line doesn't need the "melody" label to be played.
- **The reference melody maps were written by a separate Claude Code agent reading the notes, before any plan existed. No musician has checked them.**
- **Voicing.** The AI keeps the harmonic bass more often (17 of 24 pairs) and has fewer notes under the bass in 17 pairs. But a few of its plans are much worse: on the Dvořák Lento for winds it has 91 notes under the bass against the baseline's 15. Its average is pulled up by those cases.
- **Continuity.** Against the current baseline, which keeps a line with one player while it fits, the AI's advantage on hand-offs is small (10 pairs better, 7 worse). An earlier, cruder baseline reshuffled players every 4 bars and made the AI look far better here. We improved the baseline after a review and report it as it is now.
- **Range.** The AI's first drafts fit ranges about as well as the baseline's. The revision loop is what removes most of the folded notes.
- The AI **leaves out more music** (6.6 vs 4.2 line-bars per pair). None of the bars it drops is a line it labeled melody or bass. Whether that's the right call is a director's judgment.
- **Run-to-run variation.** The AI's plans vary between runs: Var. II for winds went from 0 notes under the bass in one run to 68 in the next. Each number above is one run.
- These are code-checkable properties. **Whether a cover sounds good needs a musician's ear**, and that hasn't been measured.

## How this was built (AI use, stated plainly)

- **Built with Claude Code.** During the hackathon window (Oct 10–11, 2026), Claude Code agents (Anthropic's AI coding agent, model Claude Opus 5.5) wrote the code, tests, web app and documentation, and chose the demo excerpts. That included a corpus-selection agent, a web-frontend agent, and a 19-agent adversarial review whose 13 confirmed bugs were then fixed. Every commit they made carries a `Co-Authored-By: Claude` trailer.
- **Ryan's part:** he chose this project from a ranked list of ideas, directed the build, and makes the project's decisions (for example, publishing it and keeping the public site to precomputed results). What he writes or changes himself is listed under "Ryan's contributions" below, and in the git history as commits without the Claude trailer.
- **Inside the product,** Claude Opus 5.5 is the arranger. The results on the site were precomputed by running it through the Claude Code CLI on Ryan's Claude subscription.
- **Outside resources:** [music21](https://www.music21.org) (score analysis and export), [Verovio](https://www.verovio.org) (engraving in the browser), the [OpenScore String Quartets](https://github.com/OpenScore/StringQuartets) corpus (CC0), and the FluidR3_GM soundfont via [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) (CC BY 3.0).

### Ryan's contributions

- Redirected the project from a report-style page to a practical tool. He chose the "band folder" layout (one printable part per player) from three options, asked for a page on the why behind it, and decided that custom bands run live while AI plans stay precomputed (no live API key).
- The arranger's musical rules (`engine/coverpart/arranger_rules.md`) stay as Claude Code wrote them. Ryan isn't a musician and chose not to rewrite them.

## Using it

- **Arrange (the tool):** pick the music, set up your band (or start from a preset), then arrange. You get one part per player, written in the key that instrument reads, ready to play back, print or download as MusicXML. For a custom band, the rule-based plan is computed and checked live by the engine (a Vercel Python function at `/api/arrange`). AI plans are precomputed for the 4 preset bands; live AI for custom bands would need an API key, which isn't enabled.
- **Why (`#/why`):** live demos of the problem and of why both a simple rule and a bare AI fall short, plus the full scoreboard.

## Run it

```bash
uv venv .venv && uv pip install --python .venv/bin/python music21 anthropic fastapi "uvicorn[standard]" pytest
cd engine && ../.venv/bin/python -m pytest -q tests                # engine invariants
../.venv/bin/python -m coverpart.cli build                          # precompute demos into web/public/demos
../.venv/bin/uvicorn coverpart.api:app --port 8000                  # the engine API (custom bands)
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
