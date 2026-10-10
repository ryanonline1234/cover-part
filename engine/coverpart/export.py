"""MusicXML and MIDI export."""

from __future__ import annotations

import base64
import copy

from music21 import clef, metadata, midi, stream, tempo
from music21.musicxml.m21ToXml import GeneralObjectExporter

from . import instruments as ins
from .execute import _make_instrument
from .roster import Roster
from .score_io import Excerpt


def to_musicxml(s: stream.Score) -> str:
    return GeneralObjectExporter(s).parse().decode("utf-8")


def to_midi_b64(s: stream.Score) -> str:
    mf = midi.translate.streamToMidiFile(s)
    return base64.b64encode(mf.writestr()).decode("ascii")


def with_title(s: stream.Score, title: str, composer: str | None = None) -> stream.Score:
    s.metadata = metadata.Metadata()
    s.metadata.title = title
    if composer:
        s.metadata.composer = composer
    return s


def original_score(ex: Excerpt) -> stream.Score:
    s = copy.deepcopy(ex.score)
    first = s.parts[0].getElementsByClass(stream.Measure)[0]
    if not first.recurse().getElementsByClass(tempo.MetronomeMark):
        first.insert(0, tempo.MetronomeMark(number=ex.qpm))
    return s


def written_part(concert_part: stream.Part, roster: Roster, pid: str, title: str) -> stream.Score:
    player = roster.player(pid)
    spec = ins.get(player.instrument)
    p = copy.deepcopy(concert_part)
    for old in p.getElementsByClass("Instrument"):
        p.remove(old)
    p.insert(0, _make_instrument(player, with_transposition=True))
    p.atSoundingPitch = True
    w = p.toWrittenPitch(inPlace=False)
    first = w.getElementsByClass(stream.Measure)[0]
    for c in list(first.recurse().getElementsByClass(clef.Clef)):
        c.activeSite.remove(c)
    first.insert(0, {"bass": clef.BassClef, "alto": clef.AltoClef}.get(spec.clef, clef.TrebleClef)())
    for n in w.recurse().notes:
        n.style.color = None
    sc = stream.Score()
    sc.insert(0, w)
    return with_title(sc, f"{title} — {player.label}")
