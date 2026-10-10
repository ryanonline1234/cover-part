"""Cut a manifest excerpt out of an OpenScore String Quartets .mxl.

    from corpus.extract import load_excerpt, load_manifest
    entry = load_manifest()["excerpts"][0]
    score = load_excerpt(entry)          # music21 Score: 4 parts, excerpt measures only

Why not plain ``score.measures(start, end)``: most OpenScore files hold the
whole quartet in one .mxl, measure numbers restart at every movement, and
split measures (a pickup after a mid-bar double bar or repeat) reuse the same
number with a suffix ("X1", "X2"). On the full file, ``measures(1, 2)``
returns bars 1-2 of *every* movement concatenated. So we select by 0-based
measure *index* (``measure_index_range`` in the manifest, inclusive), and fall
back to resolving (movement_index, start_measure, end_measure) when that field
is absent.

Run as a script to load every manifest entry and print a one-line summary.
"""

from __future__ import annotations

import copy
import functools
import json
import sys
import warnings
from pathlib import Path

from music21 import clef, converter, key, meter, stream

CORPUS_DIR = Path(__file__).resolve().parent
MANIFEST = CORPUS_DIR / "manifest.json"


def load_manifest(path: Path | str = MANIFEST) -> dict:
    return json.loads(Path(path).read_text())


@functools.lru_cache(maxsize=16)
def _parse(path: str) -> stream.Score:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # music21 warns about unsupported wedges etc.
        return converter.parse(path)


def movement_bounds(score: stream.Score) -> list[tuple[int, int]]:
    """(first_index, last_index) inclusive per movement, from measure-number resets in part 0.

    A new movement starts where the measure number drops back to 0 or 1.
    Split measures repeat the previous number (never drop), so they don't trigger it.
    """
    ms = list(score.parts[0].getElementsByClass(stream.Measure))
    starts = [0]
    for i in range(1, len(ms)):
        if ms[i].number < ms[i - 1].number and ms[i].number <= 1:
            starts.append(i)
    ends = [s - 1 for s in starts[1:]] + [len(ms) - 1]
    return list(zip(starts, ends))


def resolve_index_range(score: stream.Score, movement_index: int, start: int, end: int) -> tuple[int, int]:
    """Measure numbers within one movement -> inclusive 0-based index range.

    Split-measure convention: if ``start`` occurs twice, begin at its LAST
    occurrence (the pickup into the new section); if ``end`` occurs twice, stop
    at its FIRST occurrence (the half-bar that closes the section).
    """
    ms = list(score.parts[0].getElementsByClass(stream.Measure))
    lo, hi = movement_bounds(score)[movement_index]
    idx = [i for i in range(lo, hi + 1) if start <= ms[i].number <= end]
    if not idx:
        raise ValueError(f"no measures {start}-{end} in movement {movement_index}")
    first = max(i for i in idx if ms[i].number == start) if any(ms[i].number == start for i in idx) else idx[0]
    last = min(i for i in idx if ms[i].number == end) if any(ms[i].number == end for i in idx) else idx[-1]
    return first, last


def load_excerpt(entry: dict, corpus_dir: Path | str = CORPUS_DIR) -> stream.Score:
    """Return a new music21 Score holding only the excerpt's measures (all 4 parts)."""
    path = str(Path(corpus_dir) / entry["file"])
    full = _parse(path)
    if "measure_index_range" in entry:
        i0, i1 = entry["measure_index_range"]
    else:
        i0, i1 = resolve_index_range(full, entry.get("movement_index", 0),
                                     entry["start_measure"], entry["end_measure"])

    # end index is exclusive with indicesNotNumbers=True; spanners (slurs, ties) are gathered.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ex = full.measures(i0, i1 + 1, indicesNotNumbers=True)

    # measures() collects Clef/KeySignature/TimeSignature at the Part level (offset 0).
    # Move them into the first measure unless the measure already states its own,
    # and pull them from context if they were not collected at all.
    full_parts = list(full.parts)
    for pi, part in enumerate(ex.parts):
        mlist = list(part.getElementsByClass(stream.Measure))
        if not mlist:
            raise ValueError(f"{entry.get('id')}: part {pi} has no measures in excerpt")
        m0 = mlist[0]
        orig_m0 = list(full_parts[pi].getElementsByClass(stream.Measure))[i0]
        for cls in (clef.Clef, key.KeySignature, meter.TimeSignature):
            loose = [e for e in part.getElementsByClass(cls)]  # part-level, not in a measure
            for e in loose:
                part.remove(e)
            if m0.getElementsByClass(cls).getElementsByOffset(0).first() is not None:
                continue
            src = loose[0] if loose else orig_m0.getContextByClass(cls)
            if src is not None:
                m0.insert(0, copy.deepcopy(src))

    md = ex.metadata
    if md is not None:
        md.title = entry.get("title", md.title)
        md.composer = entry.get("composer", md.composer)
        md.movementName = entry.get("movement")
    ex.coreElementsChanged()
    return ex


def summarize(entry: dict, sc: stream.Score) -> str:
    parts = list(sc.parts)
    nmeas = [len(p.getElementsByClass(stream.Measure)) for p in parts]
    first = parts[0].getElementsByClass(stream.Measure).first()
    last = parts[0].getElementsByClass(stream.Measure).last()
    notes = sum(len(p.recurse().notes) for p in parts)
    ql = parts[0].duration.quarterLength
    ks = first.keySignature
    kstr = "?" if ks is None else (f"{ks.sharps}#" if ks.sharps >= 0 else f"{-ks.sharps}b")
    return (f"{entry['id']}: {len(parts)} parts, {nmeas[0]} measure objects "
            f"(m{first.number}{first.numberSuffix or ''}-m{last.number}{last.numberSuffix or ''}), "
            f"{ql:g} quarters, {notes} notes/chords, key={kstr}, "
            f"ts={first.timeSignature.ratioString if first.timeSignature else '?'}")


def _check(entry: dict, sc: stream.Score) -> list[str]:
    errs = []
    parts = list(sc.parts)
    if len(parts) != 4:
        errs.append(f"expected 4 parts, got {len(parts)}")
    nmeas = {len(p.getElementsByClass(stream.Measure)) for p in parts}
    if len(nmeas) != 1:
        errs.append(f"parts have different measure counts {nmeas}")
    if "measure_index_range" in entry:
        a, b = entry["measure_index_range"]
        if nmeas != {b - a + 1}:
            errs.append(f"measure count {nmeas} != index range size {b - a + 1}")
    first = parts[0].getElementsByClass(stream.Measure).first()
    last = parts[0].getElementsByClass(stream.Measure).last()
    if first.number != entry["start_measure"] or last.number != entry["end_measure"]:
        errs.append(f"measure numbers m{first.number}-m{last.number} != manifest {entry['start_measure']}-{entry['end_measure']}")
    for p in parts:
        m0 = p.getElementsByClass(stream.Measure).first()
        if m0.clef is None or m0.keySignature is None or m0.timeSignature is None:
            errs.append(f"{p.partName}: first measure missing clef/key/time")
    if "measure_index_range" in entry:
        full = _parse(str(CORPUS_DIR / entry["file"]))
        r = resolve_index_range(full, entry["movement_index"], entry["start_measure"], entry["end_measure"])
        if list(r) != list(entry["measure_index_range"]):
            errs.append(f"measure_index_range {entry['measure_index_range']} != resolved {list(r)}")
    return errs


if __name__ == "__main__":
    bad = 0
    for e in load_manifest()["excerpts"]:
        sc = load_excerpt(e)
        errs = _check(e, sc)
        print(summarize(e, sc) + ("" if not errs else "  !! " + "; ".join(errs)))
        bad += bool(errs)
    sys.exit(1 if bad else 0)
