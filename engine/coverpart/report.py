"""AI vs baseline comparison over every precomputed demo.

  python -m coverpart.report ../web/public/demos   → writes comparison.json + prints a markdown table
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

METRICS = [
    ("melody_id", "Melody identified (planner's own labels vs the reference map)", "higher"),
    ("melody", "Reference melody kept", "higher"),
    ("bass", "Harmonic bass preserved", "higher"),
    ("inversions", "Notes sounding under the bass line", "lower"),
    ("first_unfit", "First plan: notes that needed a single-note fold", "lower"),
    ("folded", "Final: single notes octave-folded", "lower"),
    ("handoffs", "Line handoffs between players", "lower"),
    ("dropped", "Bars of music left out", "lower"),
]


_ALIAS = {"Violin I": "P1", "Violin II": "P2", "Viola": "P3", "Violoncello": "P4", "Cello": "P4"}


def melody_identified(res: dict, melody_map: list[dict]) -> float | None:
    """Share of reference-melody bars (part × bar) that the planner itself labeled 'melody'."""
    ref = {(_ALIAS[x["part"]], b) for x in melody_map for b in range(x["start_measure"], x["end_measure"] + 1)}
    lab = {(r["source_part"], b) for r in res["plan"].get("roles", []) if r["role"] == "melody"
           for b in range(r["start_measure"], r["end_measure"] + 1)}
    return round(len(ref & lab) / len(ref), 3) if ref else None


def row(res: dict, melody_map: list[dict] | None = None) -> dict:
    c = res["checks"]
    return {
        "melody_id": melody_identified(res, melody_map or []),
        "melody": c["essential_coverage"]["melody"],
        "bass": c["essential_coverage"]["bass"],
        "inversions": c.get("bass_inversions"),
        "first_unfit": c["first_plan"]["out_of_range"],
        "folded": c["notes_folded"],
        "handoffs": c["handoffs"],
        "dropped": c["measures_dropped"],
        "repair_rounds": c["repair_rounds"],
    }


def build(demo_dir: Path) -> dict:
    manifest = json.loads((demo_dir.resolve().parents[2] / "corpus" / "manifest.json").read_text())
    maps = {e["id"]: e.get("melody_map", []) for e in manifest["excerpts"]}
    pairs = {}
    for f in sorted(demo_dir.glob("osq-*__*__*.json")):
        piece, roster, planner = f.stem.split("__")
        res = json.loads(f.read_text())
        pairs.setdefault((piece, roster), {})[planner] = row(res, maps.get(piece)) | {"result_id": f.stem}
    rows = []
    for (piece, roster), d in sorted(pairs.items()):
        if "ai" in d and "greedy" in d:
            rows.append({"piece": piece, "roster": roster, "ai": d["ai"], "greedy": d["greedy"]})
    totals = {}
    for key, _, better in METRICS:
        ai_vals = [r["ai"][key] for r in rows if r["ai"][key] is not None]
        gr_vals = [r["greedy"][key] for r in rows if r["greedy"][key] is not None]
        wins = losses = ties = 0
        for r in rows:
            a, g = r["ai"][key], r["greedy"][key]
            if a is None or g is None:
                continue
            if a == g:
                ties += 1
            elif (a > g) == (better == "higher"):
                wins += 1
            else:
                losses += 1
        totals[key] = {
            "ai_mean": round(sum(ai_vals) / len(ai_vals), 3) if ai_vals else None,
            "greedy_mean": round(sum(gr_vals) / len(gr_vals), 3) if gr_vals else None,
            "ai_better": wins, "greedy_better": losses, "tie": ties, "n": wins + losses + ties,
        }
    return {"n_pairs": len(rows), "metrics": [{"key": k, "label": l, "better": b} for k, l, b in METRICS],
            "totals": totals, "rows": rows}


def markdown(rep: dict) -> str:
    out = [f"AI vs baseline over {rep['n_pairs']} piece×roster pairs\n",
           "| Metric | AI mean | Baseline mean | AI better | Baseline better | Tie |", "|---|---|---|---|---|---|"]
    for m in rep["metrics"]:
        t = rep["totals"][m["key"]]
        out.append(f"| {m['label']} ({m['better']} is better) | {t['ai_mean']} | {t['greedy_mean']} | "
                   f"{t['ai_better']} | {t['greedy_better']} | {t['tie']} |")
    out.append("")
    keys = [m["key"] for m in rep["metrics"]]
    out.append("| Piece | Roster | " + " | ".join(f"{k} AI/base" for k in keys) + " |")
    out.append("|---|---|" + "---|" * len(keys))
    for r in rep["rows"]:
        a, g = r["ai"], r["greedy"]
        out.append(f"| {r['piece']} | {r['roster']} | " + " | ".join(f"{a[k]}/{g[k]}" for k in keys) + " |")
    return "\n".join(out)


if __name__ == "__main__":
    d = Path(sys.argv[1] if len(sys.argv) > 1 else "../web/public/demos")
    rep = build(d)
    (d / "comparison.json").write_text(json.dumps(rep, indent=1))
    print(markdown(rep))
