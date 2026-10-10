# State — Cover Part (EvoHacks2026 entry)
_Updated: 2026-10-10 ~10:50 PDT_

## Now
Final rebuild (#4) of 48 results running after fixing 13 review findings (out/build4.log → out/report4.md). Web agent round 3 adapting to the new schema (first_plan/final, gate rule, measures_dropped).

## Verified
- engine/tests: 23 pass, incl. regressions for every confirmed review finding (pickup bar lengths, octave spelling, naturals shown, 1:1 voicing = 0 on all 6 excerpts, autofix trims only clashes, roster validation, playback MIDI length = score length).
- Web round 2 verified by headless Chromium (real data, A/B playback, scoreboard, ?live=1 roster editor with one real AI call).

## Pending
1. Read report4; sanity-check a few AI plans by ear (A/B) and in the score.
2. Verify web round 3 against final data.
3. Musician listening check of 2–3 A/B pairs (Ryan to ask someone).
4. Live AI on public site? (rec: no — precomputed only).
5. Public GitHub repo + Vercel deploy (ask Ryan first), 2–3 min video (app-demo-video skill), Devpost submission by 11:15 AM Oct 11.

## Pending spec patches
- docs/01: result JSON also carries `summary_for_planner`, `log`, `elapsed_s` (not yet listed).
