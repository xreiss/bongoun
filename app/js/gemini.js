// Google Gemini (AI Studio key): listen to the learner's English, and translate for the Khmer learner.
// The key is pasted in Settings on each phone and stays in that phone's storage — never in the code.

const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = 'learnering:gemini';
// Preferred models, best first; the first one this key can use wins. Names change, so we also
// fall back to any "flash" model the account lists.
const PREFERRED = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'];

function settings() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export const hasGemini = () => Boolean(settings().key && settings().model);

export function forgetGemini() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

async function call(path, { key = settings().key, body } = {}) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Gemini error ${res.status}`);
  return json;
}

/** Check a key, pick a model it can use, and save both. Returns the model name. */
export async function connectGemini(key) {
  const list = await call('models?pageSize=200', { key });
  const usable = (list.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  const model =
    PREFERRED.find((m) => usable.includes(m)) ||
    usable.find((m) => /flash/.test(m) && !/lite|tts|image|live|audio|embedding/.test(m)) ||
    usable.find((m) => /gemini/.test(m) && !/tts|image|live|embedding/.test(m));
  if (!model) throw new Error('This key has no usable Gemini model.');
  localStorage.setItem(KEY, JSON.stringify({ key, model }));
  return model;
}

export const geminiModel = () => settings().model;

async function generate(parts, schema, { temperature = 0.2 } = {}) {
  const { model } = settings();
  const out = await call(`models/${model}:generateContent`, {
    body: {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
    },
  });
  const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return JSON.parse(text);
}

const toBase64 = (blob) =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });

/**
 * Listen to a recording of a beginner saying `expected` (an English word or short phrase).
 * Returns { heard, verdict: 'correct' | 'close' | 'wrong' | 'silent', wrongLetters: [indexes], tip }.
 */
export async function checkSpeech(blob, expected) {
  const audio = await toBase64(blob);
  const prompt = `You are a kind, accurate English pronunciation coach. The learner is an adult Khmer native speaker who is a complete beginner and cannot read well.
They were asked to say the English word or phrase: "${expected}".
Listen to the audio and judge ONLY the pronunciation of "${expected}".
- heard: what they actually said, written in English letters (best guess; "" if nothing audible).
- verdict: "correct" if a native listener would clearly understand "${expected}" (accent is fine), "close" if recognisable but one sound is clearly off, "wrong" if it sounds like a different word, "silent" if there is no speech.
- wrongLetters: 0-based indexes of the letters in "${expected}" whose sound was wrong (empty if correct). For a multi-letter sound like "sh" include both letters.
- tip: one short, simple tip in English (max 12 words) about the sound to fix, or "" if correct.
Be encouraging but honest: do not mark "correct" when the vowel or a consonant was clearly replaced.`;
  return generate(
    [{ inline_data: { mime_type: (blob.type || 'audio/mp4').split(';')[0], data: audio } }, { text: prompt }],
    {
      type: 'OBJECT',
      properties: {
        heard: { type: 'STRING' },
        verdict: { type: 'STRING', enum: ['correct', 'close', 'wrong', 'silent'] },
        wrongLetters: { type: 'ARRAY', items: { type: 'INTEGER' } },
        tip: { type: 'STRING' },
      },
      required: ['heard', 'verdict', 'wrongLetters', 'tip'],
    },
  );
}

/** Translate English or French into natural spoken Khmer, with a word-by-word breakdown. */
export async function translateToKhmer(text) {
  const prompt = `Translate into natural, everyday spoken Khmer (Cambodia) for a French/English speaker learning Khmer: "${text}"
Return:
- khmer: the translation in Khmer script (polite, natural; if the speaker's gender matters, use the male form and mention the female form in notes).
- romanization: simple English-style romanization of the whole sentence (e.g. "knyom srolanh neak").
- words: each Khmer word or chunk in order, with its romanization and literal meaning in English.
- notes: 1-2 short notes on politeness, word order or usage (in English).
- examples: two more short example sentences using the key word, each with khmer, romanization and english.`;
  const word = {
    type: 'OBJECT',
    properties: { khmer: { type: 'STRING' }, romanization: { type: 'STRING' }, english: { type: 'STRING' } },
    required: ['khmer', 'romanization', 'english'],
  };
  return generate([{ text: prompt }], {
    type: 'OBJECT',
    properties: {
      khmer: { type: 'STRING' },
      romanization: { type: 'STRING' },
      words: { type: 'ARRAY', items: word },
      notes: { type: 'STRING' },
      examples: { type: 'ARRAY', items: word },
    },
    required: ['khmer', 'romanization', 'words', 'notes', 'examples'],
  });
}
