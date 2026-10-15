// Builds a practice session (spaced repetition with learning steps) and renders each exercise.

import { h, shuffle, pick } from './dom.js';
import { play, playSeq, stop, tone, hasAudio } from './audio.js';
import * as store from './store.js';
import { tracePad, modelCanvas } from './trace.js';
import { hasStrokes, RECORDED } from './strokes.js';
import { hasGemini, checkSpeech } from './gemini.js';
import { record } from './voice.js';
import { icon } from './icons.js';

const LATIN_PAD = { font: 'Andika, "Avenir Next", sans-serif', ink: 0.06, lines: true };
const KHMER_PAD = { font: 'Battambang, "Khmer Sangam MN", serif', ink: 0.045 };
const STROKE_TIPS = { start: 'strokeStart', direction: 'strokeDirection', shape: 'strokeShape' };

// Exercise ladders: the higher the memory level, the harder the exercise. Writing is part of every ladder.
const LADDERS = {
  en: {
    word: ['listen_pick', 'read_pick', 'write_copy', 'pick_word', 'say_it', 'spell', 'write_word'],
    phrase: ['listen_pick', 'read_pick', 'pick_word', 'say_it', 'sentence'],
    phonics: ['listen_pick', 'first_sound', 'write_copy', 'missing_vowel', 'rhyme', 'read_pick', 'say_it', 'spell', 'write_word'],
    letter: ['letter_listen', 'trace', 'letter_word', 'write_memory'],
  },
  km: {
    word: ['listen_pick', 'read_pick', 'write_copy', 'pick_word', 'write_word'],
    phrase: ['listen_pick', 'read_pick', 'pick_word'],
    consonant: ['consonant_listen', 'consonant_trace', 'consonant_sound', 'consonant_series', 'consonant_write'],
    vowel: ['vowel_sound', 'write_copy', 'vowel_sound'],
  },
};
const WRITING = new Set(['trace', 'write_copy', 'write_word', 'write_memory', 'consonant_trace', 'consonant_write']);

const SESSION_REVIEWS = 12;
const SESSION_NEW = 5;
const RECHECK_GAP = 4; // a new word comes back this many cards after it was first practised

/** What to write for an item (or null when it isn't sensible to write it). */
export function writable(course, item) {
  if (item.kind === 'letter') return { glyph: item.L, pad: LATIN_PAD };
  if (item.kind === 'consonant') return { glyph: item.ch, pad: KHMER_PAD };
  if (item.kind === 'vowel') return { glyph: 'ក' + item.v, pad: KHMER_PAD };
  if (item.kind !== 'word' || item.c.cat === 'phrases') return null;
  if (course.target === 'en') {
    const text = item.c.en === 'I' ? 'I' : item.c.en.toLowerCase();
    return /^[a-z ]{1,10}$/i.test(text) ? { glyph: text, pad: LATIN_PAD } : null;
  }
  const km = item.c.km;
  return [...km].length <= 7 && !/[\s/?]/.test(km) ? { glyph: km, pad: KHMER_PAD } : null;
}

function baseLadder(course, item) {
  const L = LADDERS[course.id];
  if (item.kind === 'word') {
    if (item.c.cat === 'phrases') return L.phrase;
    if (course.id === 'en' && item.phonics) return item.rhymes.length ? L.phonics : L.phonics.filter((t) => t !== 'rhyme');
    if (course.id === 'en' && !/^[a-z]{2,8}$/i.test(item.c.en)) return L.word.filter((t) => t !== 'spell');
    return L.word;
  }
  return L[item.kind];
}

function ladderFor(course, item) {
  const canWrite = Boolean(writable(course, item));
  return baseLadder(course, item).filter((t) => (t !== 'say_it' || hasGemini()) && (!WRITING.has(t) || canWrite));
}

function chooseType(course, item, box) {
  const ladder = ladderFor(course, item);
  const top = Math.min(Math.max(box, 1), ladder.length) - 1;
  // Mostly the hardest unlocked exercise, sometimes an easier one for variety.
  return Math.random() < 0.7 || top === 0 ? ladder[top] : ladder[Math.floor(Math.random() * top)];
}

/**
 * Build the session queue. unitIdx = null → daily practice across the course.
 * New words: intro → write it → first exercise → asked again a few cards later (learning steps).
 */
export function buildQueue(course, items, pid, unitIdx = null) {
  const scope = [...new Set(unitIdx == null ? course.units.flatMap((u) => u.items) : course.units[unitIdx].items)];
  const card = (id) => store.card(pid, id);
  const due = scope.filter((id) => store.isDue(pid, id)).sort((a, b) => card(a).due - card(b).due);
  const fresh = scope.filter((id) => card(id).box === 0).slice(0, unitIdx == null ? SESSION_NEW : SESSION_NEW + 1);
  const reviews = due.slice(0, SESSION_REVIEWS);

  // Nothing (or little) due: practise the weakest cards — practice never pushes intervals out.
  let extra = [];
  if (reviews.length + fresh.length < 6) {
    extra = scope
      .filter((id) => card(id).box > 0 && !reviews.includes(id))
      .sort((a, b) => card(a).box - card(b).box || card(b).lapses - card(a).lapses)
      .slice(0, 8 - reviews.length - fresh.length);
  }

  const rest = shuffle([
    ...reviews.map((id) => ({ id, type: chooseType(course, items[id], card(id).box) })),
    ...extra.map((id) => ({ id, type: chooseType(course, items[id], card(id).box), extra: true })),
  ]);
  const q = [];
  for (const id of fresh) {
    const ladder = ladderFor(course, items[id]);
    q.push({ id, type: 'intro' });
    if (writable(course, items[id])) q.push({ id, type: 'learn_write' });
    q.push({ id, type: ladder[0], learn: true });
    q.push(...rest.splice(0, 2));
  }
  q.push(...rest);
  // Learning step: each new word is asked again (a different exercise) RECHECK_GAP cards later.
  for (const id of fresh) {
    const first = q.findIndex((e) => e.id === id && e.learn);
    const ladder = ladderFor(course, items[id]);
    q.splice(Math.min(q.length, first + RECHECK_GAP + 1), 0, { id, type: ladder[1] || ladder[0], extra: true, recheck: true });
  }
  return q;
}

/** Run a session inside `root`. Calls onExit(answeredCount) when finished or closed. */
export function runSession(root, { course, items, ui, pid, unitIdx = null, onExit }) {
  const queue = buildQueue(course, items, pid, unitIdx);
  const isKmUI = course.ui === 'km';
  const lang = isKmUI ? 'km' : 'en';
  const t = (k) => (isKmUI ? ui.km[k] : ui.en[k]) || ui.en[k] || '';
  const spokenInstructions = new Set();
  const repeats = new Map(); // id → how many times it was re-queued after a mistake
  let total = queue.filter((e) => e.type !== 'intro').length;
  let done = 0;
  let answeredCount = 0;
  let correct = 0;

  const pool = (kind) => Object.values(items).filter((it) => it.kind === kind && course.units.some((u) => u.items.includes(it.id)));
  const unitOf = (id) => course.units.find((u) => u.items.includes(id));

  // ---------- speech ----------
  function targetSpeech(item, opts) {
    switch (item.kind) {
      case 'word':
        return course.target === 'en' ? ['en', item.c.en, opts] : ['km', item.c.km, opts];
      case 'letter':
        return ['en', `letter:${item.L}`, opts];
      case 'consonant':
        return ['km', item.ch, opts];
      case 'vowel':
        return ['km', 'ក' + item.v, opts];
    }
  }
  const sayTarget = (item, opts) => play(...targetSpeech(item, opts));
  const sayInstruction = async (type) => {
    if (!isKmUI || !ui.km[type] || spokenInstructions.has(type)) return;
    spokenInstructions.add(type);
    await play('km', ui.km[type], { slow: false });
  };

  function distractors(item, kind, n, key) {
    const seen = new Set([key(item)]);
    const sameUnit = shuffle((unitOf(item.id)?.items || []).map((id) => items[id]).filter((it) => it.kind === kind));
    const out = [];
    for (const it of [...sameUnit, ...shuffle(pool(kind))]) {
      if (out.length >= n) break;
      const k = key(it);
      if (it.id === item.id || seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
    return out;
  }

  // ---------- flow ----------
  function next() {
    stop();
    const ex = queue.shift();
    if (!ex) return finish();
    const item = items[ex.id];
    root.replaceChildren(
      h(
        'header.s-head',
        h('button.icon-btn.ghost', { onclick: () => finish(true), 'aria-label': 'Close' }, icon('close')),
        h('div.progress', h('div.bar', { style: `width:${(done / Math.max(total, 1)) * 100}%` })),
        h('span.s-count', `${Math.min(done + 1, total)}/${total}`),
      ),
    );
    const stage = h('main.stage');
    root.append(stage);
    if (ex.type === 'intro') return renderIntro(stage, item);
    if (ex.type === 'learn_write') return renderLearnWrite(stage, item);
    render(stage, ex, item);
  }

  /** Record an answer, schedule repeats of mistakes, show the feedback sheet. */
  function answered(ex, item, ok, stage, correctLabel, { hard = false } = {}) {
    done++;
    answeredCount++;
    if (ok) correct++;
    tone(ok);
    // Practice / re-checks only count when they reveal a mistake.
    if (!(ex.extra && ok)) store.grade(pid, item.id, ok, { hard });
    if (!ok) {
      // A missed card comes back twice: soon with an easier exercise, and once more at the end.
      const n = repeats.get(item.id) || 0;
      if (n < 2) {
        repeats.set(item.id, n + 1);
        const ladder = ladderFor(course, item);
        queue.splice(Math.min(3, queue.length), 0, { id: item.id, type: ladder[0], extra: true });
        if (n === 0) queue.push({ id: item.id, type: ladder[Math.min(1, ladder.length - 1)], extra: true });
        total += n === 0 ? 2 : 1;
      }
    }
    const sheet = h(
      `div.sheet.${ok ? 'ok' : 'bad'}`,
      h('div.sheet-head', h('span.sheet-icon', icon(ok ? 'check' : 'x', { size: 20 })), h('span.sheet-msg', { lang }, t(ok ? 'correct' : 'wrong'))),
      correctLabel && !ok ? h('div.sheet-answer', correctLabel) : null,
      h('button.btn.primary.wide', { onclick: next, lang }, t('next'), icon('next', { size: 18 })),
    );
    stage.querySelectorAll('button.opt, button.tile').forEach((b) => (b.disabled = true));
    stage.append(sheet);
    sheet.querySelector('button').focus({ preventScroll: true });
    setTimeout(() => (ex.after ? ex.after() : ex.speech ? play(...ex.speech) : sayTarget(item)), 350);
  }

  /** Practice steps that aren't graded (writing a new word right after meeting it). */
  function practised() {
    done++;
    next();
  }

  function finish(early = false) {
    stop();
    if (answeredCount) store.recordSession(pid, answeredCount);
    if (early) return onExit(answeredCount);
    const pct = answeredCount ? Math.round((correct / answeredCount) * 100) : 100;
    const stars = pct >= 90 ? 3 : pct >= 70 ? 2 : 1;
    root.replaceChildren(
      h(
        'main.stage.done',
        h('div.done-badge', icon('check', { size: 44 })),
        h('h2', { lang }, t('done')),
        h('div.done-stars', Array.from({ length: 3 }, (_, i) => icon(i < stars ? 'starFill' : 'star', { size: 30 }))),
        h(
          'div.done-stats',
          h('div', h('b', `${pct}%`), h('span', 'accuracy')),
          h('div', h('b', String(answeredCount)), h('span', 'answers')),
        ),
        h('button.btn.primary.wide', { onclick: () => onExit(answeredCount), lang }, t('next'), icon('next', { size: 18 })),
      ),
    );
    if (isKmUI) play('km', ui.km.done, { slow: false });
  }

  // ---------- widgets ----------
  const speakerBtn = (onclick, big = true) => h(`button.speaker${big ? '.big' : ''}`, { onclick, 'aria-label': 'Listen' }, icon('volume', { size: big ? 34 : 22 }));
  const slowBtn = (item) => h('button.speaker.slow', { onclick: () => sayTarget(item, { slow: true }), 'aria-label': 'Slow' }, icon('slow', { size: 20 }), h('small', '0.7×'));
  const instruction = (type) => {
    const text = isKmUI ? ui.km[type] : ui.en[type];
    if (!text) return null;
    return h(
      'p.instruction',
      { lang },
      isKmUI ? h('button.mini', { onclick: () => play('km', ui.km[type], { slow: false }), 'aria-label': 'Repeat instruction' }, icon('volume', { size: 16 })) : null,
      h('span', text),
    );
  };
  const kmText = (s, cls = '') => h(`span.km${cls}`, { lang: 'km' }, s);

  function choice(stage, ex, item, options, answerKey, correctLabel, cls = '', keepOrder = false) {
    const grid = h(
      `div.options${cls}`,
      (keepOrder ? options : shuffle(options)).map((o) =>
        h('button.opt', {
          'data-key': o.key,
          onclick: (e) => {
            const btn = e.currentTarget;
            const ok = o.key === answerKey;
            btn.classList.add(ok ? 'right' : 'wrong');
            if (!ok) grid.querySelector(`[data-key="${CSS.escape(answerKey)}"]`)?.classList.add('right');
            answered(ex, item, ok, stage, correctLabel, { hard: ex.hinted });
          },
        }, o.content),
      ),
    );
    stage.append(grid);
  }

  // ---------- 1. meet the word ----------
  function renderIntro(stage, item) {
    const nextBtn = h('button.btn.primary.wide', { onclick: () => { store.introduce(pid, item.id); next(); }, lang }, t('next'), icon('next', { size: 18 }));
    const tag = h('div.tag', { lang }, icon('sparkle', { size: 14 }), h('span', t('learnNew')));
    let card;
    let speech;
    let delay = 0;
    if (item.kind === 'word' && course.target === 'en' && item.phonics) {
      // Sound it out: letters drop in one by one, then slide together into the word.
      const blend = h('div.blend', [...item.c.en.toLowerCase()].map((ch, i) =>
        h(`span${'aeiou'.includes(ch) ? '.vowel' : ''}`, { style: `animation-delay:${i * 0.45}s` }, ch)));
      card = h('div.intro', h('div.pic', item.c.emoji), blend, kmText(item.c.km, '.meaning'));
      delay = item.c.en.length * 450 + 300;
      setTimeout(() => blend.classList.add('merged'), delay);
      const letters = [...item.c.en.toLowerCase()];
      const sounds = letters.every((ch) => hasAudio('en', `sound:${ch}`)) ? letters.map((ch) => ['en', `sound:${ch}`]) : [];
      speech = [...sounds, ['en', item.c.en, { slow: true }], ['en', item.c.en], ['km', item.c.km]];
    } else if (item.kind === 'word' && course.target === 'en') {
      card = h('div.intro', h('div.pic', item.c.emoji), h('div.word', item.c.en), kmText(item.c.km, '.meaning'));
      speech = [['en', item.c.en], ['km', item.c.km], ['en', item.c.en, { slow: true }]];
    } else if (item.kind === 'letter') {
      card = h(
        'div.intro',
        h('div.letter-pair', item.L, h('span', item.L.toLowerCase())),
        h('div.example', h('span.pic.small', item.ex.emoji), h('span.word', highlightLetter(item.ex.en, item.L))),
        kmText(item.ex.km, '.meaning'),
      );
      speech = [['en', `letter:${item.L}`], ['en', item.ex.en], ['km', item.ex.km]];
    } else if (item.kind === 'word') {
      card = h('div.intro', h('div.pic', item.c.emoji), kmText(item.c.km, '.khmer-big'), h('div.rom', item.c.rom), h('div.meaning', item.c.en));
      speech = [['km', item.c.km], ['km', item.c.km, { slow: true }]];
    } else if (item.kind === 'consonant') {
      card = h(
        'div.intro',
        kmText(item.ch, '.khmer-huge'),
        h('div.rom', item.rom),
        seriesBadge(item.s),
        h('p.note', item.s === 1 ? 'Series A — inherent vowel “â”; vowels take their first (high) reading.' : 'Series O — inherent vowel “ô”; vowels take their second (low) reading.'),
      );
      speech = [['km', item.ch], ['km', item.ch, { slow: true }]];
    } else if (item.kind === 'vowel') {
      card = h(
        'div.intro',
        kmText('◌' + item.v, '.khmer-huge'),
        h(
          'div.vowel-pair',
          h('button.vcell.sA', { onclick: () => play('km', 'ក' + item.v) }, kmText('ក' + item.v), h('div', item.r1), h('small', 'series A')),
          h('button.vcell.sO', { onclick: () => play('km', 'គ' + item.v) }, kmText('គ' + item.v), h('div', item.r2), h('small', 'series O')),
        ),
        h('p.note', 'Same vowel sign, two sounds — the consonant’s series decides.'),
      );
      speech = [['km', 'ក' + item.v], ['km', 'គ' + item.v]];
    }
    const replay = () => playSeq(speech);
    stage.append(tag, card, h('div.row', speakerBtn(replay), slowBtn(item)), h('div.foot', nextBtn));
    (async () => {
      if (isKmUI && !spokenInstructions.has('learnNew')) {
        spokenInstructions.add('learnNew');
        await play('km', ui.km.learnNew, { slow: false });
      }
      setTimeout(replay, delay);
    })();
  }

  // ---------- 2. write it straight away ----------
  function renderLearnWrite(stage, item) {
    const w = writable(course, item);
    stage.append(instruction('writeTrace') || '');
    const continueBtn = h('button.btn.primary.wide', { onclick: practised, lang, disabled: true }, t('next'), icon('next', { size: 18 }));
    const pad = writingPad(stage, item, w.glyph, { ...w.pad, guide: true, guided: true }, {
      onComplete: () => {
        continueBtn.disabled = false;
        tone(true);
        sayTarget(item);
      },
    });
    // Free tracing (no stroke data) can always continue; guided tracing unlocks when finished.
    if (!pad.guided) continueBtn.disabled = false;
    stage.append(h('div.foot', continueBtn));
  }

  /** A pad with listen / watch / clear controls and stroke hints. */
  function writingPad(stage, item, glyph, padOpts, { onComplete } = {}) {
    const hint = h('div.stroke-hint', { lang });
    const pad = tracePad(glyph, {
      ...padOpts,
      onStroke: (verdict, n, totalStrokes) => {
        hint.textContent = verdict === 'ok' ? (n < totalStrokes ? `${n} / ${totalStrokes}` : '') : t(STROKE_TIPS[verdict]);
        hint.className = `stroke-hint ${verdict === 'ok' ? 'good' : 'bad'}`;
        if (verdict !== 'ok' && isKmUI) play('km', ui.km[STROKE_TIPS[verdict]], { slow: false });
      },
      onDone: (mistakes) => onComplete?.(mistakes),
    });
    const tools = h(
      'div.pad-tools',
      h('button.tool', { onclick: () => sayTarget(item), 'aria-label': 'Listen' }, icon('volume', { size: 20 })),
      pad.hasStrokes && padOpts.guide ? h('button.tool.accent', { onclick: () => pad.demo(), lang }, icon('play', { size: 16 }), h('span', t('watch'))) : '',
      h('button.tool', { onclick: () => { pad.clear(); hint.textContent = ''; }, 'aria-label': 'Clear' }, icon('refresh', { size: 20 })),
    );
    stage.append(h('div.pad-wrap', pad.el), hint, tools);
    (async () => {
      await sayTarget(item);
      if (pad.guided) await pad.demo(); // watch first, then trace
    })();
    return pad;
  }

  // ---------- exercises ----------
  function render(stage, ex, item) {
    const type = ex.type;
    stage.append(instruction(type === 'consonant_trace' ? 'consonant_trace' : type) || '');
    const c = item.c;
    const enCourse = course.target === 'en';

    if (type === 'listen_pick') {
      const opts = [item, ...distractors(item, 'word', 3, (it) => it.c.emoji)];
      stage.append(h('div.row', speakerBtn(() => sayTarget(item)), slowBtn(item)));
      choice(stage, ex, item, opts.map((it) => ({
        key: it.id,
        content: enCourse ? h('span.opt-pic', it.c.emoji) : [h('span.opt-pic.sm', it.c.emoji), h('span.opt-label', it.c.en)],
      })), item.id, enCourse ? `${c.emoji} ${c.en}` : `${c.emoji} ${c.en} — ${c.rom}`, enCourse ? '.pics' : '');
      sayInstruction(type).then(() => sayTarget(item));
    } else if (type === 'read_pick') {
      const opts = [item, ...distractors(item, 'word', 3, (it) => it.c.emoji)];
      const hint = h('button.hint', { onclick: (e) => { ex.hinted = true; e.currentTarget.replaceChildren(c.rom); } }, icon('eye', { size: 16 }), h('span', 'hint'));
      stage.append(h('div.prompt', enCourse ? h('div.word.big', c.en) : [kmText(c.km, '.khmer-big'), hint]));
      choice(stage, ex, item, opts.map((it) => ({
        key: it.id,
        content: enCourse ? h('span.opt-pic', it.c.emoji) : [h('span.opt-pic.sm', it.c.emoji), h('span.opt-label', it.c.en)],
      })), item.id, enCourse ? `${c.emoji} ${c.en}` : `${c.emoji} ${c.en} — ${c.rom}`, enCourse ? '.pics' : '');
      sayInstruction(type);
    } else if (type === 'pick_word') {
      const opts = [item, ...distractors(item, 'word', 3, (it) => (enCourse ? it.c.en : it.c.km))];
      const showRom = store.card(pid, item.id).box < 4;
      stage.append(
        h('div.prompt', h('div.pic', c.emoji), enCourse ? h('button.mini.wide', { onclick: () => play('km', c.km) }, icon('volume', { size: 16 }), kmText(c.km)) : h('div.meaning', c.en)),
      );
      choice(stage, ex, item, opts.map((it) => ({
        key: it.id,
        content: enCourse ? h('span.opt-word', it.c.en) : [kmText(it.c.km, '.opt-km'), showRom ? h('small.opt-rom', it.c.rom) : null],
      })), item.id, enCourse ? c.en : `${c.km} — ${c.rom}`, '.words');
      sayInstruction(type).then(() => enCourse && play('km', c.km));
    } else if (type === 'spell') {
      renderBuild(stage, ex, item, [...c.en.toLowerCase()], '', true);
    } else if (type === 'sentence') {
      renderBuild(stage, ex, item, c.en.replace(/[?.!]/g, '').split(' '), ' ', false);
    } else if (type === 'letter_listen') {
      const opts = [item, ...distractors(item, 'letter', 3, (it) => it.L)];
      stage.append(h('div.row', speakerBtn(() => sayTarget(item))));
      choice(stage, ex, item, opts.map((it) => ({ key: it.id, content: h('span.opt-letter', Math.random() < 0.5 ? it.L : it.L.toLowerCase()) })), item.id, `${item.L} ${item.L.toLowerCase()}`, '.letters');
      sayInstruction(type).then(() => sayTarget(item));
    } else if (type === 'letter_word') {
      const opts = [item, ...distractors(item, 'letter', 3, (it) => it.ex.emoji)];
      stage.append(h('div.prompt', h('div.letter-pair', item.L, h('span', item.L.toLowerCase()))));
      choice(stage, ex, item, opts.map((it) => ({ key: it.id, content: h('span.opt-pic', it.ex.emoji) })), item.id, `${item.ex.emoji} ${item.ex.en}`, '.pics');
      sayInstruction(type).then(() => sayTarget(item));
    } else if (type === 'trace') {
      const glyph = Math.random() < 0.5 ? item.L : item.L.toLowerCase();
      renderGradedWrite(stage, ex, item, glyph, { ...LATIN_PAD, guide: true, guided: true }, `${item.L} ${item.L.toLowerCase()}`);
    } else if (type === 'write_memory') {
      // Case matching from memory: see "B", write "b" (or the other way round) with no model.
      const upper = Math.random() < 0.5;
      const shown = upper ? item.L : item.L.toLowerCase();
      const target = upper ? item.L.toLowerCase() : item.L;
      stage.append(h('div.case-cue', h('span', shown), icon('next', { size: 28 }), h('span.cue-blank', '?')));
      renderGradedWrite(stage, ex, item, target, { ...LATIN_PAD, guide: false }, `${shown} → ${target}`);
    } else if (type === 'write_copy') {
      // Copy: the model is shown beside an empty pad.
      const w = writable(course, item);
      const model = modelCanvas(w.glyph, { ...w.pad, px: 120 });
      stage.append(h('div.copy-row', h('div.model-card', model), item.c ? h('div.pic.small', item.c.emoji) : ''));
      renderGradedWrite(stage, ex, item, w.glyph, { ...w.pad, guide: false }, w.glyph, { model });
    } else if (type === 'write_word') {
      // From memory: picture + sound (+ meaning for Khmer), no model.
      const w = writable(course, item);
      stage.append(h('div.prompt', h('div.pic', c.emoji), enCourse ? '' : h('div.meaning', c.en)));
      renderGradedWrite(stage, ex, item, w.glyph, { ...w.pad, guide: false }, enCourse ? w.glyph : `${c.km} — ${c.rom}`);
    } else if (type === 'consonant_trace' || type === 'consonant_write') {
      const guide = type === 'consonant_trace';
      stage.append(h('div.row', h('div.rom', item.rom), seriesBadge(item.s)));
      document.fonts.load('400 100px Battambang').finally(() =>
        renderGradedWrite(stage, ex, item, item.ch, { ...KHMER_PAD, guide, guided: guide && Boolean(RECORDED[item.ch]) }, `${item.ch} — ${item.rom}`));
    } else if (type === 'say_it') {
      renderSayIt(stage, ex, item);
    } else if (type === 'first_sound') {
      const word = c.en.toLowerCase();
      const letters = [...new Set(Object.values(items).filter((it) => it.phonics).map((it) => it.c.en[0].toLowerCase()))];
      const opts = [word[0], ...shuffle(letters.filter((l) => l !== word[0])).slice(0, 3)];
      stage.append(h('div.prompt', h('div.pic', c.emoji), h('div.word.big', h('span.blank', '_'), word.slice(1)), h('div.row', speakerBtn(() => sayTarget(item), false), slowBtn(item))));
      choice(stage, ex, item, opts.map((l) => ({ key: l, content: h('span.opt-letter', l) })), word[0], word, '.letters');
      sayInstruction(type).then(() => sayTarget(item));
    } else if (type === 'missing_vowel') {
      const word = c.en.toLowerCase();
      const vi = [...word].findIndex((ch) => 'aeiou'.includes(ch));
      stage.append(h('div.prompt', h('div.pic', c.emoji), h('div.word.big', word.slice(0, vi), h('span.blank', '_'), word.slice(vi + 1)), h('div.row', speakerBtn(() => sayTarget(item), false), slowBtn(item))));
      choice(stage, ex, item, [...'aeiou'].map((v) => ({ key: v, content: h('span.opt-letter.vowel', v) })), word[vi], word, '.vowels', true);
      sayInstruction(type).then(() => sayTarget(item));
    } else if (type === 'rhyme') {
      const partner = items[pick(item.rhymes)];
      const others = shuffle(Object.values(items).filter((it) => it.phonics && it !== item && !item.rhymes.includes(it.id) && it.c.emoji !== c.emoji)).slice(0, 2);
      stage.append(h('div.prompt', h('div.pic', c.emoji), h('div.row', speakerBtn(() => sayTarget(item), false))));
      choice(stage, ex, item, [partner, ...others].map((it) => ({ key: it.id, content: h('span.opt-pic', it.c.emoji) })), partner.id, `${c.en} — ${partner.c.en}`, '.pics.three');
      ex.after = () => playSeq([['en', c.en], ['en', partner.c.en]]);
      // She can't read the options, so each picture's word is read aloud while it lights up.
      const buttons = [...stage.querySelectorAll('button.opt')];
      sayInstruction(type).then(async () => {
        await sayTarget(item);
        for (const b of buttons) {
          if (b.disabled) return;
          b.classList.add('speaking');
          await new Promise((r) => setTimeout(r, 300));
          await play('en', items[b.dataset.key].c.en);
          b.classList.remove('speaking');
        }
      });
    } else if (type === 'consonant_listen') {
      const opts = [item, ...distractors(item, 'consonant', 3, (it) => it.ch)];
      stage.append(h('div.row', speakerBtn(() => sayTarget(item)), slowBtn(item)));
      choice(stage, ex, item, opts.map((it) => ({ key: it.id, content: kmText(it.ch, '.opt-km.huge') })), item.id, `${item.ch} — ${item.rom}`, '.letters');
      sayTarget(item);
    } else if (type === 'consonant_sound') {
      const opts = [item, ...distractors(item, 'consonant', 3, (it) => it.rom)];
      stage.append(h('div.prompt', kmText(item.ch, '.khmer-huge')));
      choice(stage, ex, item, opts.map((it) => ({ key: it.id, content: h('span.opt-word', it.rom) })), item.id, `${item.ch} — ${item.rom}`, '.words');
    } else if (type === 'consonant_series') {
      stage.append(h('div.prompt', kmText(item.ch, '.khmer-huge')));
      choice(stage, ex, item, [
        { key: 's1', content: [seriesBadge(1), h('small', ' “â”')] },
        { key: 's2', content: [seriesBadge(2), h('small', ' “ô”')] },
      ], `s${item.s}`, `${item.ch} — ${item.rom} (series ${item.s === 1 ? 'A' : 'O'})`, '.words');
    } else if (type === 'vowel_sound') {
      const series = pick([1, 2]);
      const base = series === 1 ? 'ក' : 'គ';
      const r = (it) => (series === 1 ? it.r1 : it.r2);
      const opts = [item, ...distractors(item, 'vowel', 3, r)];
      stage.append(h('div.prompt', kmText(base + item.v, '.khmer-huge'), h('div.note', `${base} = series ${series === 1 ? 'A' : 'O'}`)));
      ex.speech = ['km', base + item.v]; // the feedback audio must match the series shown
      choice(stage, ex, item, opts.map((it) => ({ key: it.id, content: h('span.opt-word', 'k' + r(it)) })), item.id, `${base + item.v} — k${r(item)}`, '.words');
    }
  }

  function renderBuild(stage, ex, item, pieces, joiner, addDecoys) {
    const target = pieces.join(joiner);
    let tiles = pieces.map((p, i) => ({ p, i }));
    if (addDecoys) {
      const letters = 'abcdefghijklmnoprstuwy'.split('').filter((l) => !pieces.includes(l));
      tiles.push(...shuffle(letters).slice(0, 2).map((p, i) => ({ p, i: 100 + i })));
    }
    tiles = shuffle(tiles);
    const chosen = [];
    const slot = h('div.answer-slot');
    const bank = h('div.tile-bank');
    stage.append(h('div.prompt', h('div.pic', item.c.emoji), h('div.row', speakerBtn(() => sayTarget(item), false), slowBtn(item))), slot, bank);
    const checkBtn = h('button.btn.primary.wide', { onclick: check, disabled: true, lang }, t('check'));
    stage.append(h('div.foot', checkBtn));

    function draw() {
      slot.replaceChildren(...chosen.map((tile) => h('button.tile.chosen', { onclick: () => { chosen.splice(chosen.indexOf(tile), 1); draw(); } }, tile.p)));
      bank.replaceChildren(...tiles.map((tile) => h('button.tile', { disabled: chosen.includes(tile), onclick: () => { chosen.push(tile); play('en', tile.p.length === 1 ? `letter:${tile.p.toUpperCase()}` : tile.p); draw(); } }, tile.p)));
      checkBtn.disabled = chosen.length === 0;
      if (chosen.length === pieces.length) check();
    }
    function check() {
      const ok = chosen.map((tile) => tile.p).join(joiner).toLowerCase() === target.toLowerCase();
      slot.classList.add(ok ? 'right' : 'wrong');
      checkBtn.parentElement?.remove();
      answered(ex, item, ok, stage, item.c.en);
    }
    draw();
    sayInstruction(ex.type).then(() => sayTarget(item));
  }

  /** Graded writing: guided tracing finishes by itself; free writing has a Check button. */
  function renderGradedWrite(stage, ex, item, glyph, padOpts, answerLabel, { model } = {}) {
    let foot;
    const finishWith = (ok, opts) => {
      foot?.remove();
      answered(ex, item, ok, stage, answerLabel, opts);
    };
    const pad = writingPad(stage, item, glyph, padOpts, {
      onComplete: (mistakes) => finishWith(mistakes <= 2, { hard: mistakes > 0 }),
    });
    if (model && pad.hasStrokes) stage.querySelector('.copy-row')?.append(h('button.tool.accent', { onclick: () => model.demo(), lang }, icon('play', { size: 16 }), h('span', t('watch'))));
    if (!pad.guided) {
      const checkBtn = h('button.btn.primary.wide', {
        lang,
        onclick: () => {
          if (pad.empty) return;
          const score = pad.score();
          finishWith(score >= 0.55, { hard: score < 0.75 });
          if (!padOpts.guide) {
            pad.reveal(); // show the model to compare…
            if (pad.hasStrokes) setTimeout(() => pad.demo(), 900); // …and how it is written
          }
        },
      }, t('check'));
      foot = h('div.foot', checkBtn);
      stage.append(foot);
    }
    sayInstruction(ex.type);
  }

  /** Say it: she hears the word, records herself, Gemini listens; wrong sounds turn red. */
  function renderSayIt(stage, ex, item) {
    const word = item.c.en;
    const letters = [...(item.phonics ? word.toLowerCase() : word)].map((ch) => h('span.say-letter', ch));
    const result = h('div.say-result');
    const mic = h('button.mic', { 'aria-label': 'Record' }, icon('mic', { size: 36 }));
    const skip = h('button.link', { onclick: () => next(), lang }, t('next'));
    let tries = 0;
    const say = (k) => (isKmUI ? play('km', ui.km[k], { slow: false }) : Promise.resolve());

    stage.append(h('div.prompt', h('div.pic', item.c.emoji), h('div.say-word', letters), h('div.row', speakerBtn(() => sayTarget(item), false), slowBtn(item))), mic, result, skip);

    const ready = () => {
      mic.replaceChildren(icon('mic', { size: 36 }));
      mic.disabled = false;
      mic.onclick = attempt;
    };

    async function attempt() {
      stop();
      let session;
      try {
        session = await record({ maxMs: Math.min(6000, 2500 + word.length * 150) });
      } catch {
        result.replaceChildren(h('div.note', 'Microphone not available'));
        return;
      }
      mic.classList.add('recording');
      mic.replaceChildren(icon('stop', { size: 30 }));
      mic.onclick = () => session.stop();
      const blob = await session.done;
      mic.classList.remove('recording');
      mic.replaceChildren(h('span.spinner'));
      mic.disabled = true;
      let r;
      try {
        r = await checkSpeech(blob, word);
      } catch (err) {
        // No network / quota: don't punish her — show the problem and let her continue.
        result.replaceChildren(h('div.note', err.message));
        await say('spkError');
        return ready();
      }
      tries++;
      letters.forEach((el, i) => el.classList.toggle('bad', (r.wrongLetters || []).includes(i)));
      const ok = r.verdict === 'correct' || r.verdict === 'close';
      result.replaceChildren(
        h(`div.say-verdict.${r.verdict}`, icon(ok ? 'check' : 'x', { size: 28 })),
        r.heard && r.verdict !== 'correct' ? h('div.say-heard', icon('headphones', { size: 16 }), h('span', r.heard)) : '',
        r.tip ? h('div.note', r.tip) : '',
      );
      await say({ correct: 'spkCorrect', close: 'spkClose', wrong: 'spkWrong', silent: 'spkSilent' }[r.verdict] || 'spkError');
      await sayTarget(item, { slow: r.verdict !== 'correct' });
      // Silence never counts; otherwise she gets a second try before it is graded.
      if (r.verdict === 'silent' || (!ok && tries < 2)) return ready();
      mic.remove();
      skip.remove();
      answered(ex, item, ok, stage, word, { hard: r.verdict === 'close' });
    }
    mic.onclick = attempt;
    sayInstruction('say_it').then(() => sayTarget(item));
  }

  // Start once every helper above is initialised.
  if (queue.length) next();
  else finish();
}

export function seriesBadge(s) {
  return h(`span.badge.s${s === 1 ? 'A' : 'O'}`, s === 1 ? 'Series A' : 'Series O');
}

/** Bold the letter being taught inside its example word ("bo<b>x</b>" for X). */
function highlightLetter(word, L) {
  const i = word.toLowerCase().indexOf(L.toLowerCase());
  if (i < 0) return word;
  return [word.slice(0, i), h('b.hl', word[i]), word.slice(i + 1)];
}
