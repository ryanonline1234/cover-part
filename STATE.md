# State — Cover Part (EvoHacks2026 entry)
_Updated: 2026-10-10 20:15 PDT_

## Now
LIVE at cover-part.vercel.app (Git-connected: every push to main deploys production).
- **Built:** band-folder tool; upload your own MusicXML (live, rule-based, not stored); AI best-of-3 chosen by the checker for the preset results; why page with live demos plus evidence.
- **Scoreboard (24 pairs, best-of-3):** the AI is better on melody identified (71% vs 54%), bass (97% vs 87%), notes under the bass (4.0 vs 14.7) and final folds (0.9 vs 4.25). The baseline leaves out less music (4.2 vs 6.4 line-bars).
- **Video:** recorded and assembled (notes-local/video/out/): the silent cut, a music-bed version (the app's own playback), a teleprompter version, captions, a TTS pacing guide, and SCRIPT.md, which has the recording how-to, the YouTube title/description with the AI-use disclosure, and what was and wasn't checked. Runtime 2:51.75. An independent frame review found 3 cosmetic issues, all fixed. Ryan narrates over the teleprompter; then `pipeline/add_voice.sh ~/Desktop/voice.m4a` writes out/coverpart_demo_FINAL.mp4.
- **Ryan's to-dos:** narrate with the teleprompter (~15 min); run add_voice.sh; upload to YouTube as Public by about 10:30 AM 10/11 (the description is in SCRIPT.md); submit Devpost by 11:15 AM 10/11 (repo, live link, video, and a description with the AI-use paragraph). Optional: the organizer email (Gmail draft) and the why-page prose (skipped for now). The arranger rules stay as written, by Ryan's decision.

## Verified
- engine/tests: 49 pass.
- Production checks (14:20): health; library pieces; a live custom band; the Arriaga upload (inspect in 1.2 s, arrange in 2.1 s); AI 403 for custom bands and uploads; best-of-3 data on the demo pairs.
- The video script's numbers were re-verified against the deployed data by a refute-first accuracy lens (every spoken figure matches).

## Pending (needs Ryan unless noted)
0. Ryan: send the organizer email (Gmail draft) + Discord post; do guide Blocks A–D.
1. Ryan: how to describe his role (rec: "I chose the project and directed Claude Code"; full breakdown in README).
3. Ryan: musician listening check of 2–3 A/B pairs (optional, strongest evidence of quality).
4. Ryan: name on screen; narrate the video; upload to YouTube/Vimeo; submit Devpost form by 11:15 AM Oct 11.
5. Claude: script workflow → measure → verify → record takes → assemble (app-demo-video skill).
6. Claude: update README "Ryan's contributions" as Ryan finishes guide blocks (AI-use section already published).

## Pending spec patches
- docs/01: result JSON also carries `summary_for_planner`, `log`, `elapsed_s` (not yet listed).
