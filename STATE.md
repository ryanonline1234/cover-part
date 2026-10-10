# State — Cover Part (EvoHacks2026 entry)
_Updated: 2026-10-10 09:20 PDT_

## Now
Engine core works end to end on an OpenScore excerpt (Arriaga SQ1, mm. 1–12). Web frontend and demo-corpus selection are being built in parallel (web/, corpus/).

## Verified
- `engine/tests`: 7 tests pass (transposition table, sounding ranges, one-movement excerpt cut, validator catches overlaps/gaps, baseline plans valid + in range for all presets, every assigned note executed, clarinet written part = concert + M2 with key D minor → E minor).
- AI planner via local `claude -p --safe-mode --json-schema` (claude-opus-5-5): one call ≈ 49 s; church-brass plan on Arriaga kept the melody on Trumpet 1 throughout with 0 notes out of range before repair.

## Pending
1. corpus/manifest.json (agent) → `cd engine && ../.venv/bin/python -m coverpart.cli build` to precompute demos (greedy + ai × 4 rosters × excerpts).
2. Wire the real demos into web/ (agent built against a mock).
3. Comparison table AI vs baseline (melody coverage vs manifest melody map, out-of-range before repair, folded notes, handoffs).
4. Decide live mode (needs API key) vs precomputed-only deploy (rec: precomputed).
5. README, public GitHub repo, Vercel deploy (ask Ryan first), 2–3 min video, Devpost submission by 11:15 AM Oct 11.

## Pending spec patches
- docs/01: result JSON also carries `summary_for_planner`, `log`, `elapsed_s` (not yet listed).
