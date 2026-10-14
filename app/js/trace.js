// Handwriting pad: trace over a model, copy it, or write it from memory — and score the result.

import { h } from './dom.js';

const GRID = 96; // scoring resolution

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * Where and how big the glyph is drawn in a square of `size` px.
 * fit: true  → scaled so its real ink box fills ~70% of the square (good for single Khmer letters).
 * fit: false → fixed font size on a fixed baseline, like writing on ruled paper (letters keep their
 *              natural proportions: "a" is half as tall as "A", "g" goes below the line).
 */
function layout(ctx, size, glyph, font, fit) {
  const weight = /Andika/.test(font) ? 700 : /Battambang/.test(font) ? 400 : 600;
  ctx.font = `${weight} 100px ${font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(glyph);
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const ht = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (fit) {
    const scale = (size * 0.7) / Math.max(w, ht, 1);
    return { weight, scale, x: size / 2 + scale * (-w / 2 + m.actualBoundingBoxLeft), y: size / 2 + scale * (ht / 2 - m.actualBoundingBoxDescent) };
  }
  const cap = ctx.measureText('H').actualBoundingBoxAscent;
  const xh = ctx.measureText('x').actualBoundingBoxAscent;
  const scale = Math.min((size * 0.5) / cap, (size * 0.88) / Math.max(w, 1));
  const baseline = size * 0.68;
  return {
    weight,
    scale,
    x: size / 2 + scale * (-w / 2 + m.actualBoundingBoxLeft),
    y: baseline,
    lines: { top: baseline - cap * scale, mid: baseline - xh * scale, base: baseline },
  };
}

/** Draw the glyph; strokePx > 0 also outlines it, widening the shape (a tolerance band). */
function drawGlyph(ctx, size, glyph, font, fit, strokePx = 0) {
  const L = layout(ctx, size, glyph, font, fit);
  ctx.save();
  ctx.translate(L.x, L.y);
  ctx.scale(L.scale, L.scale);
  ctx.font = `${L.weight} 100px ${font}`;
  if (strokePx) {
    ctx.lineWidth = (strokePx * 2) / L.scale;
    ctx.lineJoin = 'round';
    ctx.strokeText(glyph, 0, 0);
  }
  ctx.fillText(glyph, 0, 0);
  ctx.restore();
  return L;
}

function bbox(data, threshold) {
  let x0 = GRID, y0 = GRID, x1 = -1, y1 = -1;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (data[(y * GRID + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Create a writing pad.
 * guide: show the grey model inside the pad (trace mode). reveal() shows it afterwards.
 * ink:   stroke width as a fraction of the pad (thinner for detailed scripts like Khmer).
 * lines: draw handwriting lines (top / dashed middle / baseline) — only with fit: false.
 */
export function tracePad(glyph, { font = 'system-ui, sans-serif', ink = 0.07, fit = true, guide = true, lines = false } = {}) {
  const size = Math.min(320, window.innerWidth - 48);
  const dpr = window.devicePixelRatio || 1;
  const canvas = h('canvas.trace', { width: size * dpr, height: size * dpr, style: `width:${size}px;height:${size}px` });
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const strokes = [];
  let drawing = null;
  let showGuide = guide;

  function redraw() {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = cssVar('--guide', '#ddd');
    const L = layout(ctx, size, glyph, font, fit);
    if (lines && L.lines) {
      ctx.strokeStyle = cssVar('--line', '#e5e5e5');
      ctx.lineWidth = 2;
      for (const [y, dashed] of [[L.lines.top, false], [L.lines.mid, true], [L.lines.base, false]]) {
        ctx.setLineDash(dashed ? [8, 8] : []);
        ctx.beginPath();
        ctx.moveTo(size * 0.05, y);
        ctx.lineTo(size * 0.95, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (showGuide) {
      ctx.fillStyle = cssVar('--guide', '#ddd');
      drawGlyph(ctx, size, glyph, font, fit);
    }
    ctx.strokeStyle = cssVar('--ink', '#2563eb');
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
  // Canvas text doesn't wait for web fonts: redraw once this one has loaded.
  document.fonts?.load(`${/Andika/.test(font) ? 700 : 400} 100px ${font}`).then(redraw, () => {});
  redraw();

  /**
   * Returns 0..1: how much of the letter is covered, penalising ink outside it.
   * normalize: first move/scale the writing onto the model's box, so a letter written anywhere
   * and at any size still counts (copy and memory modes).
   */
  function score({ normalize = !guide, debug = false } = {}) {
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = c.height = GRID;
      return c.getContext('2d', { willReadFrequently: true });
    };
    const glyphCtx = mk();
    drawGlyph(glyphCtx, GRID, glyph, font, fit);
    // Model letter widened by a small tolerance: thin ink inside this counts as "on the letter".
    const zoneCtx = mk();
    zoneCtx.strokeStyle = '#000';
    drawGlyph(zoneCtx, GRID, glyph, font, fit, GRID * 0.035);
    const g = glyphCtx.getImageData(0, 0, GRID, GRID).data;

    let map = (x, y) => [x * GRID, y * GRID];
    if (normalize) {
      const gb = bbox(g, 100);
      const pts = strokes.flat();
      if (!gb || !pts.length) return 0;
      const xs = pts.map((p) => p[0] * GRID);
      const ys = pts.map((p) => p[1] * GRID);
      const ib = { x0: Math.min(...xs), y0: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      // A finger line runs down the middle of the printed stroke, half a stroke inside its outer edge.
      const inset = GRID * 0.03;
      const tw = Math.max(gb.w - 2 * inset, 1);
      const th = Math.max(gb.h - 2 * inset, 1);
      let sx = ib.w > 2 ? tw / ib.w : 1;
      let sy = ib.h > 2 ? th / ib.h : 1;
      if (ib.w <= 2) sx = sy;
      if (ib.h <= 2) sy = sx;
      // Keep proportions honest: a squashed shape shouldn't be stretched back into the letter.
      const ratio = sx / sy;
      if (ratio > 1.3) sx = sy * 1.3;
      if (ratio < 1 / 1.3) sy = sx * 1.3;
      const ox = gb.x0 + inset + (tw - ib.w * sx) / 2;
      const oy = gb.y0 + inset + (th - ib.h * sy) / 2;
      map = (x, y) => [ox + (x * GRID - ib.x0) * sx, oy + (y * GRID - ib.y0) * sy];
    }

    const strokeAll = (c, width) => {
      c.lineWidth = width;
      c.lineCap = c.lineJoin = 'round';
      for (const s of strokes) {
        c.beginPath();
        s.forEach(([x, y], i) => (i ? c.lineTo(...map(x, y)) : c.moveTo(...map(x, y))));
        if (s.length === 1) {
          const [px, py] = map(...s[0]);
          c.lineTo(px + 0.1, py);
        }
        c.stroke();
      }
    };
    const thinCtx = mk(); // the learner's line itself
    strokeAll(thinCtx, 2);
    const reachCtx = mk(); // what the learner's line "reaches": the line plus a tolerance on each side
    strokeAll(reachCtx, GRID * 0.085);

    const z = zoneCtx.getImageData(0, 0, GRID, GRID).data;
    const thin = thinCtx.getImageData(0, 0, GRID, GRID).data;
    const reach = reachCtx.getImageData(0, 0, GRID, GRID).data;
    let glyphPx = 0, covered = 0, inkPx = 0, onLetter = 0;
    for (let i = 3; i < g.length; i += 4) {
      if (g[i] > 100) {
        glyphPx++;
        if (reach[i] > 60) covered++;
      }
      if (thin[i] > 60) {
        inkPx++;
        if (z[i] > 60) onLetter++;
      }
    }
    if (!glyphPx || !inkPx) return 0;
    const clamp = (v) => Math.min(Math.max(v, 0), 1);
    const coverage = clamp((covered / glyphPx - 0.65) / 0.27); // ~92%+ of the letter reached → full marks
    const precision = clamp((onLetter / inkPx - 0.6) / 0.3); // 90%+ of the ink on the letter → full marks
    if (debug) return { coverage, precision, inkRatio: inkPx / glyphPx };
    return coverage * precision;
  }

  return {
    el: canvas,
    clear() {
      strokes.length = 0;
      redraw();
    },
    /** Show the model after a copy/memory attempt so the learner can compare. */
    reveal() {
      showGuide = true;
      redraw();
    },
    score,
    get empty() {
      return strokes.length === 0;
    },
  };
}

/** Draw the model glyph alone (for copy mode's "look at this" card). */
export function modelCanvas(glyph, { font = 'system-ui, sans-serif', fit = true, lines = false, px = 120 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const c = h('canvas.model', { width: px * dpr, height: px * dpr, style: `width:${px}px;height:${px}px` });
  const draw = () => {
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, px, px);
    const L = layout(ctx, px, glyph, font, fit);
    if (lines && L.lines) {
      ctx.strokeStyle = cssVar('--line', '#e5e5e5');
      ctx.lineWidth = 1;
      for (const y of [L.lines.top, L.lines.mid, L.lines.base]) {
        ctx.beginPath();
        ctx.moveTo(4, y);
        ctx.lineTo(px - 4, y);
        ctx.stroke();
      }
    }
    ctx.fillStyle = cssVar('--text', '#222');
    drawGlyph(ctx, px, glyph, font, fit);
  };
  document.fonts?.load(`${/Andika/.test(font) ? 700 : 400} 100px ${font}`).then(draw, () => {});
  draw();
  return c;
}
