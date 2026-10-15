#!/usr/bin/env python3
"""Generate isolated English phonics sounds with Gemini text-to-speech, check them, then add them to the app.

1. Key in Learnering/.env:   GEMINI_API_KEY=...   (a paid key: the free tier rate-limits speech)
2. Generate + auto-check:    python3 tools/gemini_phonics.py            (or only some: ... a e b)
   → tools/phonics-candidates/<letter>.wav  + report.json
   Each sound is tried with several spellings; silence is trimmed; Gemini then listens and must hear
   one isolated sound matching the target (not a word, not the letter name) before a clip is kept.
3. Listen (tools/phonics-candidates/index.html), delete any you dislike, then:
                             python3 tools/gemini_phonics.py --accept
   → app/audio/en-sounds/<letter>.wav + "en|sound:<letter>" in the audio index

The phonics "new word" card then sounds the word out (c… a… t) when every letter has a sound.
"""
import array
import base64
import io
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
INDEX = APP / "data" / "audio-index.json"
CANDIDATES = ROOT / "tools" / "phonics-candidates"
API = "https://generativelanguage.googleapis.com/v1beta"
VOICE = "Kore"
LISTENER = "gemini-flash-latest"
RATE = 24000

# Letter → (IPA, example word, accepted IPA spellings from the listener).
SOUNDS = {
    "a": ("æ", "cat", {"æ", "a"}), "e": ("ɛ", "bed", {"ɛ", "e"}), "i": ("ɪ", "pig", {"ɪ", "i"}),
    "o": ("ɒ", "dog", {"ɒ", "ɑ", "ɔ"}), "u": ("ʌ", "sun", {"ʌ", "ə", "ɐ"}),
    "b": ("b", "bat", {"b"}), "c": ("k", "cat", {"k"}), "d": ("d", "dog", {"d"}), "f": ("f", "fan", {"f"}),
    "g": ("ɡ", "gift", {"ɡ", "g"}), "h": ("h", "hat", {"h"}), "j": ("dʒ", "jet", {"dʒ", "ʤ"}),
    "k": ("k", "key", {"k"}), "l": ("l", "log", {"l"}), "m": ("m", "map", {"m"}), "n": ("n", "net", {"n"}),
    "p": ("p", "pen", {"p"}), "r": ("ɹ", "red", {"ɹ", "r"}), "s": ("s", "sun", {"s"}), "t": ("t", "ten", {"t"}),
    "v": ("v", "van", {"v"}), "w": ("w", "web", {"w"}), "x": ("ks", "box", {"ks"}), "z": ("z", "zebra", {"z"}),
}

# The speech model reads its input aloud (it does not follow instructions), so the input must BE the
# sound. Candidate spellings per letter, tried in order; the listener decides which one worked.
SPELLINGS = {
    "a": ["/æ/", "æ", "aa", "ăă"], "e": ["/ɛ/", "ɛ", "eh", "ĕ"], "i": ["/ɪ/", "ɪ", "ih", "ĭ"],
    "o": ["/ɒ/", "/ɑ/", "ah", "ŏ"], "u": ["/ʌ/", "ʌ", "uh", "ŭ"],
    "b": ["/b/", "b.", "bh"], "c": ["/k/", "k.", "kh"], "d": ["/d/", "d.", "dh"], "f": ["fff", "/f/", "ff"],
    "g": ["/ɡ/", "g.", "gh"], "h": ["hh", "/h/", "hhh", "h", "hhhh"], "j": ["/dʒ/", "j."], "k": ["/k/", "k.", "kh"],
    "l": ["lll", "/l/"], "m": ["mmm", "/m/"], "n": ["nnn", "/n/"], "p": ["/p/", "p.", "pp"],
    "r": ["rrr", "/ɹ/"], "s": ["sss", "/s/"], "t": ["/t/", "t.", "tt"], "v": ["vvv", "/v/"],
    "w": ["/w/", "ww", "w.", "www"], "x": ["ks", "/ks/", "kss"], "z": ["zzz", "/z/"],
}


def key():
    env = ROOT / ".env"
    for line in env.read_text().splitlines() if env.exists() else []:
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("Add GEMINI_API_KEY=... to .env first.")


def api(path, body=None, tries=5):
    for attempt in range(tries):
        req = urllib.request.Request(
            f"{API}/{path}",
            data=json.dumps(body).encode() if body else None,
            headers={"x-goog-api-key": key(), "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return json.load(res)
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 503) and attempt < tries - 1:
                time.sleep(10 * (attempt + 1))
                continue
            raise


def tts_model():
    names = [m["name"].split("/", 1)[1] for m in api("models?pageSize=200").get("models", []) if "tts" in m["name"]]
    if not names:
        sys.exit("No Gemini text-to-speech model is available for this key.")
    return sorted(names, key=lambda n: ("lite" in n, "pro" in n, "preview" in n))[0]


def speak(model, text):
    out = api(f"models/{model}:generateContent", {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}},
        },
    })
    return base64.b64decode(out["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])


def trim(pcm, threshold=400, pad_ms=60):
    """Cut leading/trailing silence. Returns (pcm, seconds of sound)."""
    a = array.array("h", pcm)
    win = RATE // 100  # 10 ms
    loud = [i for i in range(0, len(a), win) if max((abs(x) for x in a[i:i + win]), default=0) > threshold * 3
            and (sum(x * x for x in a[i:i + win]) / win) ** 0.5 > threshold]
    if not loud:
        return b"", 0.0
    pad = RATE * pad_ms // 1000
    start, end = max(0, loud[0] - pad), min(len(a), loud[-1] + win + pad)
    cut = a[start:end]
    # short fades so the clip doesn't click
    fade = min(len(cut) // 4, RATE // 200)
    for k in range(fade):
        cut[k] = int(cut[k] * k / fade)
        cut[-1 - k] = int(cut[-1 - k] * k / fade)
    return cut.tobytes(), (loud[-1] - loud[0] + win) / RATE


def to_wav(pcm):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return buf.getvalue()


def listen(wav):
    """Ask Gemini what single sound it hears."""
    out = api(f"models/{LISTENER}:generateContent", {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": "audio/wav", "data": base64.b64encode(wav).decode()}},
            {"text": "This clip should be ONE isolated English speech sound (a phoneme) for a phonics lesson. "
                     "Return JSON: ipa (the phoneme you hear, IPA), single_sound (true if it is one isolated sound, "
                     "false if it is a word, a syllable with an added vowel like 'buh', or several sounds), "
                     "letter_name (true if it is the name of a letter like 'bee' or 'ay'), note (short)."},
        ]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "responseSchema": {
            "type": "OBJECT",
            "properties": {"ipa": {"type": "STRING"}, "single_sound": {"type": "BOOLEAN"},
                           "letter_name": {"type": "BOOLEAN"}, "note": {"type": "STRING"}},
            "required": ["ipa", "single_sound", "letter_name", "note"],
        }},
    })
    return json.loads(out["candidates"][0]["content"]["parts"][0]["text"])


def make(model, letter, rounds=2):
    ipa, example, ok_ipa = SOUNDS[letter]
    tries = []
    for _ in range(rounds):
        for template in SPELLINGS[letter]:
            pcm, secs = trim(speak(model, template))
            if not pcm or secs > 1.6:
                tries.append({"prompt": template, "rejected": f"length {secs:.2f}s"})
                continue
            wav = to_wav(pcm)
            heard = listen(wav)
            heard_ipa = heard["ipa"].strip("/[] ").replace("ː", "")
            # x is really two sounds (/k/ + /s/), so it can't be "single".
            good = (heard["single_sound"] or letter == "x") and not heard["letter_name"] and heard_ipa in ok_ipa
            tries.append({"prompt": template, "secs": round(secs, 2), "heard": heard, "kept": good})
            if good:
                (CANDIDATES / f"{letter}.wav").write_bytes(wav)
                return {"letter": letter, "ipa": ipa, "ok": True, "tries": tries}
    return {"letter": letter, "ipa": ipa, "ok": False, "tries": tries}


def review_page(report):
    rows = "\n".join(
        f'<tr><td><b>{r["letter"]}</b></td><td>/{r["ipa"]}/ as in {SOUNDS[r["letter"]][1]}</td>'
        + (f'<td><audio controls src="{r["letter"]}.wav"></audio></td><td>✓</td>' if r["ok"]
           else '<td>—</td><td>no good clip</td>')
        + "</tr>" for r in report)
    (CANDIDATES / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Phonics sounds review</title>"
        "<style>body{font:16px system-ui;margin:24px}td{padding:6px 12px}</style>"
        f"<h1>Phonics sounds</h1><p>Delete the files you don't like, then run --accept.</p><table>{rows}</table>")


def accept():
    index = json.loads(INDEX.read_text())
    out_dir = APP / "audio" / "en-sounds"
    out_dir.mkdir(parents=True, exist_ok=True)
    done = []
    for wav in sorted(CANDIDATES.glob("*.wav")):
        if wav.stem in SOUNDS:
            shutil.copy(wav, out_dir / wav.name)
            index[f"en|sound:{wav.stem}"] = f"audio/en-sounds/{wav.name}"
            done.append(wav.stem)
    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=0))
    print(f"accepted sounds: {' '.join(done) or '(none)'}")


def main(args):
    if "--accept" in args:
        return accept()
    letters = [a for a in args if a in SOUNDS] or list(SOUNDS)
    CANDIDATES.mkdir(parents=True, exist_ok=True)
    model = tts_model()
    print(f"speech model: {model} · listener: {LISTENER}")
    report_path = CANDIDATES / "report.json"
    report = {r["letter"]: r for r in json.loads(report_path.read_text())} if report_path.exists() else {}
    for letter in letters:
        r = make(model, letter)
        report[letter] = r
        last = r["tries"][-1] if r["tries"] else {}
        print(f"{letter} /{r['ipa']}/: {'OK' if r['ok'] else 'FAILED'} after {len(r['tries'])} tries"
              + (f" — heard {last.get('heard', {}).get('ipa')!r}" if last.get("heard") else ""))
    ordered = [report[k] for k in SOUNDS if k in report]
    report_path.write_text(json.dumps(ordered, ensure_ascii=False, indent=1))
    review_page(ordered)
    print(f"{sum(r['ok'] for r in ordered)}/{len(ordered)} sounds kept → {CANDIDATES.relative_to(ROOT)}/index.html")


if __name__ == "__main__":
    main(sys.argv[1:])
