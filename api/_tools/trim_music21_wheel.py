"""Build the trimmed music21 wheel that the Vercel function installs (api/_wheels/).

Why: the stock music21 wheel unpacks its sample-score corpus (~66 MB under music21/corpus/<composer>/)
and pulls in matplotlib (+ fonttools, pillow, kiwisolver, contourpy) for its graphing module. Cover Part
uses neither: it loads its own excerpts from corpus/src/*.mxl and never plots. With both, the function's
dependencies come to ~251 MB on Linux, over the 225 MB point where Vercel's Python builder stops
bundling dependencies normally. Without them they come to ~115 MB.

What changes versus the stock wheel (nothing else is touched):
  - files under music21/corpus/<subdirectory>/ are dropped (the corpus *code*, music21/corpus/*.py, stays);
  - "Requires-Dist: matplotlib" is removed from METADATA (music21 treats it as optional at import);
  - the version gets a local label, 10.5.0 -> 10.5.0+nocorpus, so the modified build is never mistaken
    for the PyPI one; RECORD is regenerated.

  uvx pip download --no-deps --only-binary=:all: music21==10.5.0 -d /tmp/m21
  python api/_tools/trim_music21_wheel.py /tmp/m21/music21-10.5.0-py3-none-any.whl api/_wheels/

music21 is BSD-3-Clause; its LICENSE file is kept in the dist-info.
"""

from __future__ import annotations

import base64
import hashlib
import re
import sys
import zipfile
from pathlib import Path

LOCAL = "nocorpus"
FIXED_TIME = (2020, 2, 2, 0, 0, 0)


def keep(name: str) -> bool:
    parts = name.split("/")
    # music21/corpus/<subdir>/... is sample-score data; music21/corpus/<file> is code and stays.
    return not (len(parts) >= 4 and parts[0] == "music21" and parts[1] == "corpus")


def record_line(name: str, data: bytes) -> str:
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    return f"{name},sha256={digest},{len(data)}"


def main(src: Path, out_dir: Path) -> Path:
    zin = zipfile.ZipFile(src)
    m = re.match(r"music21-([^-]+)-py3-none-any\.whl$", src.name)
    if not m:
        raise SystemExit(f"unexpected wheel name {src.name}")
    version = m.group(1)
    new_version = f"{version}+{LOCAL}"
    old_info, new_info = f"music21-{version}.dist-info", f"music21-{new_version}.dist-info"

    entries: list[tuple[str, bytes]] = []
    dropped = 0
    for info in zin.infolist():
        name = info.filename
        if name.endswith("/") or name == f"{old_info}/RECORD":
            continue
        if not keep(name):
            dropped += 1
            continue
        data = zin.read(name)
        if name.startswith(old_info + "/"):
            name = new_info + name[len(old_info):]
            if name.endswith("/METADATA"):
                text = data.decode()
                text = re.sub(r"^Version: .*$", f"Version: {new_version}", text, count=1, flags=re.M)
                text = re.sub(r"^Requires-Dist: matplotlib\s*\n", "", text, flags=re.M)
                data = text.encode()
        entries.append((name, data))

    record = "\n".join([record_line(n, d) for n, d in entries] + [f"{new_info}/RECORD,,", ""])
    entries.append((f"{new_info}/RECORD", record.encode()))

    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"music21-{new_version}-py3-none-any.whl"
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
        for name, data in entries:
            zi = zipfile.ZipInfo(name, FIXED_TIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            zout.writestr(zi, data)
    print(f"{dest}: kept {len(entries)} files, dropped {dropped} corpus files, "
          f"{dest.stat().st_size / 1e6:.1f} MB")
    return dest


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
