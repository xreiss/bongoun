// Builds a practice session (spaced repetition queue) and renders each exercise.

import { h, shuffle, pick } from './dom.js';
import { play, playSeq, stop, tone } from './audio.js';
import * as store from './store.js';
import { tracePad } from './trace.js';

// Exercise ladders: the higher the box (memory strength), the harder the exercise.
const LADDERS = {
  en: {
    word: ['listen_pick', 'read_pick', 'pick_word', 'spell'],
    phrase: ['listen_pick', 'read_pick', 'pick_word', 'sentence'],
    letter: ['letter_listen', 'letter_word', 'trace'],
  },
  km: {
    word: ['listen_pick', 'read_pick', 'pick_word'],
    phrase: ['listen_pick', 'read_pick', 'pick_word'],
    consonant: ['consonant_listen', 'consonant_sound', 'consonant_series'],
    vowel: ['vowel_sound'],
  },
};

const SESSION_REVIEWS = 10;
const SESSION_NEW = 4;

function ladderFor(course, item) {
  const L = LADDERS[course.id];
  if (item.kind === 'word') {
    if (item.c.cat === 'phrases') return L.phrase;
    if (course.id === 'en' && !/^[a-z]{2,8}$/i.test(item.c.en)) return L.word.slice(0, 3);
    return L.word;
  }
  return L[item.kind];
}

function chooseType(course, item, box) {
  const ladder = ladderFor(course, item);
  const top = Math.min(Math.max(box, 1), ladder.length) - 1;
  // Mostly the hardest unlocked exercise, sometimes an easier one for variety.
  return Math.random() < 0.7 || top === 0 ? ladder[top] : ladder[Math.floor(Math.random() * top)];
}

/** Build the exercise queue. unitIdx = null → global daily practice. */
export function buildQueue(course, items, pid, unitIdx = null) {
  const now = Date.now();
  const scope = unitIdx == null ? course.units.flatMap((u) => u.items) : course.units[unitIdx].items;
  const card = (id) => store.card(pid, id);

  const due = scope.filter((id) => card(id).box > 0 && card(id).due <= now).sort((a, b) => card(a).due - card(b).due);
  const fresh = scope.filter((id) => card(id).box === 0).slice(0, unitIdx == null ? SESSION_NEW : SESSION_NEW + 2);
  let reviews = due.slice(0, SESSION_REVIEWS);

  // Nothing due? Add extra practice on the weakest seen items (doesn't push intervals out).
  let extra = [];
  if (reviews.length + fresh.length < 6) {
    extra = shuffle(scope.filter((id) => card(id).box > 0 && !reviews.includes(id)))
      .sort((a, b) => card(a).box - card(b).box)
      .slice(0, 8 - reviews.length - fresh.length);
  }

  const q = [];
  const rest = shuffle([
    ...reviews.map((id) => ({ id, type: chooseType(course, items[id], card(id).box) })),
    ...extra.map((id) => ({ id, type: chooseType(course, items[id], card(id).box), extra: true })),
  ]);
  for (const id of fresh) {
    q.push({ id, type: 'intro' }, { id, type: ladderFor(course, items[id])[0] });
    if (rest.length) q.push(rest.shift());
  }
  q.push(...rest);
  return q;
}

/** Run a session inside `root`. Calls onExit(answeredCount) when finished or closed. */
export function runSession(root, { course, items, ui, pid, unitIdx = null, onExit }) {
  const queue = buildQueue(course, items, pid, unitIdx);
  const isKmUI = course.ui === 'km';
  const spokenInstructions = new Set();
  const requeued = new Set();
  let total = queue.filter((e) => e.type !== 'intro').length;
  let done = 0;
  let correct = 0;

  const pool = (kind) => Object.values(items).filter((it) => it.kind === kind && course.units.some((u) => u.items.includes(it.id)));
  const unitOf = (id) => course.units.find((u) => u.items.includes(id));

  // ---------- speech helpers ----------
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
    if (!isKmUI || !ui.km[type]) return;
    if (spokenInstructions.has(type)) return;
    spokenInstructions.add(type);
    await play('km', ui.km[type], { slow: false });
  };

  function distractors(item, kind, n, key) {
    const seen = new Set([key(item)]);
    const sameUnit = shuffle((unitOf(item.id)?.items || []).map((id) => items[id]).filter((it) => it.kind === kind));
    const all = shuffle(pool(kind));
    const out = [];
    for (const it of [...sameUnit, ...all]) {
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
    root.replaceChildren();
    const progress = h('div.progress', h('div.bar', { style: `width:${(done / Math.max(total, 1)) * 100}%` }));
    const close = h('button.icon-btn', { onclick: () => finish(true), 'aria-label': 'Close' }, '✕');
    root.append(h('div.session-top', close, progress));
    const stage = h('div.stage');
    root.append(stage);
    if (ex.type === 'intro') return renderIntro(stage, item);
    render(stage, ex, item);
  }

  function answered(ex, item, ok, stage, correctLabel) {
    done++;
    if (ok) correct++;
    tone(ok);
    if (!(ex.extra && ok)) store.grade(pid, item.id, ok);
    if (!ok && !requeued.has(item.id)) {
      requeued.add(item.id);
      const easier = ladderFor(course, item)[0];
      queue.splice(Math.min(3, queue.length), 0, { id: item.id, type: easier });
      total++;
    }
    const msg = isKmUI ? ui.km[ok ? 'correct' : 'wrong'] : ui.en[ok ? 'correct' : 'wrong'];
    const bar = h(
      `div.feedback.${ok ? 'ok' : 'bad'}`,
      h('div.fb-msg', { lang: isKmUI ? 'km' : 'en' }, (ok ? '✓ ' : '✗ ') + msg),
      correctLabel && !ok ? h('div.fb-answer', correctLabel) : null,
      h('button.btn.primary', { onclick: next, lang: isKmUI ? 'km' : 'en' }, isKmUI ? `${ui.km.next} →` : `${ui.en.next} →`),
    );
    stage.querySelectorAll('button.opt, button.tile').forEach((b) => (b.disabled = true));
    stage.append(bar);
    bar.querySelector('button').focus({ preventScroll: true });
    // Reinforce: always hear the right answer after responding.
    setTimeout(() => (ex.speech ? play(...ex.speech) : sayTarget(item)), 350);
  }

  function finish(early = false) {
    stop();
    if (done) store.recordSession(pid, done);
    if (early) return onExit(done);
    root.replaceChildren();
    const stars = done ? Math.max(1, Math.round((correct / done) * 3)) : 3;
    root.append(
      h(
        'div.stage.done',
        h('div.big-emoji', '🎉'),
        h('div.stars', '⭐'.repeat(stars) + '☆'.repeat(3 - stars)),
        h('h2', { lang: isKmUI ? 'km' : 'en' }, isKmUI ? ui.km.done : ui.en.done),
        h('p.muted', `${correct} / ${done}`),
        h('button.btn.primary.wide', { onclick: () => onExit(done) }, '✓'),
      ),
    );
    if (isKmUI) play('km', ui.km.done, { slow: false });
  }

  // ---------- shared widgets ----------
  const speakerBtn = (onclick, big = true) => h(`button.speaker${big ? '.big' : ''}`, { onclick, 'aria-label': 'Play' }, '🔊');
  const slowBtn = (item) => h('button.speaker.slowbtn', { onclick: () => sayTarget(item, { slow: true }), 'aria-label': 'Slow' }, '🐢');
  const instruction = (type) => {
    const text = isKmUI ? ui.km[type] : ui.en[type];
    if (!text) return null;
    return h(
      'div.instruction',
      { lang: isKmUI ? 'km' : 'en' },
      isKmUI ? h('button.mini', { onclick: () => play('km', ui.km[type], { slow: false }) }, '🔈') : null,
      text,
    );
  };
  const kmText = (s, cls = '') => h(`span.km${cls}`, { lang: 'km' }, s);

  function optionGrid(options, onChoose, cls = '') {
    return h(
      `div.options${cls}`,
      options.map((o) =>
        h('button.opt', {
          onclick: (e) => onChoose(o, e.currentTarget),
          'data-key': o.key,
        }, o.content),
      ),
    );
  }

  function choice(stage, ex, item, options, answerKey, correctLabel, cls) {
    const grid = optionGrid(shuffle(options), (o, btn) => {
      const ok = o.key === answerKey;
      btn.classList.add(ok ? 'right' : 'wrong');
      if (!ok) grid.querySelector(`[data-key="${CSS.escape(answerKey)}"]`)?.classList.add('right');
      answered(ex, item, ok, stage, correctLabel);
    }, cls);
    stage.append(grid);
  }

  // ---------- intro cards ----------
  function renderIntro(stage, item) {
    const nextBtn = h('button.btn.primary.wide', { onclick: () => { store.introduce(pid, item.id); next(); } }, isKmUI ? `${ui.km.next} →` : `${ui.en.next} →`);
    const tag = h('div.tag', { lang: isKmUI ? 'km' : 'en' }, '✨ ' + (isKmUI ? ui.km.learnNew : ui.en.learnNew));
    let card;
    let speech;
    if (item.kind === 'word' && course.target === 'en') {
      card = h('div.intro', h('div.big-emoji', item.c.emoji), h('div.word', item.c.en), kmText(item.c.km, '.meaning'));
      speech = [['en', item.c.en], ['km', item.c.km], ['en', item.c.en, { slow: true }]];
    } else if (item.kind === 'letter') {
      card = h(
        'div.intro',
        h('div.letter-pair', item.L, ' ', item.L.toLowerCase()),
        h('div.example', h('span.big-emoji.small', item.ex.emoji), h('span.word', highlightLetter(item.ex.en, item.L))),
        kmText(item.ex.km, '.meaning'),
      );
      speech = [['en', `letter:${item.L}`], ['en', item.ex.en], ['km', item.ex.km]];
    } else if (item.kind === 'word') {
      card = h('div.intro', h('div.big-emoji', item.c.emoji), kmText(item.c.km, '.khmer-big'), h('div.rom', item.c.rom), h('div.meaning', item.c.en));
      speech = [['km', item.c.km], ['km', item.c.km, { slow: true }]];
    } else if (item.kind === 'consonant') {
      card = h(
        'div.intro',
        kmText(item.ch, '.khmer-huge'),
        h('div.rom', item.rom),
        seriesBadge(item.s),
        h('p.muted.small', item.s === 1 ? 'Series A: inherent vowel “â” — vowels take their first (high) reading.' : 'Series O: inherent vowel “ô” — vowels take their second (low) reading.'),
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
        h('p.muted.small', 'Same vowel sign, two sounds — the consonant’s series decides.'),
      );
      speech = [['km', 'ក' + item.v], ['km', 'គ' + item.v]];
    }
    const replay = () => playSeq(speech);
    stage.append(tag, card, h('div.row', speakerBtn(replay), slowBtn(item)), nextBtn);
    (async () => {
      if (isKmUI && !spokenInstructions.has('learnNew')) {
        spokenInstructions.add('learnNew');
        await play('km', ui.km.learnNew, { slow: false });
      }
      replay();
    })();
  }

  // ---------- exercises ----------
  function render(stage, ex, item) {
    const t = ex.type;
    stage.append(instruction(t) || '');
    const c = item.c;
    const enCourse = course.target === 'en';

    if (t === 'listen_pick') {
      const opts = [item, ...distractors(item, 'word', 3, (it) => it.c.emoji)];
      stage.append(h('div.row', speakerBtn(() => sayTarget(item)), slowBtn(item)));
      choice(stage, ex, item, opts.map((it) => ({
        key: it.id,
        content: enCourse ? h('span.big-emoji.opt-emoji', it.c.emoji) : [h('span.opt-emoji', it.c.emoji), h('span.opt-label', it.c.en)],
      })), item.id, enCourse ? `${c.emoji} ${c.en}` : `${c.emoji} ${c.en} — ${c.rom}`, enCourse ? '.pics' : '');
      sayInstruction(t).then(() => sayTarget(item));
    } else if (t === 'read_pick') {
      const opts = [item, ...distractors(item, 'word', 3, (it) => it.c.emoji)];
      const hint = h('button.hint', { onclick: (e) => { e.currentTarget.textContent = c.rom; } }, '👁 hint');
      stage.append(h('div.prompt', enCourse ? h('div.word.big', c.en) : [kmText(c.km, '.khmer-big'), hint]));
      choice(stage, ex, item, opts.map((it) => ({
        key: it.id,
        content: enCourse ? h('span.big-emoji.opt-emoji', it.c.emoji) : [h('span.opt-emoji', it.c.emoji), h('span.opt-label', it.c.en)],
      })), item.id, enCourse ? `${c.emoji} ${c.en}` : `${c.emoji} ${c.en} — ${c.rom}`, enCourse ? '.pics' : '');
      sayInstruction(t);
    } else if (t === 'pick_word') {
      const opts = [item, ...distractors(item, 'word', 3, (it) => (enCourse ? it.c.en : it.c.km))];
      const showRom = store.card(pid, item.id).box < 4;
      stage.append(
        h('div.prompt', h('div.big-emoji', c.emoji), enCourse ? h('button.mini', { onclick: () => play('km', c.km) }, '🔈 ', kmText(c.km)) : h('div.meaning', c.en)),
      );
      choice(stage, ex, item, opts.map((it) => ({
        key: it.id,
        content: enCourse ? h('span.opt-word', it.c.en) : [kmText(it.c.km, '.opt-km'), showRom ? h('small.opt-rom', it.c.rom) : null],
      })), item.id, enCourse ? c.en : `${c.km} — ${c.rom}`, '.words');
      sayInstruction(t).then(() => enCourse && play('km', c.km));
    } else if (t === 'spell') {
      renderBuild(stage, ex, item, [...c.en.toLowerCase()], '', true);
    } else if (t === 'sentence') {
      renderBuild(stage, ex, item, c.en.replace(/[?.!]/g, '').split(' '), ' ', false);
    } else if (t === 'letter_listen') {
      const opts = [item, ...distractors(item, 'letter', 3, (it) => it.L)];
      stage.append(h('div.row', speakerBtn(() => sayTarget(item))));
      choice(stage, ex, item, opts.map((it) => ({ key: it.id, content: h('span.opt-letter', Math.random() < 0.5 ? it.L : it.L.toLowerCase()) })), item.id, `${item.L} ${item.L.toLowerCase()}`, '.letters');
      sayInstruction(t).then(() => sayTarget(item));
    } else if (t === 'letter_word') {
      const opts = [item, ...distractors(item, 'letter', 3, (it) => it.ex.emoji)];
      stage.append(h('div.prompt', h('div.letter-pair', item.L, ' ', item.L.toLowerCase())));
      choice(stage, ex, item, opts.map((it) => ({ key: it.id, content: h('span.big-emoji.opt-emoji', it.ex.emoji) })), item.id, `${item.ex.emoji} ${item.ex.en}`, '.pics');
      sayInstruction(t).then(() => sayTarget(item));
    } else if (t === 'trace') {
      renderTrace(stage, ex, item);
    } else if (t === 'consonant_listen') {
      const opts = [item, ...distractors(item, 'consonant', 3, (it) => it.ch)];
      stage.append(h('div.row', speakerBtn(() => sayTarget(item)), slowBtn(item)));
      choice(stage, ex, item, opts.map((it) => ({ key: it.id, content: kmText(it.ch, '.opt-km.huge') })), item.id, `${item.ch} — ${item.rom}`, '.letters');
      sayTarget(item);
    } else if (t === 'consonant_sound') {
      const opts = [item, ...distractors(item, 'consonant', 3, (it) => it.rom)];
      stage.append(h('div.prompt', kmText(item.ch, '.khmer-huge')));
      choice(stage, ex, item, opts.map((it) => ({ key: it.id, content: h('span.opt-word', it.rom) })), item.id, `${item.ch} — ${item.rom}`, '.words');
    } else if (t === 'consonant_series') {
      stage.append(h('div.prompt', kmText(item.ch, '.khmer-huge')));
      choice(stage, ex, item, [
        { key: 's1', content: [seriesBadge(1), h('small', ' “â”')] },
        { key: 's2', content: [seriesBadge(2), h('small', ' “ô”')] },
      ], `s${item.s}`, `${item.ch} — ${item.rom} (series ${item.s === 1 ? 'A' : 'O'})`, '.words');
    } else if (t === 'vowel_sound') {
      const series = pick([1, 2]);
      const base = series === 1 ? 'ក' : 'គ';
      const r = (it) => (series === 1 ? it.r1 : it.r2);
      const opts = [item, ...distractors(item, 'vowel', 3, r)];
      stage.append(h('div.prompt', kmText(base + item.v, '.khmer-huge'), h('div.muted.small', `${base} = series ${series === 1 ? 'A' : 'O'}`)));
      // The feedback audio must match the series shown.
      ex.speech = ['km', base + item.v];
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
    stage.append(
      h('div.prompt', h('div.big-emoji', item.c.emoji), h('div.row', speakerBtn(() => sayTarget(item), false), slowBtn(item))),
      slot,
      bank,
    );
    const checkBtn = h('button.btn.primary.wide', { onclick: check, disabled: true }, isKmUI ? ui.km.check : ui.en.check);
    stage.append(checkBtn);

    function draw() {
      slot.replaceChildren(...chosen.map((t) => h('button.tile.chosen', { onclick: () => { chosen.splice(chosen.indexOf(t), 1); draw(); } }, t.p)));
      bank.replaceChildren(...tiles.map((t) => h('button.tile', { disabled: chosen.includes(t), onclick: () => { chosen.push(t); play('en', t.p.length === 1 ? `letter:${t.p.toUpperCase()}` : t.p); draw(); } }, t.p)));
      checkBtn.disabled = chosen.length === 0;
      if (chosen.length === pieces.length) check();
    }
    function check() {
      const ok = chosen.map((t) => t.p).join(joiner).toLowerCase() === target.toLowerCase();
      slot.classList.add(ok ? 'right' : 'wrong');
      checkBtn.remove();
      answered(ex, item, ok, stage, item.c.en);
    }
    draw();
    sayInstruction(ex.type).then(() => sayTarget(item));
  }

  function renderTrace(stage, ex, item) {
    const glyph = Math.random() < 0.5 ? item.L : item.L.toLowerCase();
    const pad = tracePad(glyph);
    const checkBtn = h('button.btn.primary', {
      onclick: () => {
        if (pad.empty) return;
        const s = pad.score();
        const ok = s >= 0.55;
        checkBtn.remove();
        clearBtn.remove();
        answered(ex, item, ok, stage, `${item.L} ${item.L.toLowerCase()}`);
      },
    }, isKmUI ? ui.km.check : ui.en.check);
    const clearBtn = h('button.btn', { onclick: () => pad.clear() }, '↺ ' + (isKmUI ? ui.km.clear : ui.en.clear));
    stage.append(h('div.row', speakerBtn(() => sayTarget(item), false)), pad.el, h('div.row', clearBtn, checkBtn));
    sayInstruction('trace').then(() => sayTarget(item));
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
