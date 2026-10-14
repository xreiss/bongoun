// Finger-tracing pad: draws a faint letter, lets the learner trace it, and scores the result.

import { h } from './dom.js';

const GRID = 96; // scoring resolution

function drawGlyph(ctx, size, glyph, font) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${size * 0.72}px ${font}`;
  ctx.fillText(glyph, size / 2, size * 0.54);
}

export function tracePad(glyph, { font = 'system-ui, sans-serif' } = {}) {
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
    ctx.lineWidth = size * 0.07;
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
    canvas.setPointerCapture(e.pointerId);
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

  /** Returns 0..1: how well the ink covers the letter without straying. */
  function score() {
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = c.height = GRID;
      return c.getContext('2d', { willReadFrequently: true });
    };
    const glyphCtx = mk();
    drawGlyph(glyphCtx, GRID, glyph, font);
    const zoneCtx = mk();
    zoneCtx.lineWidth = GRID * 0.09;
    zoneCtx.strokeStyle = '#000';
    zoneCtx.font = `600 ${GRID * 0.72}px ${font}`;
    zoneCtx.textAlign = 'center';
    zoneCtx.textBaseline = 'middle';
    zoneCtx.fillText(glyph, GRID / 2, GRID * 0.54);
    zoneCtx.strokeText(glyph, GRID / 2, GRID * 0.54);
    const inkCtx = mk();
    inkCtx.lineWidth = GRID * 0.1;
    inkCtx.lineCap = inkCtx.lineJoin = 'round';
    for (const s of strokes) {
      inkCtx.beginPath();
      s.forEach(([x, y], i) => (i ? inkCtx.lineTo(x * GRID, y * GRID) : inkCtx.moveTo(x * GRID, y * GRID)));
      inkCtx.stroke();
    }
    const g = glyphCtx.getImageData(0, 0, GRID, GRID).data;
    const z = zoneCtx.getImageData(0, 0, GRID, GRID).data;
    const ink = inkCtx.getImageData(0, 0, GRID, GRID).data;
    let glyphPx = 0, covered = 0, inkPx = 0, inside = 0;
    for (let i = 3; i < g.length; i += 4) {
      if (g[i] > 100) {
        glyphPx++;
        if (ink[i] > 100) covered++;
      }
      if (ink[i] > 100) {
        inkPx++;
        if (z[i] > 60) inside++;
      }
    }
    if (!glyphPx || !inkPx) return 0;
    return Math.min(covered / glyphPx / 0.75, 1) * Math.min(inside / inkPx / 0.8, 1);
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
