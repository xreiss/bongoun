# BongOun (បងអូន) — plan

Two learners, one app (offline PWA, works on both phones):

| Profile | Learns | Interface | Key constraint |
|---|---|---|---|
| Her | English (reading + writing) | Khmer **audio** + pictures | Can't read well, so every instruction is spoken in Khmer |
| Xavier | Khmer (script + speaking) | English | Khmer script and the two-series vowel system |

French, Indonesian, Chinese and Spanish come later, once these two work well.

## What changed from the original plan

1. **Audio: pre-generated neural voices instead of live Google TTS.**
   The `translate.google.com/translate_tts` trick is unofficial, rate-limited and blocked by CORS.
   `tools/build_audio.py` uses Microsoft neural voices (`km-KH-SreymomNeural`, `en-US-AvaNeural`)
   to make every clip once, at normal and slow speed. That gives real native Khmer and works offline.
   No API key is needed and nothing is fetched at runtime.
2. **Spaced repetition drives everything.** Each item (letter, consonant, vowel, word, phrase) has a memory "box" (0–8).
   The box picks both *when* it comes back (1, 2, 4, 8… days) and *which exercise* is used, from easy to hard:
   - English: listen → picture, read → picture, picture → word, then spell with letter tiles
     (sentences: order the words). Letters: hear → letter, letter → picture, then trace with a finger.
   - Khmer words: listen → meaning, read script → meaning, meaning → script (romanization fades out at box 4).
   - Khmer script: hear → consonant, consonant → sound, consonant → series A/O, syllable → reading.
3. **Script and vocabulary in parallel** for Khmer, so the alphabet is never studied in isolation.
4. **Illiterate-friendly by design:** big picture answers, auto-played Khmer instructions, a 🔊 replay on everything,
   a 🐢 slow mode, wrong answers re-queued a few cards later at an easier level.

## Steps

- [x] **Step 1 — Core app (Khmer ↔ English).** 120 shared concepts with emoji, 26 letters, 33 consonants, 24 vowels,
      subscripts, 695 audio clips, SRS engine, both courses, alphabet reference, offline PWA, progress backup.
- [ ] **Step 2 — Validate content with a native speaker.** Use the in-app "Native check" (Khmer course): she checks the Khmer words, romanizations and audio
      (TTS can misread single consonants). Fix anything in `app/data/*.json`, then re-run the audio build.
- [ ] **Step 3 — Deploy** to GitHub Pages (or Netlify) so both phones can "Add to Home Screen".
- [x] **Step 4a — Phonics:** 5 short-vowel units (a e i o u, 36 CVC words) right after the alphabet: blending
      animation, first-letter, missing-vowel (c_t), rhyme matching (options read aloud), then spelling.
      Neural TTS can't say isolated phonemes reliably, so every clip is a real word (analytic phonics / word families).
- [x] **Step 4c — Her handwriting:** Writing screen with three modes — ✏️ trace, 👀 copy, 🎧 from memory —
      for A–Z, a–z and the phonics words, on ruled lines in the Andika school font, all instructions spoken in Khmer.
      In reviews: trace (level 3) → write the other case from memory (B → b, level 4); phonics words end with
      "hear it, write it". Copy/memory writing is scaled onto the model before scoring, so position and size don't matter.
- [ ] **Step 4b — Her next level:** sight words (the, is, my…), short stories with karaoke highlighting,
      digraphs (sh, ch, th), recording her voice to compare with the model.
- [x] **Step 5a — Khmer handwriting:** same three-mode Writing screen (33 consonants + subscript words) in the
      traditional Battambang typeface; reviews add consonant tracing (level 4) and writing from memory (level 5).
- [ ] **Step 5b — Your next level:** stroke-order animations, more subscripts, classifiers, polite registers
      (បាទ/ចាស, kinship pronouns បង/អូន), and dialogue units.
- [ ] **Step 6 — AI tutor (optional):** a Gemini or Claude key in settings to translate any sentence into Khmer with a breakdown.
      It needs a small proxy so audio can be made for new text.
- [ ] **Step 7 — More languages:** add `fr`, `id`, `zh`, `es` fields to `concepts.json`, voices to `build_audio.py`,
      and a course entry in `courses.js`.

## Adding content

1. Edit `app/data/concepts.json` (or `khmer-script.json`, `ui.json`).
2. Put new concepts into a unit in `app/js/courses.js` (units pull by category, so new words in an existing category appear automatically).
3. Run `.venv/bin/python tools/build_audio.py`. Only new clips are generated.
