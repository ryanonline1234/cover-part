# State — Cover Part (EvoHacks2026 entry)
_Updated: 2026-10-10 ~11:15 PDT_

## Now
PUBLISHED: public repo https://github.com/ryanonline1234/cover-part, live https://cover-part.vercel.app (Vercel project ryanonline1234s-projects/cover-part, CLI deploy from web/; production verified in browser 10:58). Eligibility: EvoHacks Code of Conduct §5 says "almost entirely AI without meaningful student contribution may be disqualified". Ryan chose: ask the organizers (Gmail draft created, not sent) + make his contribution real (private guide notes-local/ryan-guide.md: learn the pipeline, rewrite engine/coverpart/arranger_rules.md himself, own decisions, write description and narration in his words). Video: shot map agent running; script drafts wait on Ryan's contribution.

## Verified
- engine/tests: 23 pass (incl. regressions for all 13 confirmed review findings).
- Final scoreboard (out/report5.md, web/public/demos/comparison.json): AI better on melody identified (73% vs 54%, 15/0/9), bass preserved (95% vs 88%), notes under bass (5.4 vs 13.1), final folds (0.9 vs 3.9), handoffs (1.9 vs 5.25); baseline better on bars left out (4.2 vs 6.9); first-plan folds ≈ equal. Both planners mislabel the melody in Haydn Var. II.
- Web round 3 verified headless (cursor/playhead 36/36 on pickup excerpts; A/B playback; scoreboard; ?live=1).
- Fact sheet (notes-local/video/ground/facts.md) recomputed all scoreboard means from the 48 files: match.

## Pending (needs Ryan unless noted)
0. Ryan: send the organizer email (Gmail draft) + Discord post; do guide Blocks A–D.
1. Ryan: how to describe his role (rec: "I chose the project and directed Claude Code"; full breakdown in README).
2. Ryan: go-ahead to create the public GitHub repo + deploy to Vercel (required: public repo, live link).
3. Ryan: musician listening check of 2–3 A/B pairs (optional, strongest evidence of quality).
4. Ryan: name on screen; narrate the video; upload to YouTube/Vimeo; submit Devpost form by 11:15 AM Oct 11.
5. Claude: script workflow → measure → verify → record takes → assemble (app-demo-video skill).
6. Claude: README "How this was built" / AI-use section after Ryan answers #1.

## Pending spec patches
- docs/01: result JSON also carries `summary_for_planner`, `log`, `elapsed_s` (not yet listed).
