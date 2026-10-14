# Learnering

Offline language-learning PWA: English for a Khmer speaker (audio-first), Khmer for an English speaker.
See [PLAN.md](PLAN.md) for the roadmap.

## Run locally

```bash
cd app && python3 -m http.server 8765
```

Open http://localhost:8765. To try it on a phone on the same Wi-Fi, use your Mac's IP instead of localhost
(the service worker / offline mode only activates on localhost or HTTPS).

## Regenerate audio

```bash
python3 -m venv .venv && .venv/bin/pip install edge-tts
.venv/bin/python tools/build_audio.py
```

## Layout

- `app/data/` — concepts (emoji + en + km + romanization), Khmer script, UI strings, generated audio index
- `app/audio/` — generated mp3 clips (content-hashed names)
- `app/js/courses.js` — units for each course
- `app/js/session.js` — spaced repetition queue and all exercise types
- `tools/build_audio.py` — neural TTS generation
