"""Instrument table.

Ranges are WRITTEN pitch for the instrument (how a director reads a part), per player level.
They are typical school/community ensemble ranges, not hard physical limits, and any player
can override them in the roster. `transpose_to_sounding` is the interval from written to
sounding pitch (music21 interval name), e.g. Bb clarinet sounds a major second lower: "-M2".
"""

from __future__ import annotations

from dataclasses import dataclass

from music21 import interval, pitch


@dataclass(frozen=True)
class Instrument:
    key: str
    label: str
    transpose_to_sounding: str  # written -> sounding
    clef: str  # "treble" | "bass" | "alto" | "treble8vb"
    gm_program: int  # 0-based General MIDI program
    ranges: dict[str, tuple[str, str]]  # level -> (low, high), written pitch
    family: str
    sustain: str  # short description of timbre/role tendencies, fed to the planner


INSTRUMENTS: dict[str, Instrument] = {
    i.key: i
    for i in [
        Instrument("flute", "Flute", "P1", "treble", 73,
                   {"beginner": ("F4", "C6"), "intermediate": ("D4", "G6"), "advanced": ("C4", "C7")},
                   "woodwind", "agile, bright on top, weak below G4"),
        Instrument("oboe", "Oboe", "P1", "treble", 68,
                   {"beginner": ("D4", "C6"), "intermediate": ("C4", "E6"), "advanced": ("B-3", "G6")},
                   "woodwind", "reedy, carries a melody, tires on long sustained lines"),
        Instrument("clarinet", "Clarinet in B♭", "-M2", "treble", 71,
                   {"beginner": ("G3", "C5"), "intermediate": ("E3", "C6"), "advanced": ("E3", "G6")},
                   "woodwind", "wide range, dark low register, very agile"),
        Instrument("alto_sax", "Alto Sax in E♭", "-M6", "treble", 65,
                   {"beginner": ("D4", "C6"), "intermediate": ("C4", "E6"), "advanced": ("B-3", "F#6")},
                   "woodwind", "warm, blends with horns and strings, good for inner and counter lines"),
        Instrument("tenor_sax", "Tenor Sax in B♭", "-M9", "treble", 66,
                   {"beginner": ("D4", "C6"), "intermediate": ("C4", "E6"), "advanced": ("B-3", "F#6")},
                   "woodwind", "warm tenor register, covers viola/cello lines"),
        Instrument("bari_sax", "Baritone Sax in E♭", "-M13", "treble", 67,
                   {"beginner": ("D4", "C6"), "intermediate": ("C4", "E6"), "advanced": ("B-3", "F#6")},
                   "woodwind", "bass voice of a sax section"),
        Instrument("bassoon", "Bassoon", "P1", "bass", 70,
                   {"beginner": ("C2", "C4"), "intermediate": ("B-1", "G4"), "advanced": ("B-1", "D5")},
                   "woodwind", "bass and tenor lines, light staccato, singing tenor register"),
        Instrument("trumpet", "Trumpet in B♭", "-M2", "treble", 56,
                   {"beginner": ("B-3", "C5"), "intermediate": ("G3", "G5"), "advanced": ("F#3", "C6")},
                   "brass", "bright and loud; soft sustained accompaniment is tiring"),
        Instrument("horn", "Horn in F", "-P5", "treble", 60,
                   {"beginner": ("C4", "C5"), "intermediate": ("G3", "G5"), "advanced": ("C3", "C6")},
                   "brass", "round, blends, ideal for sustained inner pads"),
        Instrument("trombone", "Trombone", "P1", "bass", 57,
                   {"beginner": ("B-2", "D4"), "intermediate": ("F2", "F4"), "advanced": ("E2", "B-4")},
                   "brass", "bass and tenor lines; fast passagework is hard"),
        Instrument("euphonium", "Euphonium", "P1", "bass", 58,
                   {"beginner": ("B-2", "D4"), "intermediate": ("F2", "F4"), "advanced": ("B-1", "B-4")},
                   "brass", "lyrical tenor voice, can sing a cello melody"),
        Instrument("tuba", "Tuba", "P1", "bass", 58,
                   {"beginner": ("B-1", "C3"), "intermediate": ("F1", "F3"), "advanced": ("D1", "B-3")},
                   "brass", "bass line only; slow-moving notes"),
        Instrument("violin", "Violin", "P1", "treble", 40,
                   {"beginner": ("G3", "B5"), "intermediate": ("G3", "D6"), "advanced": ("G3", "E7")},
                   "strings", "agile, can play anything melodic"),
        Instrument("viola", "Viola", "P1", "alto", 41,
                   {"beginner": ("C3", "E5"), "intermediate": ("C3", "A5"), "advanced": ("C3", "E6")},
                   "strings", "inner voices, warm melody in the middle register"),
        Instrument("cello", "Cello", "P1", "bass", 42,
                   {"beginner": ("C2", "D4"), "intermediate": ("C2", "A4"), "advanced": ("C2", "A5")},
                   "strings", "bass line, singing tenor melodies"),
        Instrument("double_bass", "Double Bass", "-P8", "bass", 43,
                   {"beginner": ("E2", "A3"), "intermediate": ("E2", "D4"), "advanced": ("E2", "G4")},
                   "strings", "bass line, sounds an octave below written"),
    ]
}

LEVELS = ("beginner", "intermediate", "advanced")


def get(key: str) -> Instrument:
    try:
        return INSTRUMENTS[key]
    except KeyError as e:
        raise ValueError(f"unknown instrument {key!r}; known: {sorted(INSTRUMENTS)}") from e


def written_to_sounding(name: str, instrument_key: str) -> pitch.Pitch:
    """Convert a written pitch name (e.g. 'G5') for an instrument to its sounding pitch."""
    p = pitch.Pitch(name)
    return interval.Interval(get(instrument_key).transpose_to_sounding).transposePitch(p)


def sounding_to_written(p: pitch.Pitch, instrument_key: str) -> pitch.Pitch:
    iv = interval.Interval(get(instrument_key).transpose_to_sounding).reverse()
    return iv.transposePitch(p)
