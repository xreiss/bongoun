// Stroke order for printed English letters (school "ball and stick" manuscript), as SVG paths.
// Units: cap height = 100. y: 0 = top line, 50 = dashed middle line, 100 = baseline, 145 = descender.
// Each letter: w = advance width, s = strokes in writing order, each drawn from its start point.

export const LATIN = {
  A: { w: 100, s: ['M50 0 L10 100', 'M50 0 L90 100', 'M27 58 L73 58'] },
  B: { w: 85, s: ['M15 0 L15 100', 'M15 0 L52 0 C80 0 80 50 52 50 L15 50', 'M15 50 L56 50 C88 50 88 100 56 100 L15 100'] },
  C: { w: 90, s: ['M84 18 C72 -4 16 -6 12 50 C14 106 72 104 84 82'] },
  D: { w: 90, s: ['M15 0 L15 100', 'M15 0 L42 0 C96 0 96 100 42 100 L15 100'] },
  E: { w: 85, s: ['M15 0 L15 100', 'M15 0 L78 0', 'M15 50 L68 50', 'M15 100 L78 100'] },
  F: { w: 80, s: ['M15 0 L15 100', 'M15 0 L78 0', 'M15 50 L68 50'] },
  G: { w: 95, s: ['M84 18 C72 -4 16 -6 12 50 C14 106 80 106 86 62', 'M86 62 L58 62'] },
  H: { w: 100, s: ['M15 0 L15 100', 'M85 0 L85 100', 'M15 50 L85 50'] },
  I: { w: 70, s: ['M35 0 L35 100', 'M10 0 L60 0', 'M10 100 L60 100'] },
  J: { w: 85, s: ['M68 0 L68 72 C68 108 18 108 14 78'] },
  K: { w: 90, s: ['M15 0 L15 100', 'M80 0 L15 60', 'M36 42 L84 100'] },
  L: { w: 80, s: ['M15 0 L15 100', 'M15 100 L74 100'] },
  M: { w: 110, s: ['M15 0 L15 100', 'M15 0 L55 72 L95 0 L95 100'] },
  N: { w: 100, s: ['M15 0 L15 100', 'M15 0 L85 100 L85 0'] },
  O: { w: 100, s: ['M50 0 C22 0 10 25 10 50 C10 75 22 100 50 100 C78 100 90 75 90 50 C90 25 78 0 50 0'] },
  P: { w: 85, s: ['M15 0 L15 100', 'M15 0 L52 0 C84 0 84 54 52 54 L15 54'] },
  Q: { w: 100, s: ['M50 0 C22 0 10 25 10 50 C10 75 22 100 50 100 C78 100 90 75 90 50 C90 25 78 0 50 0', 'M58 72 L92 106'] },
  R: { w: 90, s: ['M15 0 L15 100', 'M15 0 L52 0 C84 0 84 54 52 54 L15 54', 'M46 54 L84 100'] },
  S: { w: 90, s: ['M78 16 C68 -4 18 -6 17 24 C16 48 80 46 80 74 C80 106 24 106 12 84'] },
  T: { w: 100, s: ['M50 0 L50 100', 'M10 0 L90 0'] },
  U: { w: 100, s: ['M15 0 L15 66 C15 108 85 108 85 66 L85 0'] },
  V: { w: 100, s: ['M10 0 L50 100 L90 0'] },
  W: { w: 116, s: ['M8 0 L32 100 L58 28 L84 100 L108 0'] },
  X: { w: 100, s: ['M15 0 L85 100', 'M85 0 L15 100'] },
  Y: { w: 100, s: ['M14 0 L50 50', 'M86 0 L50 50 L50 100'] },
  Z: { w: 100, s: ['M15 0 L85 0 L15 100 L85 100'] },

  a: { w: 82, s: ['M70 60 C62 46 20 44 18 75 C18 106 62 104 70 86', 'M70 50 L70 100'] },
  b: { w: 82, s: ['M15 0 L15 100', 'M15 72 C22 46 72 44 72 75 C72 106 24 106 15 90'] },
  c: { w: 76, s: ['M68 60 C60 46 18 44 16 75 C16 106 60 104 68 90'] },
  d: { w: 82, s: ['M68 60 C60 46 16 44 16 75 C16 106 60 104 68 86', 'M68 0 L68 100'] },
  e: { w: 80, s: ['M16 75 L70 75 C70 44 16 42 16 75 C16 106 60 106 70 92'] },
  f: { w: 66, s: ['M62 6 C54 -4 34 -2 34 20 L34 100', 'M14 50 L58 50'] },
  g: { w: 82, s: ['M68 60 C60 46 16 44 16 72 C16 100 60 100 68 84', 'M68 50 L68 124 C68 150 26 150 16 134'] },
  h: { w: 82, s: ['M15 0 L15 100', 'M15 70 C20 44 70 42 70 70 L70 100'] },
  i: { w: 40, s: ['M20 50 L20 100', 'M20 26 L20 28'] },
  j: { w: 50, s: ['M34 50 L34 124 C34 150 8 148 2 134', 'M34 26 L34 28'] },
  k: { w: 74, s: ['M15 0 L15 100', 'M62 48 L15 78 L66 100'] },
  l: { w: 40, s: ['M20 0 L20 100'] },
  m: { w: 108, s: ['M15 50 L15 100', 'M15 68 C18 44 54 44 54 68 L54 100', 'M54 68 C57 44 93 44 93 68 L93 100'] },
  n: { w: 82, s: ['M15 50 L15 100', 'M15 68 C18 44 70 42 70 68 L70 100'] },
  o: { w: 84, s: ['M42 50 C24 50 14 62 14 75 C14 88 24 100 42 100 C60 100 70 88 70 75 C70 62 60 50 42 50'] },
  p: { w: 82, s: ['M15 50 L15 145', 'M15 70 C22 46 72 44 72 75 C72 106 24 106 15 90'] },
  q: { w: 82, s: ['M68 60 C60 46 16 44 16 75 C16 106 60 104 68 86', 'M68 50 L68 145'] },
  r: { w: 64, s: ['M15 50 L15 100', 'M15 72 C22 50 42 44 60 52'] },
  s: { w: 72, s: ['M62 56 C52 44 18 44 18 62 C18 78 64 72 64 88 C64 104 26 106 12 92'] },
  t: { w: 64, s: ['M30 12 L30 90 C30 102 46 104 56 96', 'M10 50 L54 50'] },
  u: { w: 82, s: ['M15 50 L15 80 C15 106 68 106 68 80', 'M68 50 L68 100'] },
  v: { w: 80, s: ['M10 50 L40 100 L70 50'] },
  w: { w: 100, s: ['M8 50 L28 100 L50 62 L72 100 L92 50'] },
  x: { w: 78, s: ['M14 50 L66 100', 'M66 50 L14 100'] },
  y: { w: 80, s: ['M10 50 L40 100', 'M70 50 L30 145'] },
  z: { w: 78, s: ['M14 50 L66 50 L14 100 L66 100'] },
  ' ': { w: 34, s: [] }, // word gap
};

const LETTER_GAP = 10;
let measurer;

/** Sample an SVG path into points every `step` units. */
function sample(d, step = 2) {
  if (!measurer) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    measurer = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.append(measurer);
    document.body.append(svg);
  }
  measurer.setAttribute('d', d);
  const len = measurer.getTotalLength();
  const n = Math.max(2, Math.ceil(len / step));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = measurer.getPointAtLength((len * i) / n);
    pts.push([p.x, p.y]);
  }
  return pts;
}

const cache = new Map();

/** True when every character of `text` has stroke data. */
export const hasStrokes = (text) => [...text].every((ch) => LATIN[ch]);

/** Polylines (in units) for a letter or word, letters placed side by side. */
export function strokeModel(text) {
  if (cache.has(text)) return cache.get(text);
  let x = 0;
  const polys = [];
  [...text].forEach((ch, i) => {
    const L = LATIN[ch];
    if (i && ch !== ' ' && text[i - 1] !== ' ') x += LETTER_GAP;
    for (const d of L.s) polys.push(sample(d).map(([px, py]) => [px + x, py]));
    x += L.w;
  });
  const model = { polys, width: x };
  cache.set(text, model);
  return model;
}

// ---------- Khmer: stroke order recorded by a native writer ----------
// data/khmer-strokes.json ships recordings; ones made on this device (localStorage) override them.
// Format: { "ក": [[[x, y], ...], ...] } with x, y in 0..1 pad units, strokes in writing order.

export const RECORDED = {};
const LOCAL_KEY = 'learnering:kmstrokes';

export async function loadRecorded() {
  try {
    Object.assign(RECORDED, await (await fetch('data/khmer-strokes.json')).json());
  } catch {
    /* no shipped recordings yet */
  }
  try {
    Object.assign(RECORDED, JSON.parse(localStorage.getItem(LOCAL_KEY)) || {});
  } catch {
    /* storage unavailable */
  }
}

export function saveRecording(glyph, strokes) {
  if (strokes?.length) RECORDED[glyph] = strokes;
  else delete RECORDED[glyph];
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_KEY)) || {};
    if (strokes?.length) local[glyph] = strokes;
    else delete local[glyph];
    localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
  } catch {
    /* storage unavailable */
  }
}
