"""Batch-generate demo results for the web app.

  python -m coverpart.cli build --manifest ../corpus/manifest.json --out ../web/public/demos [--planners greedy ai]
  python -m coverpart.cli one --excerpt <id> --roster winds4 --planner ai
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .arrange import arrange
from .roster import PRESETS
from .score_io import load_excerpt

warnings.filterwarnings("ignore")


def piece_meta(e: dict) -> dict:
    return {
        "id": e["id"], "title": e["title"], "composer": e["composer"], "movement": e.get("movement"),
        "source": "OpenScore String Quartets (CC0)", "source_url": e.get("source_url"),
        "license": e.get("license", "CC0-1.0"), "why": e.get("why"),
        "melody_map": e.get("melody_map", []),
    }


def run_one(e: dict, manifest_dir: Path, roster_id: str, planner: str, out_dir: Path, force: bool,
            seg_len: int) -> tuple[str, str]:
    rid = f"{e['id']}__{roster_id}__{planner}"
    dest = out_dir / f"{rid}.json"
    if dest.exists() and not force:
        return rid, "cached"
    t = time.time()
    logs = []
    ex = load_excerpt(manifest_dir / e["file"], e["start_measure"], e["end_measure"], meta=e)
    res = arrange(ex, PRESETS[roster_id], planner, piece=piece_meta(e), seg_len=seg_len, log=logs.append)
    res["result_id"] = rid
    res["log"] = logs
    res["elapsed_s"] = round(time.time() - t, 1)
    dest.write_text(json.dumps(res))
    c = res["checks"]
    return rid, (f"ok {res['elapsed_s']}s  oor_before={c['notes_out_of_range_before_repair']} "
                 f"folded={c['notes_folded']} melody={c['essential_coverage']['melody']} "
                 f"bass={c['essential_coverage']['bass']} dropped={c['lines_dropped']}")


def recheck_one(f: Path, manifest: dict, manifest_dir: Path) -> tuple[str, str]:
    """Re-execute a stored plan (no planner call) so checker/metric changes apply to old results."""
    old = json.loads(f.read_text())
    piece_id, roster_id, planner = f.stem.split("__")
    e = next(x for x in manifest["excerpts"] if x["id"] == piece_id)
    ex = load_excerpt(manifest_dir / e["file"], e["start_measure"], e["end_measure"], meta=e)
    res = arrange(ex, PRESETS[roster_id], "fixed", piece=piece_meta(e), fixed_plan=old["plan"],
                  model=old.get("model"), log=lambda m: None)
    res["planner"] = planner
    for k in ("notes_out_of_range_before_repair", "notes_out_of_range_after_ai_revision", "repair_rounds",
              "revisions", "first_plan", "bass_inversions_before_revision"):
        if k in old["checks"]:
            res["checks"][k] = old["checks"][k]
    res["result_id"] = f.stem
    res["log"] = old.get("log", []) + ["rechecked: stored plan re-executed with the current checker"]
    res["elapsed_s"] = old.get("elapsed_s")
    f.write_text(json.dumps(res))
    c = res["checks"]
    return f.stem, f"bass {old['checks']['essential_coverage']['bass']} -> {c['essential_coverage']['bass']}"


def write_index(manifest: dict, out_dir: Path) -> None:
    pieces = []
    for e in manifest["excerpts"]:
        results = []
        for f in sorted(out_dir.glob(f"{e['id']}__*.json")):
            _, roster_id, planner = f.stem.split("__")
            results.append({"result_id": f.stem, "roster_id": roster_id,
                            "roster_label": PRESETS[roster_id].label, "planner": planner})
        if results:
            meta = piece_meta(e)
            meta.pop("melody_map")
            meta["measures"] = [e["start_measure"], e["end_measure"]]
            pieces.append(meta | {"results": results})
    idx = {"pieces": pieces, "rosters": [r.to_json() for r in PRESETS.values()]}
    (out_dir / "index.json").write_text(json.dumps(idx, indent=1))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="coverpart")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--manifest", default="../corpus/manifest.json")
    b.add_argument("--out", default="../web/public/demos")
    b.add_argument("--planners", nargs="+", default=["greedy", "ai"])
    b.add_argument("--rosters", nargs="+", default=list(PRESETS))
    b.add_argument("--excerpts", nargs="*", default=None)
    b.add_argument("--force", action="store_true")
    b.add_argument("--jobs", type=int, default=4)
    b.add_argument("--seg-len", type=int, default=4)
    rc = sub.add_parser("recheck")
    rc.add_argument("--manifest", default="../corpus/manifest.json")
    rc.add_argument("--out", default="../web/public/demos")
    args = ap.parse_args(argv)
    if args.cmd == "recheck":
        manifest_path = Path(args.manifest).resolve()
        manifest = json.loads(manifest_path.read_text())
        out_dir = Path(args.out).resolve()
        files = sorted(out_dir.glob("osq-*__*__*.json"))
        def safe(f):
            try:
                return recheck_one(f, manifest, manifest_path.parent)
            except Exception as e:  # noqa: BLE001 - report and keep going
                return f.stem, f"FAIL {type(e).__name__}: {e}"
        with ThreadPoolExecutor(max_workers=6) as pool:
            for stem, msg in pool.map(safe, files):
                print(stem, msg, flush=True)
        write_index(manifest, out_dir)
        return 0

    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text())
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    excerpts = [e for e in manifest["excerpts"] if not args.excerpts or e["id"] in args.excerpts]
    jobs = [(e, r, p) for e in excerpts for r in args.rosters for p in args.planners]
    print(f"{len(jobs)} job(s)")
    failures = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futs = {pool.submit(run_one, e, manifest_path.parent, r, p, out_dir, args.force, args.seg_len): (e, r, p)
                for e, r, p in jobs}
        for f in as_completed(futs):
            e, r, p = futs[f]
            try:
                rid, msg = f.result()
                print(f"{rid}: {msg}", flush=True)
            except Exception as ex:  # noqa: BLE001 - report and keep going
                failures += 1
                print(f"FAIL {e['id']}__{r}__{p}: {type(ex).__name__}: {ex}", flush=True)
    write_index(manifest, out_dir)
    print(f"index written; {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
