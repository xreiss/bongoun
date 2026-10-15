// Handwriting pad: watch the stroke order, trace stroke by stroke, copy, or write from memory.

import { h } from './dom.js';
import { strokeModel, hasStrokes, RECORDED } from './strokes.js';

const GRID = 96; // scoring resolution
const PEN = 11; // model pen width, in stroke units (cap height = 100)

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

// ---------- shapes: what the model looks like and how it was written ----------

/**
 * A shape draws the model in a square of `size` px and, when stroke data exists,
 * returns its strokes in writing order (polylines in px) so we can animate and guide them.
 */
function strokeShape(text) {
  const model = strokeModel(text);
  const place = (size) => {
    const scale = Math.min((size * 0.42) / 100, (size * 0.88) / model.width);
    const base = size * 0.68;
    return { scale, base, x0: (size - model.width * scale) / 2 };
  };
  return {
    polys(size) {
      const P = place(size);
      return model.polys.map((poly) => poly.map(([x, y]) => [P.x0 + x * P.scale, P.base + (y - 100) * P.scale]));
    },
    draw(ctx, size, widen = 0) {
      const P = place(size);
      ctx.lineWidth = PEN * P.scale + widen * 2;
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const poly of this.polys(size)) polyline(ctx, poly);
    },
    lines(size) {
      const P = place(size);
      return { top: P.base - 100 * P.scale, mid: P.base - 50 * P.scale, base: P.base };
    },
  };
}

/** Font-drawn shape (Khmer). `recorded` = strokes a native writer recorded, in 0..1 pad units. */
function fontShape(glyph, font, recorded) {
  const weight = /Battambang/.test(font) ? 400 : 600;
  const layout = (ctx, size) => {
    ctx.font = `${weight} 100px ${font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(glyph);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const ht = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const scale = (size * 0.7) / Math.max(w, ht, 1);
    return { scale, x: size / 2 + scale * (-w / 2 + m.actualBoundingBoxLeft), y: size / 2 + scale * (ht / 2 - m.actualBoundingBoxDescent) };
  };
  return {
    polys: recorded?.length ? (size) => recorded.map((poly) => poly.map(([x, y]) => [x * size, y * size])) : null,
    draw(ctx, size, widen = 0) {
      const L = layout(ctx, size);
      ctx.save();
      ctx.translate(L.x, L.y);
      ctx.scale(L.scale, L.scale);
      ctx.font = `${weight} 100px ${font}`;
      if (widen) {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = (widen * 2) / L.scale;
        ctx.lineJoin = 'round';
        ctx.strokeText(glyph, 0, 0);
      }
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
    },
    lines: null,
  };
}

/** Latin text with stroke data → stroke-built model; anything else → font model. */
export function makeShape(glyph, { font = '', recorded = RECORDED[glyph] } = {}) {
  return hasStrokes(glyph) && !/Battambang/.test(font) ? strokeShape(glyph) : fontShape(glyph, font, recorded);
}

// ---------- drawing helpers ----------

function polyline(ctx, pts, upto = pts.length) {
  ctx.beginPath();
  for (let i = 0; i < upto; i++) (i ? ctx.lineTo(...pts[i]) : ctx.moveTo(...pts[i]));
  if (upto === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
  ctx.stroke();
}

function drawLines(ctx, size, shape) {
  const L = shape.lines?.(size);
  if (!L) return;
  ctx.strokeStyle = cssVar('--line', '#e5e5e5');
  ctx.lineWidth = 2;
  for (const [y, dashed] of [[L.top, false], [L.mid, true], [L.base, false]]) {
    ctx.setLineDash(dashed ? [8, 8] : []);
    ctx.beginPath();
    ctx.moveTo(size * 0.05, y);
    ctx.lineTo(size * 0.95, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** Numbered start dot with a small arrow showing which way the stroke goes. */
function startMarker(ctx, poly, n, size) {
  const [x, y] = poly[0];
  const r = Math.max(size * 0.035, 7);
  const color = cssVar('--ok', '#16a34a');
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = color;
  if (poly.length > 3) {
    const ahead = poly[Math.min(poly.length - 1, Math.max(3, Math.round(poly.length * 0.15)))];
    const ang = Math.atan2(ahead[1] - y, ahead[0] - x);
    const ax = x + Math.cos(ang) * r * 2.7;
    const ay = y + Math.sin(ang) * r * 2.7;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(ang) * 8, ay + Math.sin(ang) * 8);
    ctx.lineTo(ax + Math.cos(ang + 2.4) * 8, ay + Math.sin(ang + 2.4) * 8);
    ctx.lineTo(ax + Math.cos(ang - 2.4) * 8, ay + Math.sin(ang - 2.4) * 8);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${r * 1.2}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 1);
  ctx.restore();
}

const polyLength = (p) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

/**
 * Animate strokes being written one after another, with a moving pen tip.
 * Returns a promise with .cancel(). A timer guarantees it ends even if animation frames are paused
 * (background tab), so the pad can never stay locked.
 */
function animateStrokes(ctx, size, polys, { background, penWidth }) {
  const speed = size * 0.8; // px per second: slow enough to follow
  const pause = 300;
  const durations = polys.map((p) => Math.max(350, (polyLength(p) / speed) * 1000));
  const total = durations.reduce((a, b) => a + b + pause, 0);
  let finish;
  const promise = new Promise((resolve) => {
    let stopped = false;
    const t0 = performance.now();
    finish = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(safety);
      resolve();
    };
    const safety = setTimeout(finish, total + 500);
    const frame = (now) => {
      if (stopped) return;
      let t = now - t0;
      background();
      ctx.lineCap = ctx.lineJoin = 'round';
      for (let k = 0; k < polys.length && t > 0; k++) {
        const p = polys[k];
        const frac = Math.min(t / durations[k], 1);
        const upto = Math.max(1, Math.round(frac * p.length));
        ctx.strokeStyle = cssVar('--ink', '#2563eb');
        ctx.lineWidth = penWidth;
        polyline(ctx, p, upto);
        if (frac < 1) {
          startMarker(ctx, p, k + 1, size);
          const [hx, hy] = p[upto - 1];
          ctx.fillStyle = cssVar('--accent-2', '#f472b6');
          ctx.beginPath();
          ctx.arc(hx, hy, penWidth * 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
        t -= durations[k] + pause;
      }
      if (now - t0 < total) requestAnimationFrame(frame);
      else finish();
    };
    requestAnimationFrame(frame);
  });
  promise.cancel = () => finish();
  return promise;
}

// ---------- stroke checking ----------

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function distToPoly(p, poly) {
  if (poly.length === 1) return dist(p, poly[0]);
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const [ax, ay] = poly[i - 1];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best;
}

/** Compare one drawn stroke (px) with the expected one → 'ok' | 'direction' | 'start' | 'shape'. */
export function judgeStroke(drawn, expected, size) {
  const tol = size * 0.075;
  if (polyLength(expected) < tol) return dist(drawn[0], expected[0]) < tol * 1.6 ? 'ok' : 'start'; // a dot
  const a = drawn[0];
  const b = drawn[drawn.length - 1];
  const s = expected[0];
  const e = expected[expected.length - 1];
  const closed = dist(s, e) < tol; // loops like "o" start and end at the same place
  // Reversed: begins where it should end and ends where it should begin (clearly, for "c"-like shapes
  // whose ends are close together).
  if (!closed && dist(a, e) < tol * 1.5 && dist(b, s) < tol * 1.5 && dist(a, e) < dist(a, s) && dist(b, s) < dist(b, e)) return 'direction';
  if (dist(a, s) > tol * 1.6) return 'start';
  const mean = drawn.reduce((sum, p) => sum + distToPoly(p, expected), 0) / drawn.length;
  const reached = expected.filter((q) => drawn.some((p) => dist(p, q) < tol * 1.3)).length / expected.length;
  if (mean > tol * 0.8 || reached < 0.75) return 'shape';
  if (closed) {
    // For loops the direction shows early in the stroke: which side of the start does it head to?
    const k = Math.min(drawn.length - 1, Math.max(2, Math.round(drawn.length * 0.2)));
    const j = Math.max(1, Math.round(expected.length * 0.2));
    if (dist(drawn[k], expected[expected.length - 1 - j]) + tol * 0.3 < dist(drawn[k], expected[j])) return 'direction';
  }
  return 'ok';
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

// ---------- the pad ----------

/**
 * Create a writing pad.
 * guide:    show the grey model inside the pad. reveal() shows it afterwards.
 * guided:   stroke-by-stroke tracing with numbered start dots and direction checks (needs stroke data).
 * ink:      learner's stroke width as a fraction of the pad.
 * recorded: Khmer strokes recorded by a native writer (0..1 pad units), enables guided mode for them.
 * onStroke(verdict, done, total) after each guided stroke; onDone(mistakes) when all strokes are written.
 */
export function tracePad(glyph, { font = 'system-ui, sans-serif', ink = 0.07, guide = true, guided = false, lines = false, recorded, onStroke, onDone } = {}) {
  const size = Math.max(220, Math.min(320, window.innerWidth - 48, window.innerHeight - 400));
  const dpr = window.devicePixelRatio || 1;
  const canvas = h('canvas.trace', { width: size * dpr, height: size * dpr, style: `width:${size}px;height:${size}px` });
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const shape = makeShape(glyph, { font, recorded });
  const polys = shape.polys ? shape.polys(size) : null;
  const isGuided = guided && Boolean(polys);
  const penWidth = Math.max(size * 0.045, 8);
  const strokes = [];
  let drawing = null;
  let showGuide = guide;
  let busy = false;
  let current = 0; // guided: index of the next stroke to write
  let mistakes = 0;
  let anim = null; // running demo; touching the pad skips it

  async function play(polysToShow, bg = background) {
    busy = true;
    anim = animateStrokes(ctx, size, polysToShow, { background: bg, penWidth });
    await anim;
    anim = null;
    busy = false;
    redraw();
  }

  function background() {
    ctx.clearRect(0, 0, size, size);
    if (lines) drawLines(ctx, size, shape);
    if (showGuide) {
      ctx.fillStyle = ctx.strokeStyle = cssVar('--guide', '#ddd');
      shape.draw(ctx, size);
    }
  }

  function redraw() {
    background();
    ctx.lineCap = ctx.lineJoin = 'round';
    if (isGuided) {
      ctx.strokeStyle = cssVar('--ink', '#2563eb');
      ctx.lineWidth = penWidth;
      for (let k = 0; k < current; k++) polyline(ctx, polys[k]);
      if (current < polys.length && !drawing) startMarker(ctx, polys[current], current + 1, size);
    }
    ctx.strokeStyle = cssVar('--ink', '#2563eb');
    ctx.lineWidth = isGuided ? penWidth : size * ink;
    for (const s of strokes) polyline(ctx, s.map(([x, y]) => [x * size, y * size]));
  }

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (anim) anim.cancel(); // skip the demo and let them write
    if (isGuided && current === polys.length) return;
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
  const end = async () => {
    if (!drawing) return;
    const done = drawing;
    drawing = null;
    if (!isGuided) return redraw();
    const verdict = judgeStroke(done.map(([x, y]) => [x * size, y * size]), polys[current], size);
    strokes.length = 0;
    if (verdict === 'ok') {
      current++;
      redraw();
      onStroke?.('ok', current, polys.length);
      if (current === polys.length) onDone?.(mistakes);
      return;
    }
    mistakes++;
    redraw();
    canvas.classList.remove('shake');
    void canvas.offsetWidth; // restart the CSS animation
    canvas.classList.add('shake');
    onStroke?.(verdict, current, polys.length);
    // Show how this stroke is written, then let them try again.
    const was = showGuide;
    showGuide = true;
    await play([polys[current]], () => {
      background();
      ctx.strokeStyle = cssVar('--ink', '#2563eb');
      ctx.lineWidth = penWidth;
      ctx.lineCap = ctx.lineJoin = 'round';
      for (let k = 0; k < current; k++) polyline(ctx, polys[k]); // keep the strokes already written
    });
    showGuide = was;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // Canvas text doesn't wait for web fonts: redraw once this one has loaded.
  document.fonts?.load(`400 100px ${font}`).then(() => !busy && redraw(), () => {});
  redraw();

  /**
   * 0..1. Guided: finished, minus a little per mistake. Free writing: how much of the model is covered,
   * penalising ink outside it; normalize moves/scales the writing onto the model first (copy/memory).
   */
  function score({ normalize = !guide, debug = false } = {}) {
    if (isGuided) return current === polys.length ? Math.max(0, 1 - mistakes * 0.15) : 0;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = c.height = GRID;
      return c.getContext('2d', { willReadFrequently: true });
    };
    const glyphCtx = mk();
    glyphCtx.fillStyle = glyphCtx.strokeStyle = '#000';
    shape.draw(glyphCtx, GRID);
    const zoneCtx = mk();
    zoneCtx.fillStyle = zoneCtx.strokeStyle = '#000';
    shape.draw(zoneCtx, GRID, GRID * 0.035);
    const g = glyphCtx.getImageData(0, 0, GRID, GRID).data;

    let map = (x, y) => [x * GRID, y * GRID];
    if (normalize) {
      const gb = bbox(g, 100);
      const pts = strokes.flat();
      if (!gb || !pts.length) return 0;
      const xs = pts.map((p) => p[0] * GRID);
      const ys = pts.map((p) => p[1] * GRID);
      const ib = { x0: Math.min(...xs), y0: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      // A finger line runs down the middle of the printed stroke, half a stroke inside its edge.
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
      c.strokeStyle = '#000';
      c.lineWidth = width;
      c.lineCap = c.lineJoin = 'round';
      for (const s of strokes) polyline(c, s.map(([x, y]) => map(x, y)));
    };
    const thinCtx = mk(); // the learner's line itself
    strokeAll(thinCtx, 2);
    const reachCtx = mk(); // what the line "reaches", with a tolerance on each side
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
    const coverage = clamp((covered / glyphPx - 0.65) / 0.27); // ~92%+ of the model reached → full marks
    const precision = clamp((onLetter / inkPx - 0.6) / 0.3); // ~90%+ of the ink on the model → full marks
    if (debug) return { coverage, precision };
    return coverage * precision;
  }

  const api = {
    el: canvas,
    guided: isGuided,
    /** Expected strokes in px (null without stroke data). */
    expected: polys,
    hasStrokes: Boolean(polys),
    clear() {
      strokes.length = 0;
      current = 0;
      mistakes = 0;
      redraw();
    },
    /** Show the model after a copy/memory attempt so the learner can compare. */
    reveal() {
      showGuide = true;
      redraw();
    },
    /** Play the full stroke-order animation over the model, then return to the current state. */
    async demo() {
      if (!polys || busy) return;
      const was = showGuide;
      showGuide = true;
      await play(polys);
      showGuide = was;
      redraw();
    },
    score,
    get mistakes() {
      return mistakes;
    },
    get complete() {
      return isGuided && current === polys.length;
    },
    get empty() {
      return isGuided ? current === 0 : strokes.length === 0;
    },
    /** Raw strokes in 0..1 pad units (used by the stroke recorder). */
    get strokes() {
      return strokes.map((s) => s.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]));
    },
  };
  canvas.pad = api; // handy for debugging from the console
  return api;
}

/** The model on its own (copy mode's "look at this" card), with a stroke-order demo. */
export function modelCanvas(glyph, { font = 'system-ui, sans-serif', lines = false, recorded, px = 120 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const c = h('canvas.model', { width: px * dpr, height: px * dpr, style: `width:${px}px;height:${px}px` });
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const shape = makeShape(glyph, { font, recorded });
  const paint = (color) => () => {
    ctx.clearRect(0, 0, px, px);
    if (lines) drawLines(ctx, px, shape);
    ctx.fillStyle = ctx.strokeStyle = color;
    shape.draw(ctx, px);
  };
  const draw = paint(cssVar('--text', '#222'));
  document.fonts?.load(`400 100px ${font}`).then(draw, () => {});
  draw();
  c.demo = async () => {
    if (!shape.polys) return;
    await animateStrokes(ctx, px, shape.polys(px), { background: paint(cssVar('--guide', '#ddd')), penWidth: Math.max(px * 0.05, 4) });
    draw();
  };
  return c;
}
