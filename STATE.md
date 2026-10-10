# State — Cover Part (EvoHacks2026 entry)
_Updated: 2026-10-10 10:05 PDT_

## Now
Full pipeline works on the 6-excerpt CC0 corpus × 4 rosters × (AI, baseline) = 48 results. In flight: rebuild #3 with gated revisions + phrase-level octave repair (out/build3.log → out/report3.md); web agent round 2 (scoreboard, checker story, ?live=1 roster editor); adversarial engine review workflow.

## Verified
- `engine/tests`: 7 tests pass (transposition table, sounding ranges, one-movement excerpt cut, validator catches overlaps/gaps, baseline plans valid + in range for all presets, every assigned note executed, clarinet written part = concert + M2 with key D minor → E minor).
- AI planner via local `claude -p --safe-mode --json-schema` (claude-opus-5-5): one call ≈ 49 s; church-brass plan on Arriaga kept the melody on Trumpet 1 throughout with 0 notes out of range before repair.

## Pending
1. Read rebuild #3 report; fix confirmed review findings; rebuild if engine changes.
2. Verify web round 2 against final data.
3. Musician listening check of 2–3 A/B pairs (Ryan to ask someone).
4. Decide live mode (needs API key) vs precomputed-only deploy (rec: precomputed).
5. README, public GitHub repo, Vercel deploy (ask Ryan first), 2–3 min video, Devpost submission by 11:15 AM Oct 11.

## Pending spec patches
- docs/01: result JSON also carries `summary_for_planner`, `log`, `elapsed_s` (not yet listed).
