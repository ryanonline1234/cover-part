"""The AI planner. Claude reads compact phrase summaries (never raw notation) plus the roster,
and returns a JSON plan. Code validates it and sends problems back for revision.

Backends:
  - "sdk": Anthropic Python SDK, used when ANTHROPIC_API_KEY is set (structured outputs).
  - "cli": headless `claude -p` on the local machine (the developer's own Claude subscription),
           used for local runs and for precomputing the demo results.
"""

from __future__ import annotations

import copy
import json
import os
import subprocess
import tempfile
from pathlib import Path

from . import instruments as ins
from .plan import PLAN_SCHEMA
from .roster import Roster
from .score_io import Excerpt

DEFAULT_MODEL = "claude-opus-5-5"
CLAUDE_BIN = os.environ.get("COVERPART_CLAUDE_BIN", str(Path.home() / ".local/bin/claude"))

SYSTEM = """You are an experienced arranger for school, church and community ensembles. A director has \
a piece written for one set of instruments and a different set of players. You decide who plays what \
so the piece still sounds like itself and every player can actually play their part.

You will get (1) a phrase-by-phrase summary of each source line of the excerpt, in concert (sounding) \
pitch, and (2) the roster: each player's instrument, level and playable SOUNDING range.

How to read the summaries: `opening_notes` lists the first notes of the top voice of that line as \
pitch/duration (w h q e s, dotted with "."). `stepwise` is the share of steps of a 2nd or less; \
`repeated_notes` the share of repeated pitches; `notes_per_beat` rhythmic activity; `doubles` names other \
lines sounding the same pitch classes at the same moments (share of onsets). `highest_part_here` and \
`lowest_part_here` are about register only — the melody is NOT necessarily the highest line. Find it \
from the music: a singable contour, mostly stepwise with some leaps, varied rhythm, phrase shape. \
Repeated-note and arpeggio patterns, long held notes under a moving line, and lines that double another \
line are accompaniment.

Priorities, in order:
1. The melody must always sound, wherever it moves (violin, viola, cello…). Give it to a player whose \
timbre can carry it, and keep it audible above or clearly apart from the accompaniment. Never drop a \
span you label melody. If it is wider than any one player's range, split it between two players at a \
phrase point, or keep it anyway: the checker will move the few notes that don't fit by an octave, and a \
few moved notes are far better than a missing tune.
2. The bass line must always sound, and stay at the bottom. Never drop a span you label bass. When you \
move any other line down an octave, make sure it does not sink below the bass in the same bars \
(the checker reports every note that sounds under the bass line).
3. Then countermelodies, then inner harmony. Drop doublings and filler first when you run out of players.
4. Continuity: a player keeps one line for long stretches. Hand a line to another player only at a \
phrase boundary and only for a musical or range reason. Don't hop lines every few bars.
5. Idiom: fast passagework to agile instruments (flute, clarinet, violin, sax), not tuba or trombone; \
soft sustained inner notes suit horn, clarinet, sax; beginners get the simplest line that fits; brass \
tires on long soft sustained accompaniment.
6. Range: every note must fit the player's SOUNDING range. Use `octave_shift` (whole octaves, applied to \
the whole assignment) to fit; prefer 0. If you move the melody by an octave, keep it above the \
accompaniment, or move the accompaniment too. If a line can't fit any free player, drop it and say why.

Hard rules (code checks these and will send violations back to you):
- A player plays at most ONE source line in any measure (no overlapping assignments for a player).
- Every measure in which a source line has notes is covered by at least one assignment of that line or \
by an explicit `dropped` entry for that line. Measure ranges are inclusive and inside the excerpt.
- Use the exact `source_part` and `player` ids given.
- `chord_policy`: "top" keeps the highest note of a chord (melody/upper lines), "bottom" the lowest \
(bass), "keep" keeps chords and is only meaningful for string players.

Return `roles` covering every source line across the whole excerpt, one short `reason` per assignment \
written for the director (what the line is and why this player), and a 2-4 sentence `summary` of the \
musical idea of your cover."""


def _player_brief(roster: Roster) -> list[dict]:
    out = []
    for p in roster.players:
        spec = ins.get(p.instrument)
        lo, hi = p.range_sounding
        out.append({
            "id": p.id, "instrument": spec.label, "level": p.level,
            "range_sounding": [lo.nameWithOctave, hi.nameWithOctave],
            "range_written": list(p.range_written),
            "character": spec.sustain,
        })
    return out


def _strict(schema):
    """Structured outputs want additionalProperties: false everywhere and no numeric bounds."""
    s = copy.deepcopy(schema)

    def walk(node):
        if isinstance(node, dict):
            node.pop("minimum", None)
            node.pop("maximum", None)
            if node.get("type") == "object":
                node["additionalProperties"] = False
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(s)
    return s


class Session:
    def __init__(self, summary: dict, roster: Roster, ex: Excerpt, backend: str | None = None,
                 model: str | None = None, log=print):
        self.summary = summary
        self.roster = roster
        self.ex = ex
        self.backend = backend or ("sdk" if os.environ.get("ANTHROPIC_API_KEY") else "cli")
        self.model_name = model or DEFAULT_MODEL
        self.log = log
        self.calls: list[dict] = []
        self.data = json.dumps({"excerpt": summary, "roster": _player_brief(roster)}, indent=1)

    # --- public ---
    def first_plan(self) -> dict:
        return self._call(f"Plan the cover.\n\n{self.data}")

    def revise(self, plan: dict, problems: list, kind: str) -> dict:
        what = {
            "structure": "These structural problems were found in your plan",
            "range": "These notes are outside the player's sounding range after your octave shifts",
            "voicing": ("These voicing problems were found after executing your plan: `below_bass` means "
                        "that player sounds under the player carrying the original bass line in those bars "
                        "(events = how many notes, max_semitones = how far under); `bass_missing` means "
                        "nobody plays the original bass line there. Fix them with octave shifts or by "
                        "reassigning, without breaking the range rules"),
        }[kind]
        msg = (f"{self.data}\n\nYour previous plan:\n{json.dumps(plan, indent=1)}\n\n{what}:\n"
               f"{json.dumps(problems, indent=1)}\n\nReturn a complete corrected plan. Change only what you "
               f"need to; keep the musical idea.")
        return self._call(msg)

    # --- backends ---
    def _call(self, user: str) -> dict:
        if self.backend == "sdk":
            plan, meta = self._call_sdk(user)
        else:
            plan, meta = self._call_cli(user)
        self.calls.append(meta)
        self.log(f"  planner call: {meta}")
        return plan

    def _call_sdk(self, user: str) -> tuple[dict, dict]:
        import anthropic

        client = anthropic.Anthropic()
        resp = client.messages.create(
            model=self.model_name,
            max_tokens=16000,
            system=SYSTEM,
            messages=[{"role": "user", "content": user}],
            output_config={"effort": "high",
                           "format": {"type": "json_schema", "schema": _strict(PLAN_SCHEMA)}},
        )
        if resp.stop_reason == "refusal":
            raise RuntimeError(f"planner refused: {resp.stop_details}")
        text = next(b.text for b in resp.content if b.type == "text")
        return json.loads(text), {"backend": "sdk", "model": resp.model,
                                  "in": resp.usage.input_tokens, "out": resp.usage.output_tokens}

    def _call_cli(self, user: str) -> tuple[dict, dict]:
        with tempfile.TemporaryDirectory() as td:
            sysf = Path(td) / "system.txt"
            sysf.write_text(SYSTEM)
            cmd = [CLAUDE_BIN, "-p", user, "--safe-mode", "--tools", "", "--strict-mcp-config",
                   "--disable-slash-commands", "--output-format", "json", "--model", self.model_name,
                   "--effort", "high", "--system-prompt-file", str(sysf),
                   "--json-schema", json.dumps(PLAN_SCHEMA)]
            r = subprocess.run(cmd, cwd=td, capture_output=True, text=True, timeout=900)
        if r.returncode != 0:
            raise RuntimeError(f"claude CLI failed ({r.returncode}): {r.stderr[-2000:] or r.stdout[-2000:]}")
        d = json.loads(r.stdout)
        if d.get("is_error") or "structured_output" not in d:
            raise RuntimeError(f"claude CLI returned no structured output: {str(d)[:1500]}")
        mu = next(iter((d.get("modelUsage") or {}).values()), {})
        return d["structured_output"], {"backend": "cli", "model": self.model_name,
                                        "seconds": round(d.get("duration_ms", 0) / 1000, 1),
                                        "out": mu.get("outputTokens"), "cost_usd_equiv": d.get("total_cost_usd")}
