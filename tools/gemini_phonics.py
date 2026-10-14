#!/usr/bin/env python3
"""Generate isolated English phonics sounds with Gemini text-to-speech, review them, then add them to the app.

1. Put your key in Learnering/.env:   GEMINI_API_KEY=...
2. Generate candidates:                python3 tools/gemini_phonics.py
   → tools/phonics-candidates/<letter>.wav  (listen to each one in Finder: space bar)
3. Delete the bad ones (or re-run with letters to retry:  python3 tools/gemini_phonics.py a e)
4. Accept the rest into the app:       python3 tools/gemini_phonics.py --accept
   → app/audio/en-sounds/<letter>.wav + "en|sound:<letter>" in the audio index

The phonics "new word" card then sounds the word out (c… a… t) before saying it, when every letter has a sound.
"""
import base64
import json
import shutil
import sys
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
INDEX = APP / "data" / "audio-index.json"
CANDIDATES = ROOT / "tools" / "phonics-candidates"
API = "https://generativelanguage.googleapis.com/v1beta"
VOICE = "Kore"  # a clear, neutral prebuilt voice

# Letter → (IPA, example) for the short sounds used in the phonics units.
SOUNDS = {
    "a": ("æ", "cat"), "e": ("ɛ", "bed"), "i": ("ɪ", "pig"), "o": ("ɒ", "dog"), "u": ("ʌ", "sun"),
    "b": ("b", "bat"), "c": ("k", "cat"), "d": ("d", "dog"), "f": ("f", "fan"), "g": ("g", "gift"),
    "h": ("h", "hat"), "j": ("dʒ", "jet"), "k": ("k", "key"), "l": ("l", "log"), "m": ("m", "map"),
    "n": ("n", "net"), "p": ("p", "pen"), "r": ("r", "red"), "s": ("s", "sun"), "t": ("t", "ten"),
    "v": ("v", "van"), "w": ("w", "web"), "x": ("ks", "box"), "z": ("z", "zebra"),
}


def key():
    env = ROOT / ".env"
    for line in env.read_text().splitlines() if env.exists() else []:
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("Add GEMINI_API_KEY=... to Learnering/.env first.")


def api(path, body=None):
    req = urllib.request.Request(
        f"{API}/{path}",
        data=json.dumps(body).encode() if body else None,
        headers={"x-goog-api-key": key(), "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.load(res)


def tts_model():
    models = api("models?pageSize=200").get("models", [])
    names = [m["name"].split("/", 1)[1] for m in models if "tts" in m["name"]]
    if not names:
        sys.exit("No Gemini text-to-speech model is available for this key.")
    return sorted(names, key=lambda n: ("pro" in n, "preview" in n))[0]


def generate(model, letter):
    ipa, example = SOUNDS[letter]
    prompt = (
        f"Say only the single isolated English speech sound /{ipa}/ — the sound of the letter '{letter}' "
        f"in '{example}', the way a phonics teacher models it to a beginner. "
        f"Do not say the letter name, do not add 'uh' after consonants, do not say any word. "
        f"One short, clear sound, then silence."
    )
    out = api(f"models/{model}:generateContent", {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}},
        },
    })
    part = out["candidates"][0]["content"]["parts"][0]["inlineData"]
    pcm = base64.b64decode(part["data"])  # 16-bit little-endian mono PCM, 24 kHz
    path = CANDIDATES / f"{letter}.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    return path


def accept():
    index = json.loads(INDEX.read_text())
    out_dir = APP / "audio" / "en-sounds"
    out_dir.mkdir(parents=True, exist_ok=True)
    done = []
    for wav in sorted(CANDIDATES.glob("*.wav")):
        letter = wav.stem
        if letter not in SOUNDS:
            continue
        shutil.copy(wav, out_dir / wav.name)
        index[f"en|sound:{letter}"] = f"audio/en-sounds/{wav.name}"
        done.append(letter)
    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=0))
    print(f"accepted sounds: {' '.join(done) or '(none)'}")


def main(args):
    if "--accept" in args:
        return accept()
    letters = [a for a in args if a in SOUNDS] or list(SOUNDS)
    CANDIDATES.mkdir(parents=True, exist_ok=True)
    model = tts_model()
    print(f"using {model}")
    for letter in letters:
        try:
            print(f"/{SOUNDS[letter][0]}/ → {generate(model, letter).relative_to(ROOT)}")
        except Exception as exc:  # keep going; failed letters can be retried
            print(f"{letter}: failed ({exc})")


if __name__ == "__main__":
    main(sys.argv[1:])
