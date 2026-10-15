#!/usr/bin/env python3
"""Generate the reading stories (her) and Khmer dialogues (Xavier) once, with the lightest model that works.

    python3 tools/gen_content.py [stories|dialogues]     (needs GEMINI_API_KEY in .env)

- English stories: the cheapest model (flash-lite) writes them; every word is checked against the words
  the app teaches (sight words + vocabulary), and a story is regenerated until it only uses those.
- Khmer (story translations, dialogues): flash with minimal thinking — lite makes Khmer mistakes.
Writes app/data/stories.json and app/data/dialogues.json. Then run tools/build_audio.py for the audio.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "app" / "data"
API = "https://generativelanguage.googleapis.com/v1beta"
LIGHT = "gemini-flash-lite-latest"  # English text
KHMER = "gemini-flash-latest"  # anything in Khmer

STORY_THEMES = [
    "my cat", "the big dog", "a hot day", "my family", "at the shop", "rain", "the red hat", "a bug and a duck",
    "I can run", "a fish in the box", "my bed", "the sun and the moon", "a gift", "I like mango", "a ship", "we eat rice",
]
DIALOGUES = [
    ("👋", "Meeting someone", "meeting a new person: names, where you are from, nice to meet you"),
    ("🥭", "At the market", "buying mangoes at a market, asking the price and bargaining politely"),
    ("🛺", "Tuk-tuk ride", "taking a tuk-tuk: where to, how much, stop here"),
    ("🍜", "At a restaurant", "ordering food and a drink, asking for the bill"),
    ("👨‍👩‍👧", "Meeting her family", "a foreign boyfriend meeting his girlfriend's parents politely"),
    ("📞", "On the phone", "a short phone call to say I am coming home late"),
    ("🧭", "Asking the way", "asking how to get to the market and understanding left, right, straight"),
    ("💊", "At the pharmacy", "explaining a headache and buying medicine"),
]


def key():
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("Add GEMINI_API_KEY to .env")


def generate(model, prompt, temperature=0.8):
    thinking = {"thinkingBudget": 0} if "lite" in model or "2.5" in model else {"thinkingLevel": "low"}
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature, "responseMimeType": "application/json", "thinkingConfig": thinking}}
    for attempt in range(5):
        req = urllib.request.Request(f"{API}/models/{model}:generateContent", data=json.dumps(body).encode(),
                                     headers={"x-goog-api-key": key(), "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                out = json.load(res)
            return json.loads(out["candidates"][0]["content"]["parts"][0]["text"])
        except urllib.error.HTTPError as exc:
            if exc.code == 400 and "thinkingConfig" in body["generationConfig"]:
                del body["generationConfig"]["thinkingConfig"]  # model without that setting
                continue
            if exc.code in (429, 500, 503):
                time.sleep(5 * (attempt + 1))
                continue
            raise
    raise RuntimeError("Gemini kept failing")


def vocabulary():
    concepts = json.loads((DATA / "concepts.json").read_text())
    words = {c["en"].lower() for c in concepts if re.fullmatch(r"[A-Za-z]+", c["en"])}
    return concepts, words | {"i"}


def stories(allowed):
    out = []
    word_list = ", ".join(sorted(allowed))
    for n, theme in enumerate(STORY_THEMES, 1):
        for attempt in range(6):
            s = generate(LIGHT, f"""Write a very simple story titled about "{theme}" for an adult who is just learning to read English.
Rules: 3 to 5 short sentences (3 to 7 words each). Present tense. Use ONLY words from this list (any capitalisation): {word_list}.
No other words, no names, no numbers written as digits. End each sentence with a period (or ! or ?).
Return JSON: {{"title": "2-4 word title using only allowed words", "emoji": "one emoji", "sentences": ["...", "..."]}}""")
            text = " ".join([s["title"], *s["sentences"]])
            bad = sorted({w for w in re.findall(r"[a-z']+", text.lower()) if w not in allowed})
            if not bad and 3 <= len(s["sentences"]) <= 5:
                out.append({"id": f"story{n}", "title": s["title"], "emoji": s["emoji"], "sentences": [{"en": x} for x in s["sentences"]]})
                print(f"story {n}: {s['title']!r} ({attempt + 1} tries)")
                break
            print(f"  story {n} retry — outside vocabulary: {bad[:6]}")
        else:
            print(f"story {n}: skipped")
    # One Khmer pass for all sentences (and titles), with the model that writes good Khmer.
    items = [x["title"] for x in out] + [s["en"] for x in out for s in x["sentences"]]
    km = generate(KHMER, "Translate each English line into natural, simple spoken Khmer (Cambodia) for an adult learner. "
                         "Keep the meaning exact, no explanations. Return JSON {\"km\": [...]} with one Khmer string per line, same order.\n"
                         + json.dumps(items, ensure_ascii=False), temperature=0.2)["km"]
    if len(km) != len(items):
        sys.exit("translation count mismatch — run again")
    it = iter(km)
    for x in out:
        x["titleKm"] = next(it)
    for x in out:
        for s in x["sentences"]:
            s["km"] = next(it)
    return out


def dialogues():
    out = []
    for n, (emoji, title, theme) in enumerate(DIALOGUES, 1):
        for attempt in range(4):
            d = generate(KHMER, f"""Write a short, natural everyday dialogue in spoken Cambodian Khmer for an English-speaking man learning Khmer.
Situation: {theme}. 5 or 6 lines, alternating speakers A (the learner, a man) and B. Polite but natural, as people really speak in Phnom Penh.
Use correct male/female polite particles (male says បាទ, female says ចាស) — never write "បាទ/ចាស". Keep each line short (under 12 words).
Return JSON {{"lines": [{{"speaker": "A" or "B", "km": "Khmer script", "rom": "simple English-style romanization", "en": "natural English translation"}}]}}""", temperature=0.6)
            lines = d.get("lines", [])
            ok = 4 <= len(lines) <= 7 and all(re.search(r"[ក-៿]", l.get("km", "")) and "/" not in l["km"] and l.get("rom") and l.get("en") for l in lines)
            if ok:
                out.append({"id": f"dlg{n}", "emoji": emoji, "title": title, "lines": lines})
                print(f"dialogue {n}: {title} ({len(lines)} lines)")
                break
            print(f"  dialogue {n} retry")
    return out


def main():
    concepts, allowed = vocabulary()
    only = sys.argv[1:]  # e.g. "stories" or "dialogues" to regenerate just one kind
    if not only or "stories" in only:
        s = stories(allowed)
        (DATA / "stories.json").write_text(json.dumps(s, ensure_ascii=False, indent=1))
        print(f"{len(s)} stories written")
    if not only or "dialogues" in only:
        d = dialogues()
        (DATA / "dialogues.json").write_text(json.dumps(d, ensure_ascii=False, indent=1))
        print(f"{len(d)} dialogues written")


if __name__ == "__main__":
    main()
