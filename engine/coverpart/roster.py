"""Rosters: the players a group actually has."""

from __future__ import annotations

from dataclasses import dataclass, field

from music21 import pitch

from . import instruments as ins


@dataclass
class Player:
    id: str
    instrument: str
    level: str = "intermediate"
    label: str | None = None
    range_override: tuple[str, str] | None = None  # written pitch

    def __post_init__(self) -> None:
        inst = ins.get(self.instrument)
        if self.level not in ins.LEVELS:
            raise ValueError(f"level must be one of {ins.LEVELS}")
        if self.label is None:
            self.label = inst.label
        if self.range_override is not None:
            try:
                lo, hi = (pitch.Pitch(x) for x in self.range_override)
            except Exception as e:  # noqa: BLE001 - music21 raises several types for bad names
                raise ValueError(f"bad range_override {self.range_override!r}: {e}") from e
            if hi.ps - lo.ps < 12:
                # Folding a note by octaves only guarantees a fit when the range spans an octave.
                raise ValueError(f"range_override {self.range_override!r} must span at least an octave")

    @property
    def range_written(self) -> tuple[str, str]:
        return self.range_override or ins.get(self.instrument).ranges[self.level]

    @property
    def range_sounding(self) -> tuple[pitch.Pitch, pitch.Pitch]:
        lo, hi = self.range_written
        return ins.written_to_sounding(lo, self.instrument), ins.written_to_sounding(hi, self.instrument)

    def fits(self, p: pitch.Pitch) -> bool:
        lo, hi = self.range_sounding
        return lo.ps <= p.ps <= hi.ps

    def to_json(self) -> dict:
        lo, hi = self.range_sounding
        return {
            "id": self.id,
            "label": self.label,
            "instrument": self.instrument,
            "level": self.level,
            "range_written": list(self.range_written),
            "range_sounding": [lo.nameWithOctave, hi.nameWithOctave],
        }


@dataclass
class Roster:
    id: str
    label: str
    players: list[Player] = field(default_factory=list)

    def player(self, pid: str) -> Player:
        for p in self.players:
            if p.id == pid:
                return p
        raise KeyError(pid)

    def to_json(self) -> dict:
        return {"id": self.id, "label": self.label, "players": [p.to_json() for p in self.players]}

    @classmethod
    def from_json(cls, d: dict) -> "Roster":
        players = [
            Player(
                id=p["id"],
                instrument=p["instrument"],
                level=p.get("level", "intermediate"),
                label=p.get("label"),
                range_override=tuple(p["range_override"]) if p.get("range_override") else None,
            )
            for p in d["players"]
        ]
        ids = [p.id for p in players]
        if len(set(ids)) != len(ids):
            raise ValueError("player ids must be unique")
        return cls(id=d.get("id", "custom"), label=d.get("label", "Custom roster"), players=players)


PRESETS: dict[str, Roster] = {
    r.id: r
    for r in [
        Roster("winds4", "Flute, clarinet, alto sax, bassoon", [
            Player("fl", "flute"), Player("cl", "clarinet"), Player("asx", "alto_sax"), Player("bsn", "bassoon"),
        ]),
        Roster("no_viola", "Quartet that lost its viola: 2 violins, cello, + a clarinet", [
            Player("vn1", "violin", "advanced", label="Violin 1 (advanced)"), Player("vn2", "violin", label="Violin 2"),
            Player("vc", "cello"),
            Player("cl", "clarinet"),
        ]),
        Roster("church_brass", "Church brass: 2 trumpets (one beginner), horn, euphonium", [
            Player("tp1", "trumpet", label="Trumpet 1"), Player("tp2", "trumpet", "beginner", label="Trumpet 2 (beginner)"),
            Player("hn", "horn"), Player("euph", "euphonium"),
        ]),
        Roster("sax_trio", "Three saxes and nothing else", [
            Player("asx", "alto_sax"), Player("tsx", "tenor_sax"), Player("bsx", "bari_sax"),
        ]),
    ]
}
