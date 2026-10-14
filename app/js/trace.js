// Finger-tracing pad: draws a faint letter, lets the learner trace it, and scores the result.

import { h } from './dom.js';

const GRID = 96; // scoring resolution

/** Draw `glyph` scaled and centred so its real ink box fills ~70% of the square.
 *  strokePx > 0 also outlines it, widening the shape by that many pixels (a tolerance band). */
function drawGlyph(ctx, size, glyph, font, strokePx = 0, weight = /Battambang/.test(font) ? 400 : 600) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${weight} 100px ${font}`;
  const m = ctx.measureText(glyph);
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const ht = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const scale = (size * 0.7) / Math.max(w, ht, 1);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(scale, scale);
  const x = -w / 2 + m.actualBoundingBoxLeft;
  const y = ht / 2 - m.actualBoundingBoxDescent;
  if (strokePx) {
    ctx.lineWidth = (strokePx * 2) / scale;
    ctx.lineJoin = 'round';
    ctx.strokeText(glyph, x, y);
  }
  ctx.fillText(glyph, x, y);
  ctx.restore();
}

/** ink: stroke width as a fraction of the pad (thinner for detailed scripts like Khmer). */
export function tracePad(glyph, { font = 'system-ui, sans-serif', ink = 0.07 } = {}) {
  const size = Math.min(320, window.innerWidth - 48);
  const dpr = window.devicePixelRatio || 1;
  const canvas = h('canvas.trace', { width: size * dpr, height: size * dpr, style: `width:${size}px;height:${size}px` });
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const strokes = [];
  let drawing = null;

  function redraw() {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--guide').trim() || '#ddd';
    drawGlyph(ctx, size, glyph, font);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#2563eb';
    ctx.lineWidth = size * ink;
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x * size, y * size) : ctx.moveTo(x * size, y * size)));
      if (s.length === 1) ctx.lineTo(s[0][0] * size + 0.1, s[0][1] * size);
      ctx.stroke();
    }
  }

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    drawing = [pos(e)];
    strokes.push(drawing);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    drawing.push(pos(e));
    redraw();
  });
  const end = () => {
    drawing = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  redraw();

  /** Returns 0..1: how much of the letter is covered, penalising ink outside it. */
  function score() {
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = c.height = GRID;
      return c.getContext('2d', { willReadFrequently: true });
    };
    const glyphCtx = mk();
    drawGlyph(glyphCtx, GRID, glyph, font);
    const zoneCtx = mk();
    zoneCtx.strokeStyle = '#000';
    drawGlyph(zoneCtx, GRID, glyph, font, GRID * 0.04);
    const inkCtx = mk();
    inkCtx.lineWidth = GRID * ink;
    inkCtx.lineCap = inkCtx.lineJoin = 'round';
    for (const s of strokes) {
      inkCtx.beginPath();
      s.forEach(([x, y], i) => (i ? inkCtx.lineTo(x * GRID, y * GRID) : inkCtx.moveTo(x * GRID, y * GRID)));
      if (s.length === 1) inkCtx.lineTo(s[0][0] * GRID + 0.1, s[0][1] * GRID);
      inkCtx.stroke();
    }
    const g = glyphCtx.getImageData(0, 0, GRID, GRID).data;
    const z = zoneCtx.getImageData(0, 0, GRID, GRID).data;
    const inked = inkCtx.getImageData(0, 0, GRID, GRID).data;
    let glyphPx = 0, covered = 0, inkPx = 0, inside = 0;
    for (let i = 3; i < g.length; i += 4) {
      if (g[i] > 100) {
        glyphPx++;
        if (inked[i] > 100) covered++;
      }
      if (inked[i] > 100) {
        inkPx++;
        if (z[i] > 60) inside++;
      }
    }
    if (!glyphPx || !inkPx) return 0;
    const coverage = Math.min(covered / glyphPx / 0.7, 1);
    const precision = Math.min(Math.max((inside / inkPx - 0.55) / 0.35, 0), 1);
    return coverage * precision;
  }

  return {
    el: canvas,
    clear() {
      strokes.length = 0;
      redraw();
    },
    score,
    get empty() {
      return strokes.length === 0;
    },
  };
}
