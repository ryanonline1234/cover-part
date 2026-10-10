# State — Cover Part (EvoHacks2026 entry)
_Updated: 2026-10-10 ~13:30 PDT_

## Now
Redesign shipped to main (commit 3713104), and the production deploy via Git integration is in progress. Note: the Vercel project is Git-connected, so every push to main deploys production. Contents:
- the band-folder tool at #/, with a live rule-based plan for custom bands through the Python function /api/arrange (AI plans precomputed for the 4 preset bands; no key);
- the why page at #/why, with 4 live demos plus evidence; its prose is empty for Ryan (web/src/why/copy.ts);
- all 17 confirmed review findings fixed and all results rebuilt.

The scoreboard moved against the AI: the hand-off lead is mostly gone, and its notes-under-the-bass mean rose because of a few bad single runs. The README states this. Eligibility: Ryan still has to send the organizer email (Gmail draft) and do the guide (notes-local/ryan-guide.md).

## Verified
- engine/tests: 40 pass (regressions for the engine review's 13 findings and the redesign review's engine findings).
- Final scoreboard (out/report5.md, web/public/demos/comparison.json): AI better on melody identified (73% vs 54%, 15/0/9), bass preserved (95% vs 88%), notes under bass (5.4 vs 13.1), final folds (0.9 vs 3.9), handoffs (1.9 vs 5.25); baseline better on bars left out (4.2 vs 6.9); first-plan folds ≈ equal. Both planners mislabel the melody in Haydn Var. II.
- Web round 3 verified headless (cursor/playhead 36/36 on pickup excerpts; A/B playback; scoreboard; ?live=1).
- Fact sheet (notes-local/video/ground/facts.md) recomputed all scoreboard means from the 48 files: match.

## Pending (needs Ryan unless noted)
0. Ryan: send the organizer email (Gmail draft) + Discord post; do guide Blocks A–D.
1. Ryan: how to describe his role (rec: "I chose the project and directed Claude Code"; full breakdown in README).
3. Ryan: musician listening check of 2–3 A/B pairs (optional, strongest evidence of quality).
4. Ryan: name on screen; narrate the video; upload to YouTube/Vimeo; submit Devpost form by 11:15 AM Oct 11.
5. Claude: script workflow → measure → verify → record takes → assemble (app-demo-video skill).
6. Claude: update README "Ryan's contributions" as Ryan finishes guide blocks (AI-use section already published).

## Pending spec patches
- docs/01: result JSON also carries `summary_for_planner`, `log`, `elapsed_s` (not yet listed).
