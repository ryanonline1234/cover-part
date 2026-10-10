# State — Cover Part (EvoHacks2026 entry)
_Updated: 2026-10-10 ~11:00 PDT_

## Now
Product is feature-complete and committed locally (no git remote, not deployed). Final results: 48 precomputed (6 CC0 excerpts × 4 rosters × AI/baseline). Video pipeline started in notes-local/video (git-ignored): facts.md done, rules.md in flight; next = shot map → 3 script drafts → 3 judges (app-demo-video skill).

## Verified
- engine/tests: 23 pass (incl. regressions for all 13 confirmed review findings).
- Final scoreboard (out/report5.md, web/public/demos/comparison.json): AI better on melody identified (73% vs 54%, 15/0/9), bass preserved (95% vs 88%), notes under bass (5.4 vs 13.1), final folds (0.9 vs 3.9), handoffs (1.9 vs 5.25); baseline better on bars left out (4.2 vs 6.9); first-plan folds ≈ equal. Both planners mislabel the melody in Haydn Var. II.
- Web round 3 verified headless (cursor/playhead 36/36 on pickup excerpts; A/B playback; scoreboard; ?live=1).
- Fact sheet (notes-local/video/ground/facts.md) recomputed all scoreboard means from the 48 files: match.

## Pending (needs Ryan unless noted)
1. Ryan: how to describe his role (rec: "I chose the project and directed Claude Code"; full breakdown in README).
2. Ryan: go-ahead to create the public GitHub repo + deploy to Vercel (required: public repo, live link).
3. Ryan: musician listening check of 2–3 A/B pairs (optional, strongest evidence of quality).
4. Ryan: name on screen; narrate the video; upload to YouTube/Vimeo; submit Devpost form by 11:15 AM Oct 11.
5. Claude: script workflow → measure → verify → record takes → assemble (app-demo-video skill).
6. Claude: README "How this was built" / AI-use section after Ryan answers #1.

## Pending spec patches
- docs/01: result JSON also carries `summary_for_planner`, `log`, `elapsed_s` (not yet listed).
