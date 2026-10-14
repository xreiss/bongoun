#!/usr/bin/env python3
"""Import native-speaker recordings exported from the app ("Download recordings").

Usage: python3 tools/import_voice.py recordings/bongoun-voice-2026-10-14.json [more.json ...]
Writes app/audio/native/<hash>.<ext> and adds "<lang>|<text>|native" entries to the audio index,
so every phone plays the recording instead of the computer voice.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
INDEX = APP / "data" / "audio-index.json"
EXT = {"audio/mp4": "m4a", "audio/aac": "m4a", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav"}


def main(paths):
    if not paths:
        sys.exit(__doc__)
    index = json.loads(INDEX.read_text())
    out_dir = APP / "audio" / "native"
    out_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in paths:
        clips = json.loads(Path(path).read_text())
        for key, clip in clips.items():
            lang, _, text = key.partition("|")
            if lang not in ("km", "en") or not text:
                print(f"skip unexpected key {key!r}")
                continue
            mime = clip.get("type", "").split(";")[0]
            ext = EXT.get(mime)
            if not ext:
                print(f"skip {key!r}: unsupported type {mime!r}")
                continue
            data = base64.b64decode(clip["data"])
            if len(data) < 1000:
                print(f"skip {key!r}: too short")
                continue
            name = hashlib.sha1(key.encode()).hexdigest()[:12]
            for old in out_dir.glob(f"{name}.*"):
                old.unlink()  # a newer recording replaces the old one
            rel = f"audio/native/{name}.{ext}"
            (APP / rel).write_bytes(data)
            index[f"{key}|native"] = rel
            count += 1
    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=0))
    print(f"imported {count} recordings")


if __name__ == "__main__":
    main(sys.argv[1:])
