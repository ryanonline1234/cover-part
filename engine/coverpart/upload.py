"""A director's own score: read an uploaded MusicXML file, list what it holds, cut an excerpt.

Nothing is stored. The file arrives with every request (inspect, then each arrange) and is dropped
when the request ends.

music21 needs about 30 s to parse a whole four-movement quartet, and the live function has 60 s, so
the file is read with ElementTree first: listing movements and bars never touches music21, and for an
arrangement the XML is trimmed to the chosen bars (carrying the divisions, key, time, clef, transposition
and tempo in force) before music21 parses it. The excerpt is then converted to sounding (concert) pitch
and cut by the same code as the demo corpus (score_io.excerpt_from_score).

Movements are found the way score_io finds them in the corpus files: the bar number goes back to 0 or 1.
"""

from __future__ import annotations

import base64
import binascii
import copy
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath, PureWindowsPath

from .score_io import Excerpt, excerpt_from_score

MAX_FILE_BYTES = 3 * 1024 * 1024  # what the site sends; base64 makes it 4 MB, under Vercel's 4.5 MB body cap
MAX_B64_CHARS = 4 * ((MAX_FILE_BYTES + 2) // 3)
MAX_XML_BYTES = 40 * 1024 * 1024  # a compressed .mxl may not unpack to more than this
MAX_PARTS = 8
MAX_BARS = 32
EXTENSIONS = (".musicxml", ".xml", ".mxl")
SOURCE = "Uploaded by you; not stored"

UNREADABLE = ("This file couldn't be read as MusicXML. In your notation program (MuseScore, Finale, "
              "Sibelius, Dorico), use File → Export → MusicXML, then choose that file.")


class UploadError(ValueError):
    """A problem with the uploaded file or the chosen bars, in words a director can act on."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# --- bytes -----------------------------------------------------------------------------------------

def clean_filename(filename: str) -> str:
    name = PureWindowsPath(PurePosixPath(filename or "").name).name.strip()
    return name[:120] or "score.musicxml"


def _extension(filename: str) -> str:
    name = clean_filename(filename).lower()
    for ext in EXTENSIONS:
        if name.endswith(ext):
            return ext
    raise UploadError(f"“{clean_filename(filename)}” isn't a MusicXML file. Cover Part reads .musicxml, .xml "
                      "or .mxl (in most notation programs: File → Export → MusicXML).")


def decode(filename: str, data_base64: str) -> bytes:
    """The uploaded bytes, with the size limits checked before and after decoding."""
    _extension(filename)
    s = (data_base64 or "").strip()
    if s.startswith("data:") and "," in s:  # tolerate a data: URL
        s = s.split(",", 1)[1]
    s = re.sub(r"\s+", "", s)
    if len(s) > MAX_B64_CHARS + 4:
        raise UploadError(_too_big(len(s) * 3 // 4), status=413)
    try:
        raw = base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError) as e:
        raise UploadError("The file didn't arrive intact (it wasn't valid base64). Try choosing it again.") from e
    if not raw:
        raise UploadError(f"“{clean_filename(filename)}” is empty.")
    if len(raw) > MAX_FILE_BYTES:
        raise UploadError(_too_big(len(raw)), status=413)
    return raw


def _too_big(n: int) -> str:
    return (f"This file is {n / (1024 * 1024):.1f} MB; the most Cover Part takes is "
            f"{MAX_FILE_BYTES // (1024 * 1024)} MB. Export just the movement you need, or save it as "
            "compressed MusicXML (.mxl), which is much smaller.")


def _xml_bytes(filename: str, raw: bytes) -> bytes:
    if len(raw) > MAX_FILE_BYTES:
        raise UploadError(_too_big(len(raw)), status=413)
    if _extension(filename) != ".mxl" and not raw.startswith(b"PK\x03\x04"):
        return raw
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as e:
        raise UploadError("This .mxl file isn't a valid compressed MusicXML file. " + UNREADABLE) from e
    with zf:
        names = zf.namelist()
        target = None
        if "META-INF/container.xml" in names:
            try:
                croot = ET.fromstring(_read_member(zf, "META-INF/container.xml"))
                rf = next((el for el in croot.iter() if el.tag.split("}")[-1] == "rootfile"), None)
                if rf is not None and rf.get("full-path") in names:
                    target = rf.get("full-path")
            except ET.ParseError:
                target = None
        if target is None:
            target = next((n for n in names if not n.startswith("META-INF/")
                           and n.lower().endswith((".xml", ".musicxml"))), None)
        if target is None:
            raise UploadError("This .mxl file holds no MusicXML score. " + UNREADABLE)
        return _read_member(zf, target)


def _read_member(zf: zipfile.ZipFile, name: str) -> bytes:
    info = zf.getinfo(name)
    if info.file_size > MAX_XML_BYTES:
        raise UploadError("This score is too large to arrange here. Export just the movement you need.", status=413)
    with zf.open(info) as f:
        data = f.read(MAX_XML_BYTES + 1)
    if len(data) > MAX_XML_BYTES:
        raise UploadError("This score is too large to arrange here. Export just the movement you need.", status=413)
    return data


def _parse_xml(data: bytes) -> ET.Element:
    head = data[:20000]
    if b"<!ENTITY" in head:  # MusicXML never defines entities; refuse entity-expansion tricks outright
        raise UploadError(UNREADABLE)
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise UploadError(UNREADABLE) from e
    for el in root.iter():  # MusicXML has no namespace, but be lenient with exporters that add one
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    if root.tag == "score-timewise":
        raise UploadError("This MusicXML file is in the rare “timewise” layout. Export it again as ordinary "
                          "(partwise) MusicXML.")
    if root.tag != "score-partwise":
        raise UploadError(UNREADABLE)
    return root


# --- what the file holds ---------------------------------------------------------------------------

def _text(el: ET.Element | None) -> str:
    return " ".join("".join(el.itertext()).split()) if el is not None else ""


def _bar_number(raw: str | None, prev: int | None) -> tuple[int, bool]:
    """(number, is_regular). Like music21: "12" -> 12; "12a" -> 12 (a suffix); an irregular bar that
    MuseScore numbers "X1" (excluded from the bar count) takes the previous bar's number."""
    m = re.match(r"\s*(-?\d+)(.*)$", raw or "")
    if m:
        return int(m.group(1)), not m.group(2).strip()
    return (prev if prev is not None else 0), False


@dataclass
class Layout:
    root: ET.Element
    title: str
    composer: str | None
    part_names: list[str]  # one per music21 part (a piano part's two staves are two parts)
    part_pitched: list[bool]
    numbers: list[int]  # final bar number per measure index (after any renumbering)
    movement_of: list[int]
    movements: list[dict]
    notes: list[str] = field(default_factory=list)


def _staves(part: ET.Element) -> int:
    for st in part.iter("staves"):
        try:
            return max(1, int(_text(st)))
        except ValueError:
            return 1
    return 1


def _dedupe(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    for n in names:
        seen[n] = seen.get(n, 0) + 1
    count: dict[str, int] = {}
    out = []
    for n in names:
        if seen[n] > 1:
            count[n] = count.get(n, 0) + 1
            out.append(f"{n} {count[n]}")
        else:
            out.append(n)
    return out


def read_layout(filename: str, raw: bytes) -> Layout:
    root = _parse_xml(_xml_bytes(filename, raw))
    parts = root.findall("part")
    if not parts:
        raise UploadError("This MusicXML file has no parts in it.")
    names_by_id = {}
    for sp in root.iter("score-part"):
        nm = _text(sp.find("part-name"))
        if not nm or nm.lower() in ("musicxml part", "part"):
            nm = _text(sp.find("score-instrument/instrument-name")) or nm
        names_by_id[sp.get("id")] = nm
    names, pitched = [], []
    for k, part in enumerate(parts):
        nm = names_by_id.get(part.get("id")) or f"Part {k + 1}"
        has_pitch = any(n.find("pitch") is not None for n in part.iter("note"))
        n_staves = _staves(part)
        if n_staves == 2:
            labels = [f"{nm} (upper staff)", f"{nm} (lower staff)"]
        elif n_staves > 2:
            labels = [f"{nm} (staff {j + 1})" for j in range(n_staves)]
        else:
            labels = [nm]
        names += labels
        pitched += [has_pitch] * len(labels)
    names = _dedupe(names)

    counts = {len(p.findall("measure")) for p in parts}
    if len(counts) != 1:
        raise UploadError("The parts in this file have different numbers of bars, so they can't be lined up. "
                          "Export the score again from your notation program.")
    measures = parts[0].findall("measure")
    if not measures:
        raise UploadError("This MusicXML file has no bars in it.")

    # Movements: a regular bar number that goes back to 0 or 1 starts a new one (as in score_io).
    raw_nums, movement_of = [], []
    mov, prev = 0, None
    for m in measures:
        num, reg = _bar_number(m.get("number"), prev)
        if reg and prev is not None and num <= prev and num <= 1:
            mov += 1
        raw_nums.append(num)
        movement_of.append(mov)
        prev = num
    numbers = list(raw_nums)
    notes = []
    movements = []
    for k in range(mov + 1):
        idx = [i for i, x in enumerate(movement_of) if x == k]
        nums = [raw_nums[i] for i in idx]
        if any(b <= a for a, b in zip(nums, nums[1:])):
            # Split bars or bars left out of the count repeat a number; the engine needs each bar to have
            # its own, so count them through and say so.
            first = nums[0]
            for j, i in enumerate(idx):
                numbers[i] = first + j
        movements.append({"index": k, "first_bar": numbers[idx[0]], "last_bar": numbers[idx[-1]], "bars": len(idx)})
        if numbers[idx[0]:idx[-1] + 1] != raw_nums[idx[0]:idx[-1] + 1]:
            movements[-1]["note"] = (
                f"Bar numbers{'' if mov == 0 else f' in movement {k + 1}'} are counted through here "
                f"({numbers[idx[0]]}–{numbers[idx[-1]]}) because the file repeats some numbers (split bars or "
                "bars left out of the count). After the first repeated number they can differ from your printed score.")
    title = (_text(root.find("work/work-title")) or _text(root.find("movement-title"))
             or re.sub(r"\.(musicxml|xml|mxl)$", "", clean_filename(filename), flags=re.I))
    composer = next((_text(c) for c in root.iter("creator") if c.get("type") == "composer" and _text(c)), None)
    if composer and composer.lower() == "music21":
        composer = None
    if not any(pitched):
        raise UploadError("This file has no pitched notes in it (only rests or percussion).")
    left = [n for n, p in zip(names, pitched) if not p]
    if left:
        notes.append("Left out (no pitched notes): " + ", ".join(left) + ".")
    for i, mv in enumerate(movements):
        mv["label"] = f"Movement {i + 1}" if len(movements) > 1 else (_text(root.find("movement-title")) or "Whole score")
    return Layout(root, title[:160], composer[:120] if composer else None, names, pitched, numbers, movement_of,
                  movements, notes)


def inspect(filename: str, raw: bytes) -> dict:
    lay = read_layout(filename, raw)
    return {
        "title": lay.title,
        "composer": lay.composer,
        # first_measure/last_measure repeat first_bar/last_bar for clients that use those names
        "movements": [mv | {"first_measure": mv["first_bar"], "last_measure": mv["last_bar"]} for mv in lay.movements],
        "parts": [n for n, p in zip(lay.part_names, lay.part_pitched) if p],
        "limits": {"max_bytes": MAX_FILE_BYTES, "max_bars": MAX_BARS, "max_parts": MAX_PARTS},
        "notes": lay.notes + [mv["note"] for mv in lay.movements if mv.get("note")],
    }


# --- the excerpt -----------------------------------------------------------------------------------

_ATTR_ORDER = ("divisions", "key", "time", "staves", "part-symbol", "instruments", "clef", "staff-details",
               "transpose")


def _trim(lay: Layout, i0: int, i1: int) -> str:
    """The file cut to measures i0..i1, with the attributes and tempo in force at i0 carried into it."""
    root = lay.root
    mov = lay.movement_of[i0]
    for pi, part in enumerate(root.findall("part")):
        state: dict[tuple, ET.Element] = {}
        tempo_el = None
        for i, m in enumerate(list(part.findall("measure"))):
            if i < i0:
                for attrs in m.findall("attributes"):
                    for child in attrs:
                        state[(child.tag, child.get("number"))] = child
                if pi == 0 and lay.movement_of[i] == mov:
                    for d in m.iter("direction"):
                        if d.find("direction-type/metronome") is not None or d.find("sound[@tempo]") is not None:
                            tempo_el = d
                    for snd in m.findall("sound"):
                        if snd.get("tempo"):
                            tempo_el = snd
                part.remove(m)
            elif i > i1:
                part.remove(m)
            else:
                m.set("number", str(lay.numbers[i]))
                if i == i0:
                    insert_at = 0
                    if state:
                        carried = ET.Element("attributes")
                        for tag in _ATTR_ORDER:
                            for (t, _), el in sorted(state.items(), key=lambda kv: str(kv[0][1])):
                                if t == tag:
                                    carried.append(copy.deepcopy(el))
                        m.insert(0, carried)
                        insert_at = 1
                    if tempo_el is not None:
                        t = copy.deepcopy(tempo_el)
                        for off in t.findall("offset"):
                            t.remove(off)
                        m.insert(insert_at, t)
    return ET.tostring(root, encoding="unicode")


def load_upload_excerpt(filename: str, raw: bytes, movement_index: int, start: int, end: int
                        ) -> tuple[Excerpt, dict]:
    """The excerpt (sounding pitch, ready for arrange) and its piece metadata."""
    import warnings

    from music21 import chord, converter, harmony, instrument, note, stream

    lay = read_layout(filename, raw)
    if not 0 <= movement_index < len(lay.movements):
        raise UploadError(f"This file has {len(lay.movements)} movement(s); there is no movement {movement_index + 1}.")
    mv = lay.movements[movement_index]
    if start > end:
        raise UploadError(f"The first bar ({start}) comes after the last bar ({end}).")
    where = f"movement {movement_index + 1}" if len(lay.movements) > 1 else "this score"
    if start < mv["first_bar"] or end > mv["last_bar"]:
        raise UploadError(f"Bars {start}–{end} aren't all in {where}: it has bars {mv['first_bar']}–{mv['last_bar']}.")
    idx = [i for i, (mo, n) in enumerate(zip(lay.movement_of, lay.numbers))
           if mo == movement_index and start <= n <= end]
    if not idx:
        raise UploadError(f"There are no bars {start}–{end} in {where}: it has bars {mv['first_bar']}–{mv['last_bar']}.")
    if len(idx) > MAX_BARS:
        raise UploadError(f"That's {len(idx)} bars; Cover Part arranges up to {MAX_BARS} bars at a time. "
                          "Choose a shorter stretch.")
    i0, i1 = idx[0], idx[-1]
    xml = _trim(lay, i0, i1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            sc = converter.parseData(xml, format="musicxml", forceSource=True)
        except Exception as e:  # noqa: BLE001 - music21 raises many types on odd files
            raise UploadError("These bars couldn't be read (music21 couldn't parse them). " + UNREADABLE) from e
    if isinstance(sc, stream.Opus):
        sc = sc.scores[0]
    m21_parts = list(sc.parts)
    if len(m21_parts) == len(lay.part_names):
        for p, nm in zip(m21_parts, lay.part_names):
            p.partName = nm
    sc.toSoundingPitch(inPlace=True)
    for inst in sc.recurse().getElementsByClass(instrument.Instrument):
        inst.transposition = None  # the notes are at sounding pitch now; nothing may transpose them again
    for h in list(sc.recurse().getElementsByClass(harmony.Harmony)):  # chord symbols are not a line to play
        h.activeSite.remove(h)
    for n in list(sc.recurse().notes):  # unpitched (percussion) notes in a pitched part become rests
        if not isinstance(n, (note.Note, chord.Chord)) or not n.pitches:
            n.activeSite.replace(n, note.Rest(quarterLength=n.duration.quarterLength))
    silent = []
    for p in list(sc.parts):
        p.atSoundingPitch = True
        if not any(isinstance(n, (note.Note, chord.Chord)) for n in p.recurse().notes):
            silent.append(p.partName or "a part")
            sc.remove(p)
    first_bar, last_bar = lay.numbers[i0], lay.numbers[i1]
    if not sc.parts:
        raise UploadError(f"There are no notes in bars {first_bar}–{last_bar}. Choose bars where the music plays.")
    if len(sc.parts) > MAX_PARTS:
        raise UploadError(f"These bars have {len(sc.parts)} parts with notes (a piano's two staves count as two); "
                          f"Cover Part arranges up to {MAX_PARTS}. Choose bars with fewer parts playing, or export "
                          "a reduced score.")
    meta = {"id": "upload", "movement_index": 0, "measure_index_range": [0, i1 - i0]}
    try:
        ex = excerpt_from_score(sc, first_bar, last_bar, meta, source=clean_filename(filename))
    except ValueError as e:
        raise UploadError(f"Bars {first_bar}–{last_bar} couldn't be cut from this file: {e}") from e
    notes = list(lay.notes) + ([mv["note"]] if mv.get("note") else [])
    unpitched = {nm for nm, p in zip(lay.part_names, lay.part_pitched) if not p}
    pitched_left = [nm for nm in silent if nm not in unpitched]
    if pitched_left:
        notes.append("Not playing in these bars, so left out: " + ", ".join(pitched_left) + ".")
    piece = {
        "id": "upload", "title": lay.title, "composer": lay.composer,
        "movement": mv["label"] if len(lay.movements) > 1 else None,
        "source": SOURCE, "source_url": None, "license": None, "why": None,
        "filename": clean_filename(filename), "uploaded": True, "notes": notes,
        "melody_map": [],
    }
    return ex, piece
