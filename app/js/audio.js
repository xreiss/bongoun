// Plays audio: a native speaker's recording when one exists, else the pre-generated neural clip,
// else the device voice.

import { allClips } from './voice.js';

let index = {};
let current = null;
let ctx = null;
export const audioSettings = { slow: false };

let timings = {};

export async function loadAudioIndex() {
  const [idx, tim] = await Promise.all([
    fetch('data/audio-index.json').then((r) => r.json()),
    fetch('data/timings.json').then((r) => r.json()).catch(() => ({})),
  ]);
  index = idx;
  timings = tim;
}

/**
 * Play a clip and report which word is being spoken (read-along highlighting).
 * onWord(i) is called with the word index, and with -1 at the end.
 */
export function playTimed(lang, text, { slow = audioSettings.slow, onWord } = {}) {
  const words = timings[`${lang}|${text}${slow ? '|slow' : ''}`] || timings[`${lang}|${text}`];
  const src = (slow && index[`${lang}|${text}|slow`]) || index[`${lang}|${text}`];
  if (!src || !words) return play(lang, text, { slow }).then(() => onWord?.(-1));
  stop();
  return new Promise((resolve) => {
    const a = new Audio(src);
    current = a;
    let last = -2;
    let timer = null;
    const tick = () => {
      const t = a.currentTime;
      let i = -1;
      for (let k = 0; k < words.length; k++) if (t >= words[k][0] - 0.05) i = k;
      if (i !== last) {
        last = i;
        onWord?.(i);
      }
    };
    const done = () => {
      clearInterval(timer);
      onWord?.(-1);
      resolve();
    };
    a.onended = a.onerror = done;
    a.onpause = () => { if (current !== a) done(); };
    timer = setInterval(tick, 40);
    a.play().catch(done);
  });
}

// Recordings made on this phone (object URLs), keyed like the index: "km|សួស្តី".
const local = {};

export async function loadLocalVoices() {
  const clips = await allClips();
  for (const [key, blob] of Object.entries(clips)) local[key] = URL.createObjectURL(blob);
}

/** Register (or remove, with null) a recording made on this phone. */
export function setLocalVoice(key, blob) {
  if (local[key]) URL.revokeObjectURL(local[key]);
  if (blob) local[key] = URL.createObjectURL(blob);
  else delete local[key];
}

/** A native recording for this text, if any (this phone first, then ones shipped with the app). */
export function nativeVoice(lang, text) {
  return local[`${lang}|${text}`] || index[`${lang}|${text}|native`] || null;
}

export function hasAudio(lang, text) {
  return Boolean(index[`${lang}|${text}`]);
}

export function stop() {
  if (current) {
    current.pause();
    current = null;
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Play a clip; resolves when playback ends (or fails). */
export function play(lang, text, { slow = audioSettings.slow, machine = false } = {}) {
  stop();
  const native = machine ? null : nativeVoice(lang, text);
  const src = native || (slow && index[`${lang}|${text}|slow`]) || index[`${lang}|${text}`];
  if (!src) return speakFallback(lang, text, slow);
  return new Promise((resolve) => {
    const a = new Audio(src);
    // Recordings have no slow version: slow them down while keeping the voice's pitch.
    if (native && slow) {
      a.preservesPitch = true;
      a.playbackRate = 0.7;
    }
    current = a;
    a.onended = a.onerror = () => resolve();
    a.play().catch(() => resolve());
  });
}

/** Play several clips one after another, with a short pause between them. */
export async function playSeq(parts) {
  for (const [lang, text, opts] of parts) {
    await play(lang, text, opts);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function speakFallback(lang, text, slow) {
  if (!('speechSynthesis' in window)) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text.replace(/^letter:/, ''));
    u.lang = lang === 'km' ? 'km-KH' : 'en-US';
    u.rate = slow ? 0.6 : 0.95;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

/** Short feedback tones (no files needed). */
export function tone(ok) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = ok ? [660, 880] : [220, 180];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = ok ? 'sine' : 'triangle';
      const t = ctx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.2);
    });
  } catch {
    /* audio context unavailable */
  }
}
