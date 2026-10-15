#!/usr/bin/env python3
"""Pre-generate native neural audio for every text the app can speak.

Usage: .venv/bin/python tools/build_audio.py
Writes app/audio/<lang>/<hash>.mp3 and app/data/audio-index.json.
Already generated files are skipped, so re-running only adds new texts.
"""
import asyncio
import hashlib
import json
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
DATA = APP / "data"

VOICES = {
    "km": "km-KH-SreymomNeural",
    "en": "en-US-AvaNeural",
}
SLOW_RATE = "-35%"
CONCURRENCY = 8
TIMED = set()  # keys whose word timings are saved for read-along highlighting
TIMINGS_PATH = DATA / "timings.json"

LETTER_NAMES = {
    "A": "ay", "B": "bee", "C": "see", "D": "dee", "E": "ee", "F": "eff",
    "G": "jee", "H": "aitch", "I": "eye", "J": "jay", "K": "kay", "L": "el",
    "M": "em", "N": "en", "O": "oh", "P": "pee", "Q": "cue", "R": "ar",
    "S": "ess", "T": "tee", "U": "you", "V": "vee", "W": "double you",
    "X": "ex", "Y": "why", "Z": "zee",
}


def collect():
    """Return {key: (lang, text_to_say, rate)}."""
    jobs = {}

    def add(lang, key_text, say=None, slow=True):
        say = say or key_text
        jobs[f"{lang}|{key_text}"] = (lang, say, "+0%")
        if slow:
            jobs[f"{lang}|{key_text}|slow"] = (lang, say, SLOW_RATE)

    concepts = json.loads((DATA / "concepts.json").read_text())
    for c in concepts:
        add("en", c["en"])
        if c["km"]:
            add("km", c["km"], c["km"].replace(" / ", ", "))

    # Reading stories: English sentences are timed word by word (read-along highlighting).
    stories_path = DATA / "stories.json"
    for st in json.loads(stories_path.read_text()) if stories_path.exists() else []:
        add("en", st["title"])
        add("km", st["titleKm"], slow=False)
        for sentence in st["sentences"]:
            add("en", sentence["en"])
            TIMED.add(f"en|{sentence['en']}")
            TIMED.add(f"en|{sentence['en']}|slow")
            add("km", sentence["km"], slow=False)
    dialogues_path = DATA / "dialogues.json"
    for dl in json.loads(dialogues_path.read_text()) if dialogues_path.exists() else []:
        for line in dl["lines"]:
            add("km", line["km"])

    for letter, name in LETTER_NAMES.items():
        add("en", f"letter:{letter}", name)

    script = json.loads((DATA / "khmer-script.json").read_text())
    for c in script["consonants"]:
        add("km", c["ch"])
    for v in script["vowels"]:
        add("km", "ក" + v["v"])
        add("km", "គ" + v["v"])
    for s in script["subscripts"]:
        add("km", s["word"])

    ui = json.loads((DATA / "ui.json").read_text())
    for text in ui["km"].values():
        add("km", text, slow=False)
    return jobs


def path_for(lang, key):
    digest = hashlib.sha1(key.encode()).hexdigest()[:12]
    return f"audio/{lang}/{digest}.mp3"


async def synth(sem, lang, say, rate, out, timing_key=None, timings=None):
    async with sem:
        for attempt in range(3):
            try:
                if timing_key is None:
                    await edge_tts.Communicate(say, VOICES[lang], rate=rate).save(str(out))
                    return True
                audio, words = bytearray(), []
                async for chunk in edge_tts.Communicate(say, VOICES[lang], rate=rate, boundary="WordBoundary").stream():
                    if chunk["type"] == "audio":
                        audio.extend(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        start = chunk["offset"] / 1e7
                        words.append([round(start, 3), round(start + chunk["duration"] / 1e7, 3), chunk["text"]])
                out.write_bytes(bytes(audio))
                timings[timing_key] = words
                return True
            except Exception as exc:  # network hiccups
                if attempt == 2:
                    print(f"FAILED {lang} {say!r}: {exc}")
                    out.unlink(missing_ok=True)
                    return False
                await asyncio.sleep(1 + attempt)


async def main():
    jobs = collect()
    timings = json.loads(TIMINGS_PATH.read_text()) if TIMINGS_PATH.exists() else {}
    index, tasks = {}, []
    sem = asyncio.Semaphore(CONCURRENCY)
    for key, (lang, say, rate) in jobs.items():
        rel = path_for(lang, key)
        out = APP / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        index[key] = rel
        timed = key in TIMED
        if not out.exists() or out.stat().st_size == 0 or (timed and key not in timings):
            tasks.append(synth(sem, lang, say, rate, out, key if timed else None, timings))
    print(f"{len(jobs)} clips, {len(tasks)} to generate")
    results = await asyncio.gather(*tasks)
    failed = results.count(False)
    index = {k: v for k, v in index.items() if (APP / v).exists()}
    # Keep native-speaker recordings (tools/import_voice.py) and phonics sounds (tools/gemini_phonics.py).
    index_path = DATA / "audio-index.json"
    if index_path.exists():
        old = json.loads(index_path.read_text())
        index.update({k: v for k, v in old.items() if (k.endswith("|native") or k.startswith("en|sound:")) and (APP / v).exists()})
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=0))
    TIMINGS_PATH.write_text(json.dumps({k: v for k, v in timings.items() if k in TIMED}, ensure_ascii=False))
    print(f"done, {failed} failed, index has {len(index)} entries")


if __name__ == "__main__":
    asyncio.run(main())
