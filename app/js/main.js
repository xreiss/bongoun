// App shell: profile picker, course path, Khmer alphabet reference, native-speaker check.

import { h } from './dom.js';
import { loadAudioIndex, play, audioSettings, stop, tone } from './audio.js';
import * as store from './store.js';
import { buildCourses } from './courses.js';
import { runSession, seriesBadge } from './session.js';
import { tracePad, modelCanvas } from './trace.js';
import { RECORDED, loadRecorded, saveRecording } from './strokes.js';

const PROFILES = [
  { id: 'her', course: 'en', theme: 'lotus', glyph: 'Aa', title: 'English', sub: 'រៀនភាសាអង់គ្លេស', subLang: 'km' },
  { id: 'xavier', course: 'km', theme: 'temple', glyph: 'ក', title: 'ភាសាខ្មែរ', sub: 'Learn Khmer', subLang: 'en' },
];
const DAILY_GOAL = 20;
// Horizontal offsets (px) that make the lesson path wind left and right.
const PATH_WAVE = [0, 52, 78, 52, 0, -52, -78, -52];

const app = document.getElementById('app');
let data;

async function init() {
  const [concepts, script, ui] = await Promise.all(
    ['concepts', 'khmer-script', 'ui'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())),
  );
  await Promise.all([loadAudioIndex(), loadRecorded()]);
  data = { ...buildCourses(concepts, script), concepts, script, ui };
  const last = PROFILES.find((p) => p.id === store.lastProfile());
  last ? dashboard(last) : home();
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme || '';
  const color = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

function show(...children) {
  stop();
  window.scrollTo(0, 0);
  app.replaceChildren(...children);
}

// ---------- home ----------
function home() {
  setTheme('');
  show(
    h(
      'div.screen.home',
      h('div.brand', h('div.brand-km', { lang: 'km' }, 'បងអូន'), h('div.brand-en', 'BongOun')),
      h('p.tagline', 'Learn together · ', h('span', { lang: 'km' }, 'រៀនជាមួយគ្នា')),
      h(
        'div.profiles',
        PROFILES.map((p) =>
          h(
            `button.profile-card.t-${p.theme}`,
            { onclick: () => { store.setLast(p.id); dashboard(p); } },
            h('span.p-glyph', { lang: p.course === 'km' ? 'km' : 'en' }, p.glyph),
            h('span.p-text', h('span.p-title', { lang: p.course === 'km' ? 'km' : 'en' }, p.title), h('span.p-sub', { lang: p.subLang }, p.sub)),
            h('span.p-arrow', '›'),
          ),
        ),
      ),
      h('div.footer', h('button.link', { onclick: backupDialog }, 'Backup / restore progress')),
    ),
  );
}

// ---------- dashboard: header + winding lesson path ----------
function dashboard(p) {
  setTheme(p.theme);
  const course = data.courses[p.course];
  const lang = course.ui;
  const t = (k) => data.ui[lang][k];
  const now = Date.now();
  const allItems = course.units.flatMap((u) => u.items);
  const due = allItems.filter((id) => { const c = store.card(p.id, id); return c.box > 0 && c.due <= now; }).length;
  const today = store.todayCount(p.id);

  const header = h(
    'header.dash-head',
    h(
      'div.topbar',
      h('button.icon-btn', { onclick: () => { store.setLast(null); home(); }, 'aria-label': 'Switch profile' }, '⇄'),
      h('div.stat', h('span.flame', '🔥'), h('b', String(store.streak(p.id)))),
      goalRing(today, DAILY_GOAL, t('goal')),
      slowToggle(),
    ),
    h(
      'button.hero',
      { onclick: () => startSession(p, null), lang },
      h('span.hero-play', '▶'),
      h('span.hero-text', h('span.hero-title', t('practice')), h('span.hero-sub', { lang }, t('welcome'))),
      due ? h('span.pill', String(due)) : null,
    ),
    course.id === 'km'
      ? h(
          'div.chips',
          h('button.chip', { onclick: () => alphabet(p) }, h('span', { lang: 'km' }, 'កខគ'), ' Alphabet'),
          h('button.chip', { onclick: () => writing(p) }, '✍️ ', t('writing')),
          h('button.chip', { onclick: () => nativeCheck(p) }, '🎧 ', t('checkTitle')),
        )
      : h('div.chips', h('button.chip.big-chip', { onclick: () => writing(p), lang: 'km' }, h('span.chip-icon', '✍️'), ' ', t('writing'), h('span.chip-sample', 'Aa'))),
  );

  const current = course.units.findIndex((u) => u.items.some((id) => store.card(p.id, id).box === 0));
  const path = h(
    'div.path',
    course.units.map((u, i) => {
      const total = u.items.length;
      const seen = u.items.filter((id) => store.card(p.id, id).box > 0).length;
      const strong = u.items.filter((id) => store.card(p.id, id).box >= 4).length;
      const pct = Math.round(((seen + strong) / (2 * total)) * 100);
      const state = strong === total ? 'mastered' : i === current ? 'current' : seen ? 'started' : 'fresh';
      const isKmIcon = /^[ក-៿]/.test(u.icon);
      return h(
        `div.node-wrap.${state}`,
        { style: `--x:${PATH_WAVE[i % PATH_WAVE.length]}px` },
        state === 'current' ? h('div.bubble', { lang }, t('start')) : null,
        h(
          'button.node',
          { onclick: () => startSession(p, i), style: `--pct:${pct}`, 'aria-label': u.title },
          h('span.node-face', { lang: isKmIcon ? 'km' : 'en' }, state === 'mastered' ? '★' : u.icon),
        ),
        h('div.node-label', u.title),
      );
    }),
  );

  show(h('div.screen.dash', header, h('h3.section', { lang }, t('lessons')), path));
  if (lang === 'km') setTimeout(() => play('km', data.ui.km.welcome, { slow: false }), 300);
}

function goalRing(value, goal, label) {
  const pct = Math.min(value / goal, 1);
  const r = 17;
  const c = 2 * Math.PI * r;
  const svg = `<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="${r}" class="ring-bg"/><circle cx="22" cy="22" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`;
  const el = h('div.goal', { title: label, 'aria-label': `${label}: ${value}/${goal}` });
  el.innerHTML = svg;
  el.append(h('span.goal-num', pct >= 1 ? '✓' : String(value)));
  return el;
}

function startSession(p, unitIdx) {
  const course = data.courses[p.course];
  const root = h('div.screen.session');
  show(root);
  runSession(root, { course, items: data.items, ui: data.ui, pid: p.id, unitIdx, onExit: () => dashboard(p) });
}

// ---------- Khmer alphabet reference ----------
function alphabet(p) {
  const { consonants, vowels, subscripts, seriesDemo } = data.script;
  const cell = (c) =>
    h(`button.kcell.s${c.s === 1 ? 'A' : 'O'}`, { onclick: () => play('km', c.ch) }, h('span.kch', { lang: 'km' }, c.ch), h('span.krom', c.rom));
  show(
    h(
      'div.screen.alphabet',
      h('div.topbar', h('button.icon-btn', { onclick: () => dashboard(p), 'aria-label': 'Back' }, '←'), h('div.top-title', 'Khmer alphabet'), slowToggle()),

      h(
        'section.card',
        h('h3', 'The golden rule: two series'),
        h('p.muted', 'Every consonant is series A (high voice, inherent “â”) or series O (low voice, inherent “ô”). The same vowel sign reads differently depending on the series. Tap to compare:'),
        h(
          'div.demo',
          seriesDemo.map((d) =>
            h(
              'div.demo-row',
              h('button.vcell.sA', { onclick: () => play('km', d.a) }, h('span', { lang: 'km' }, d.a)),
              h('span.vs', { lang: 'km' }, '◌' + d.v),
              h('button.vcell.sO', { onclick: () => play('km', d.o) }, h('span', { lang: 'km' }, d.o)),
            ),
          ),
        ),
      ),

      h('section.card', h('h3', '33 consonants ', seriesBadge(1), ' ', seriesBadge(2)), h('div.kgrid', consonants.map(cell))),

      h(
        'section.card',
        h('h3', 'Dependent vowels'),
        h('p.muted', 'Left: with series A (ក). Right: with series O (គ).'),
        h(
          'div.vtable',
          vowels.map((v) =>
            h(
              'div.vrow',
              h('span.vsign', { lang: 'km' }, '◌' + v.v),
              h('button.vcell.sA', { onclick: () => play('km', 'ក' + v.v) }, h('span', { lang: 'km' }, 'ក' + v.v), h('small', v.r1)),
              h('button.vcell.sO', { onclick: () => play('km', 'គ' + v.v) }, h('span', { lang: 'km' }, 'គ' + v.v), h('small', v.r2)),
            ),
          ),
        ),
      ),

      h(
        'section.card',
        h('h3', 'Subscripts ', h('span', { lang: 'km' }, 'ជើងអក្សរ'), ' — “feet”'),
        h('p.muted', 'A second consonant written under the first, with no vowel between them.'),
        subscripts.map((s) =>
          h(
            'div.sub-card',
            h('button.sub-word', { onclick: () => play('km', s.word) }, h('span', { lang: 'km' }, s.word), h('span.krom', ` ${s.rom} — ${s.en}`)),
            h('ul', s.parts.map(([g, d]) => h('li', h('b', { lang: 'km' }, g), ' ', d))),
          ),
        ),
      ),
    ),
  );
}

// ---------- handwriting: trace → copy → write from memory ----------
const KHMER_FONT = 'Battambang, "Khmer Sangam MN", serif'; // traditional forms with the "heads" you write
const LATIN_FONT = 'Andika, "Avenir Next", sans-serif'; // school print: single-storey a and g
const MODES = [
  { id: 'trace', icon: '✏️' },
  { id: 'copy', icon: '👀' },
  { id: 'memory', icon: '🎧' },
];

/** Writing sets per course: [{ title, items: [{ g, say: [lang, key], label }] }]. */
function writingSets(course) {
  if (course.id === 'km') {
    const { consonants, subscripts } = data.script;
    return [
      { title: 'ក ខ គ', items: consonants.map((c) => ({ g: c.ch, say: ['km', c.ch], label: c.rom, s: c.s })) },
      { title: 'ខ្ញុំ', items: subscripts.map((w) => ({ g: w.word, say: ['km', w.word], label: `${w.rom} — ${w.en}` })) },
    ];
  }
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const phonicsWords = course.units.filter((u) => u.phonics).flatMap((u) => u.items).map((id) => data.items[id].c);
  return [
    { title: 'A B C', items: [...L].map((x) => ({ g: x, say: ['en', `letter:${x}`] })) },
    { title: 'a b c', items: [...L.toLowerCase()].map((x) => ({ g: x, say: ['en', `letter:${x.toUpperCase()}`] })) },
    { title: 'cat', items: phonicsWords.map((c) => ({ g: c.en.toLowerCase(), say: ['en', c.en], emoji: c.emoji })) },
  ];
}

async function writing(p, state = { set: 0, i: 0, mode: 'trace' }) {
  setTheme(p.theme);
  const course = data.courses[p.course];
  const km = course.id === 'km';
  const lang = course.ui;
  const t = (k) => data.ui[lang][k];
  const font = km ? KHMER_FONT : LATIN_FONT;
  const padOpts = km ? { font, ink: 0.045 } : { font, ink: 0.06, lines: true };
  await document.fonts.load(`400 100px ${font}`).catch(() => {});
  const sets = writingSets(course);
  const bestKey = `learnering:writing:${course.id}`;
  const best = (() => { try { return JSON.parse(localStorage.getItem(bestKey)) || {}; } catch { return {}; } })();
  const starKey = (g) => `${state.mode}:${g}`;
  const modes = km ? [...MODES, { id: 'record', icon: '🎥' }] : MODES;

  const tabs = h('div.mode-tabs', { style: `grid-template-columns:repeat(${modes.length},1fr)` });
  const setTabs = h('div.set-tabs');
  const instr = h('div.instruction.center', { lang });
  const strip = h('div.glyph-strip');
  const stage = h('div.stage');
  show(
    h(
      'div.screen.writing',
      h('div.topbar', h('button.icon-btn', { onclick: () => dashboard(p), 'aria-label': 'Back' }, '←'), h('div.top-title', { lang }, '✍️ ', t('writing')), slowToggle()),
      tabs,
      setTabs,
      instr,
      strip,
      stage,
    ),
  );

  const modeKey = { trace: 'writeTrace', copy: 'writeCopy', memory: 'writeMemory', record: 'recordHelp' };
  const speak = (key) => (lang === 'km' && data.ui.km[key] ? play('km', data.ui.km[key], { slow: false }) : Promise.resolve());

  function drawTabs() {
    const capKey = { trace: 'modeTrace', copy: 'modeCopy', memory: 'modeMemory' };
    tabs.replaceChildren(...modes.map((m) =>
      h(`button.mode-tab${m.id === state.mode ? '.on' : ''}`, { lang, onclick: () => { state.mode = m.id; render(true); } },
        h('span.mode-icon', m.icon), m.id === 'record' ? 'Record' : t(capKey[m.id]))));
    setTabs.replaceChildren(...sets.map((st, j) =>
      h(`button.set-tab${j === state.set ? '.on' : ''}`, { lang: km ? 'km' : 'en', onclick: () => { state.set = j; state.i = 0; render(); } }, st.title)));
    instr.replaceChildren(
      lang === 'km' ? h('button.mini', { onclick: () => speak(modeKey[state.mode]) }, '🔈') : '',
      t(modeKey[state.mode]),
    );
  }

  function drawStrip() {
    const items = sets[state.set].items;
    strip.replaceChildren(...items.map((x, j) =>
      h(`button.gchip${j === state.i ? '.on' : ''}${x.s ? `.s${x.s === 1 ? 'A' : 'O'}` : ''}${km ? '.khmer' : '.latin'}`,
        { onclick: () => { state.i = j; render(); } },
        x.g,
        state.mode === 'record'
          ? (RECORDED[x.g] ? h('small.gstar', '●') : '')
          : best[starKey(x.g)] ? h('small.gstar', '★'.repeat(best[starKey(x.g)])) : '')));
    strip.children[state.i]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  function award(x, stars, result) {
    if (stars > (best[starKey(x.g)] || 0)) {
      best[starKey(x.g)] = stars;
      try { localStorage.setItem(bestKey, JSON.stringify(best)); } catch { /* ignore */ }
    }
    tone(stars >= 2);
    result.replaceChildren(h('span.stars', '★'.repeat(stars) + '☆'.repeat(3 - stars)));
    drawStrip();
  }

  function render(newMode = false) {
    drawTabs();
    drawStrip();
    const items = sets[state.set].items;
    const x = items[state.i];
    const say = () => play(...x.say);
    const result = h('div.trace-result');
    const prompt = h('div.write-prompt');
    const next = () => { state.i = (state.i + 1) % items.length; render(); };
    const nextBtn = h('button.btn', { onclick: next, 'aria-label': 'Next' }, '→');
    const feedback = { start: 'strokeStart', direction: 'strokeDirection', shape: 'strokeShape' };
    const hint = h('div.stroke-hint', { lang });

    if (state.mode === 'record') return renderRecorder(x, say);

    const pad = tracePad(x.g, {
      ...padOpts,
      guide: state.mode === 'trace',
      guided: state.mode === 'trace',
      onStroke: (verdict, done, total) => {
        hint.textContent = verdict === 'ok' ? (done < total ? `${done} / ${total}` : '') : t(feedback[verdict]);
        hint.className = `stroke-hint ${verdict === 'ok' ? 'good' : 'bad'}`;
        if (verdict !== 'ok') speak(feedback[verdict]);
      },
      onDone: (mistakes) => {
        const stars = mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1;
        award(x, stars, result);
        hint.textContent = '';
        (lang === 'km' ? speak(stars >= 2 ? 'correct' : 'wrong') : Promise.resolve()).then(say);
      },
    });

    // "Watch" replays the stroke order; it starts by itself the first time a letter is shown.
    let model = null;
    const watch = () => (state.mode === 'copy' ? model?.demo() : pad.demo());
    const canWatch = pad.hasStrokes;
    if (state.mode === 'copy') {
      model = modelCanvas(x.g, { ...padOpts, px: 110 });
      prompt.append(h('div.model-card', model));
    }
    if (state.mode === 'memory') prompt.append(h('button.speaker.big', { onclick: say, 'aria-label': 'Listen' }, '🔊'));
    else prompt.append(h('button.speaker', { onclick: say, 'aria-label': 'Listen' }, '🔊'));
    if (canWatch && state.mode !== 'memory') prompt.append(h('button.watch-btn', { onclick: watch, lang }, '▶ ', t('watch')));
    if (x.emoji) prompt.append(h('span.big-emoji.small', x.emoji));
    if (x.label) prompt.append(h('div.write-label', h('span.rom', x.label), x.s ? [' ', seriesBadge(x.s)] : ''));
    if (km && !canWatch && state.mode === 'trace') prompt.append(h('div.muted.small.center-text', 'No recorded stroke order for this letter yet — start at its small circle or hook (the “head”). Use 🎥 Record to add it.'));

    const buttons = [h('button.btn', { onclick: () => { pad.clear(); result.replaceChildren(); hint.textContent = ''; }, 'aria-label': 'Clear' }, '↺')];
    if (!pad.guided) {
      buttons.push(h('button.btn.primary', {
        lang,
        onclick: async () => {
          if (pad.empty) return;
          const score = pad.score();
          const stars = score >= 0.8 ? 3 : score >= 0.6 ? 2 : score >= 0.45 ? 1 : 0;
          award(x, stars, result);
          if (state.mode !== 'trace') {
            pad.reveal();
            await (lang === 'km' ? speak(stars >= 2 ? 'correct' : 'wrong') : Promise.resolve());
            if (pad.hasStrokes) await pad.demo(); // show the right way to write it
          }
          say();
        },
      }, t('check')));
    }
    buttons.push(nextBtn);
    stage.replaceChildren(prompt, pad.el, hint, result, h('div.row', ...buttons));

    (async () => {
      if (newMode) await speak(modeKey[state.mode]);
      await say();
      if (canWatch && state.mode !== 'memory') await watch();
    })();
  }

  // 🎥 A native writer records the stroke order of a Khmer letter once; it then powers the lessons.
  function renderRecorder(x, say) {
    const pad = tracePad(x.g, { ...padOpts, guide: true, guided: false, ink: 0.03 });
    const status = h('div.muted.small.center-text', RECORDED[x.g] ? 'Recorded ✓ — write it again to replace it.' : 'Not recorded yet.');
    stage.replaceChildren(
      h('div.write-prompt', h('button.speaker', { onclick: say }, '🔊'), x.label ? h('span.rom', x.label) : ''),
      pad.el,
      status,
      h(
        'div.row',
        h('button.btn', { onclick: () => pad.clear() }, '↺'),
        h('button.btn.primary', {
          onclick: () => {
            const strokes = pad.strokes;
            if (!strokes.length) return;
            // Thin out points so the recording stays small.
            saveRecording(x.g, strokes.map((s) => s.filter((_, i) => i % 2 === 0 || i === s.length - 1)));
            status.textContent = `Saved ✓ (${strokes.length} stroke${strokes.length > 1 ? 's' : ''})`;
            drawStrip();
          },
        }, 'Save'),
        RECORDED[x.g] ? h('button.btn', { onclick: () => { saveRecording(x.g, null); render(); } }, 'Delete') : '',
      ),
      h('button.link', {
        onclick: (e) => {
          navigator.clipboard?.writeText(JSON.stringify(RECORDED));
          e.currentTarget.textContent = `Copied ${Object.keys(RECORDED).length} recordings — paste them to Claude`;
        },
      }, 'Copy all recordings'),
    );
  }

  render(true);
}

// ---------- native-speaker check: listen to every Khmer clip, mark ✓ / ✗ ----------
function checkItems() {
  const out = data.concepts.map((c) => ({ key: `w:${c.id}`, km: c.km, label: `${c.emoji} ${c.en}`, emoji: c.emoji, en: c.en, rom: c.rom }));
  for (const c of data.script.consonants) out.push({ key: `C:${c.ch}`, km: c.ch, emoji: '🔤', en: `consonant ${c.rom}`, rom: c.rom });
  for (const v of data.script.vowels) {
    out.push({ key: `V1:${v.v}`, km: 'ក' + v.v, emoji: '🔤', en: 'syllable', rom: 'k' + v.r1 });
    out.push({ key: `V2:${v.v}`, km: 'គ' + v.v, emoji: '🔤', en: 'syllable', rom: 'k' + v.r2 });
  }
  for (const s of data.script.subscripts) out.push({ key: `S:${s.word}`, km: s.word, emoji: '🔤', en: s.en, rom: s.rom });
  return out;
}

function nativeCheck(p) {
  setTheme('lotus'); // her colours: she is the one holding the phone
  const items = checkItems();
  const verdicts = store.checks();
  let i = items.findIndex((it) => !verdicts[it.key]);
  if (i < 0) return checkSummary(p, items);

  const stage = h('div.stage');
  const counter = h('div.top-title');
  show(
    h(
      'div.screen.session',
      h('div.topbar', h('button.icon-btn', { onclick: () => checkSummary(p, items), 'aria-label': 'Results' }, '☰'), counter, h('span')),
      h('div.instruction.center', { lang: 'km' }, h('button.mini', { onclick: () => play('km', data.ui.km.checkHelp, { slow: false }) }, '🔈'), data.ui.km.checkHelp),
      stage,
    ),
  );
  render(false);
  play('km', data.ui.km.checkHelp, { slow: false }).then(() => play('km', items[i].km));

  function render(speak = true) {
    if (i >= items.length) return checkSummary(p, items);
    const it = items[i];
    counter.textContent = `${i + 1} / ${items.length}`;
    const mark = (v) => {
      store.setCheck(it.key, v);
      i++;
      render();
    };
    stage.replaceChildren(
      h('div.check-card', h('div.big-emoji', it.emoji), h('div.khmer-big', { lang: 'km' }, it.km), h('div.muted', it.en)),
      h('div.row', h('button.speaker.big', { onclick: () => play('km', it.km) }, '🔊'), h('button.speaker', { onclick: () => play('km', it.km, { slow: true }) }, '🐢')),
      h('div.verdict', h('button.vbtn.bad', { onclick: () => mark('bad'), 'aria-label': 'Wrong' }, '✗'), h('button.vbtn.ok', { onclick: () => mark('ok'), 'aria-label': 'Correct' }, '✓')),
      i > 0 ? h('button.link', { onclick: () => { i--; render(); } }, '← back') : '',
    );
    if (speak) play('km', it.km);
  }
}

function checkSummary(p, items) {
  setTheme(p.theme);
  const verdicts = store.checks();
  const bad = items.filter((it) => verdicts[it.key] === 'bad');
  const done = items.filter((it) => verdicts[it.key]).length;
  const report = bad.map((it) => `${it.key}\t${it.km}\t${it.rom}\t${it.en}`).join('\n');
  show(
    h(
      'div.screen',
      h('div.topbar', h('button.icon-btn', { onclick: () => dashboard(p), 'aria-label': 'Back' }, '←'), h('div.top-title', 'Native check'), h('span')),
      h('section.card', h('h3', `${done} / ${items.length} checked · ${bad.length} flagged`), h('p.muted', data.ui.en.checkHelp),
        h('div.row', h('button.btn.primary', { onclick: () => nativeCheck(p) }, done < items.length ? 'Continue checking' : 'Review again'),
          done ? h('button.btn', { onclick: () => { if (confirm('Clear all verdicts?')) { Object.keys(verdicts).forEach((k) => store.setCheck(k, undefined)); checkSummary(p, items); } } }, 'Reset') : null)),
      bad.length
        ? h(
            'section.card',
            h('h3', 'Flagged — send this list to Claude'),
            h('ul.flag-list', bad.map((it) => h('li', h('button.mini', { onclick: () => play('km', it.km) }, '🔈'), ' ', h('b', { lang: 'km' }, it.km), ` ${it.rom} — ${it.en}`))),
            h('button.btn.wide', { onclick: (e) => { navigator.clipboard?.writeText(report); e.currentTarget.textContent = 'Copied ✓'; } }, 'Copy list'),
          )
        : null,
    ),
  );
}

// ---------- widgets ----------
function slowToggle() {
  const btn = h('button.icon-btn', {
    'aria-label': 'Slow audio',
    onclick: () => {
      audioSettings.slow = !audioSettings.slow;
      try { localStorage.setItem('learnering:slow', audioSettings.slow ? '1' : ''); } catch { /* ignore */ }
      btn.classList.toggle('on', audioSettings.slow);
    },
  }, '🐢');
  btn.classList.toggle('on', audioSettings.slow);
  return btn;
}

function backupDialog() {
  const area = h('textarea.backup', { value: store.exportData(), rows: 6 });
  const dlg = h(
    'dialog.backup-dlg',
    h('p', 'Copy this text to back up. Paste a backup and press Restore to load it.'),
    area,
    h(
      'div.row',
      h('button.btn', { onclick: () => navigator.clipboard?.writeText(area.value) }, 'Copy'),
      h('button.btn', {
        onclick: () => {
          try {
            store.importData(area.value);
            dlg.close();
            home();
          } catch (e) {
            alert(e.message);
          }
        },
      }, 'Restore'),
      h('button.btn', { onclick: () => dlg.close() }, 'Close'),
    ),
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

try { audioSettings.slow = localStorage.getItem('learnering:slow') === '1'; } catch { /* ignore */ }

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init().catch((e) => {
  app.textContent = 'Failed to load: ' + e.message;
});
