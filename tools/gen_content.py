#!/usr/bin/env python3
"""Generate the reading stories (her) and Khmer dialogues (Xavier) once, with the lightest model that works.

    python3 tools/gen_content.py [stories|grammar|english|dialogues]     (needs GEMINI_API_KEY in .env)

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
        except (urllib.error.URLError, ConnectionError, TimeoutError, json.JSONDecodeError, KeyError):
            time.sleep(5 * (attempt + 1))  # dropped connection or truncated answer: try again
    raise RuntimeError("Gemini kept failing")


GRAMMAR = [
    ("be", "I am / you are", "the verb to be: I am, you are, he/she/it is, we/they are (+ isn't, aren't)", "none"),
    ("article", "a · an · this · that", "a / an, this / that, these / those", "none"),
    ("plural", "One cat, two cats", "plural nouns: cat → cats, box → boxes, man → men, and numbers", "none"),
    ("have", "I have · she has", "have / has, don't have / doesn't have", "none"),
    ("present", "Every day", "present simple for habits: I eat, she eats; I don't, she doesn't; Do you…?", "now"),
    ("now", "Right now", "present continuous: I am eating, she is sleeping (happening now)", "now"),
    ("past", "Yesterday", "past simple: I walked, I ate, I went, I saw, I was (with yesterday / last night)", "past"),
    ("future", "Tomorrow", "future: I will go, I am going to eat (with tomorrow / next week)", "future"),
    ("can", "I can · I can't", "can / can't for ability and asking (Can you help me?)", "none"),
    ("questions", "What? Where? Who?", "question words: what, where, who, when, how much, how many", "none"),
    ("place", "In · on · under", "prepositions of place: in, on, under, next to, behind", "none"),
    ("pronouns", "Me · my · her", "pronouns and possessives: I/me/my, you/your, he/him/his, she/her/her, we/us/our", "none"),
]
EN_DIALOGUES = [
    ("🛒", "At the shop", "buying fruit and paying at a small shop"),
    ("🩺", "At the doctor", "telling the doctor you feel sick, the doctor gives advice"),
    ("📞", "On the phone", "a friend calls to ask where you are and when you come"),
    ("👋", "Meeting a friend", "meeting a friend, asking how they are and what they did yesterday"),
    ("🍽️", "At a restaurant", "ordering food and a drink, asking how much"),
    ("🚌", "Asking the way", "asking where the bus station is"),
    ("🏠", "At home", "a couple talking about dinner tonight and what to cook"),
    ("📅", "Making plans", "planning to go to the market tomorrow morning"),
]


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


def grammar():
    """Practice sentences per grammar lesson (English by the light model, Khmer by the Khmer model)."""
    out = []
    for gid, title, focus, time_hint in GRAMMAR:
        tense = "Mix sentences about the past (yesterday), now, and the future (tomorrow); label each." if gid in ("present", "now", "past", "future") else ""
        for attempt in range(5):
            g = generate(LIGHT, f"""Create 8 practice sentences teaching this English grammar point to an adult beginner: {focus}.
Rules: 3 to 8 words each, very common everyday words, clearly correct English. {tense}
For each sentence give: "en" (the sentence), "emoji" (one emoji picturing it), "time": "past", "now", "future" or "none",
"blank" (the ONE word in the sentence that shows the grammar point, written exactly as in the sentence),
"options" (2 or 3 WRONG alternatives for that word, e.g. other forms of the same verb — never correct in that sentence).
Also give "examples": 3 very short model sentences showing the rule.
Return JSON {{"examples": ["..."], "items": [{{"en": "...", "emoji": "...", "time": "...", "blank": "...", "options": ["..."]}}]}}""", temperature=0.5)
            items = []
            for it in g.get("items", []):
                words = re.findall(r"[A-Za-z']+", it.get("en", ""))
                opts = [o for o in it.get("options", []) if o.lower() != it.get("blank", "").lower()]
                if it.get("blank") in words and 2 <= len(opts) <= 3 and 3 <= len(words) <= 9 and it.get("time") in ("past", "now", "future", "none"):
                    items.append({**it, "options": opts})
            if len(items) >= 6 and len(g.get("examples", [])) >= 2:
                out.append({"id": gid, "title": title, "time": time_hint, "examples": g["examples"][:3], "items": items[:8]})
                print(f"grammar {gid}: {len(items[:8])} sentences")
                break
            print(f"  grammar {gid} retry ({len(items)} valid)")
    # Khmer: a short spoken explanation per lesson + translations of every sentence, in one pass per lesson.
    for g in out:
        k = generate(KHMER, f"""You teach English to a Cambodian woman who cannot read well; your words will be READ ALOUD to her.
Grammar point: {[x for x in GRAMMAR if x[0] == g["id"]][0][2]}.
1) "explain": 2-3 short, simple spoken Khmer sentences explaining the rule (you may say the English words inside the Khmer).
2) "km": natural Khmer translations of these English lines, same order: {json.dumps(g["examples"] + [i["en"] for i in g["items"]])}
Return JSON {{"explain": "...", "km": ["..."]}}""", temperature=0.3)
        km = k["km"]
        if len(km) != len(g["examples"]) + len(g["items"]):
            sys.exit(f"grammar {g['id']}: translation count mismatch — run again")
        g["explainKm"] = k["explain"]
        g["examplesKm"] = km[: len(g["examples"])]
        for it, t in zip(g["items"], km[len(g["examples"]):]):
            it["km"] = t
    return out


def dialogues_en():
    """Everyday English conversations for her: simple English (light model) + Khmer meaning (Khmer model)."""
    out = []
    for n, (emoji, title, theme) in enumerate(EN_DIALOGUES, 1):
        for attempt in range(4):
            d = generate(LIGHT, f"""Write a short everyday English dialogue for an adult beginner. Situation: {theme}.
5 or 6 lines, speakers A (the learner, a woman) and B, alternating. Very simple, natural spoken English, 3 to 9 words per line.
Prices in US dollars (as in Cambodia). No names.
Return JSON {{"lines": [{{"speaker": "A" or "B", "en": "..."}}]}}""", temperature=0.6)
            lines = d.get("lines", [])
            if 4 <= len(lines) <= 7 and all(l.get("en") and len(l["en"].split()) <= 12 for l in lines):
                break
        km = generate(KHMER, "Translate each English line into natural spoken Khmer. Speaker A is a woman (says ចាស), speaker B is a man (says បាទ). Never write alternatives with a slash. Return JSON {\"km\": [...]} same order.\n"
                             + json.dumps([l["en"] for l in lines]), temperature=0.2)["km"]
        for l, t in zip(lines, km):
            l["km"] = t
        out.append({"id": f"edlg{n}", "emoji": emoji, "title": title, "lines": lines})
        print(f"english dialogue {n}: {title}")
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
    if not only or "grammar" in only:
        g = grammar()
        (DATA / "grammar.json").write_text(json.dumps(g, ensure_ascii=False, indent=1))
        print(f"{len(g)} grammar lessons written")
    if not only or "english" in only:
        e = dialogues_en()
        (DATA / "dialogues-en.json").write_text(json.dumps(e, ensure_ascii=False, indent=1))
        print(f"{len(e)} English dialogues written")
    if not only or "dialogues" in only:
        d = dialogues()
        (DATA / "dialogues.json").write_text(json.dumps(d, ensure_ascii=False, indent=1))
        print(f"{len(d)} dialogues written")


if __name__ == "__main__":
    main()
