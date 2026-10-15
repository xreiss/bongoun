// App shell: profile picker, course path, Khmer alphabet reference, native-speaker check.

import { h } from './dom.js';
import { loadAudioIndex, loadLocalVoices, setLocalVoice, nativeVoice, play, playTimed, audioSettings, stop, tone } from './audio.js';
import { record, saveClip, deleteClip, exportClips, allClips } from './voice.js';
import { hasGemini, connectGemini, forgetGemini, geminiModel, translateToKhmer } from './gemini.js';
import * as store from './store.js';
import { buildCourses } from './courses.js';
import { runSession, seriesBadge, weakItems } from './session.js';
import { tracePad, modelCanvas } from './trace.js';
import { RECORDED, loadRecorded, saveRecording } from './strokes.js';
import { icon } from './icons.js';

const PROFILES = [
  { id: 'her', course: 'en', theme: 'lotus', glyph: 'Aa', title: 'English', sub: 'រៀនភាសាអង់គ្លេស', subLang: 'km' },
  { id: 'xavier', course: 'km', theme: 'temple', glyph: 'ក', title: 'ភាសាខ្មែរ', sub: 'Learn Khmer', subLang: 'en' },
];
const DAILY_GOAL = 20;

const app = document.getElementById('app');
let data;

async function init() {
  const [concepts, script, ui, stories, dialogues, grammar, dialoguesEn] = await Promise.all(
    ['concepts', 'khmer-script', 'ui', 'stories', 'dialogues', 'grammar', 'dialogues-en'].map((f) => fetch(`data/${f}.json`).then((r) => r.json()).catch(() => [])),
  );
  await Promise.all([loadAudioIndex(), loadRecorded(), loadLocalVoices()]);
  data = { ...buildCourses(concepts, script, grammar), concepts, script, ui, stories, dialogues, dialoguesEn, grammar };
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
      h('div.brand', h('div.brand-mark', h('span', 'A'), h('span', { lang: 'km' }, 'ក')), h('div.brand-name', 'BongOun'), h('div.brand-sub', 'Learn together · ', h('span', { lang: 'km' }, 'រៀនជាមួយគ្នា'))),
      h(
        'div.profiles',
        PROFILES.map((p) =>
          h(
            `button.profile-card.t-${p.theme}`,
            { onclick: () => { store.setLast(p.id); dashboard(p); } },
            h('span.p-glyph', { lang: p.course === 'km' ? 'km' : 'en' }, p.glyph),
            h('span.p-text', h('span.p-title', { lang: p.course === 'km' ? 'km' : 'en' }, p.title), h('span.p-sub', { lang: p.subLang }, p.sub)),
            icon('chevron', { size: 20 }),
          ),
        ),
      ),
      h(
        'nav.footer-links',
        h('button.link', { onclick: () => settingsScreen() }, icon('settings', { size: 16 }), h('span', 'Settings')),
        h('button.link', { onclick: backupDialog }, icon('download', { size: 16 }), h('span', 'Backup')),
      ),
    ),
  );
}

// ---------- dashboard ----------
function dashboard(p) {
  setTheme(p.theme);
  const course = data.courses[p.course];
  const lang = course.ui;
  const t = (k) => data.ui[lang][k] || data.ui.en[k] || '';
  const allItems = [...new Set(course.units.flatMap((u) => u.items))];
  const due = allItems.filter((id) => store.isDue(p.id, id)).length;
  const learned = allItems.filter((id) => store.card(p.id, id).box > 0).length;
  const today = store.todayCount(p.id);
  const minutes = Math.max(2, Math.round((Math.min(due, 12) + 5) * 0.4));

  const header = h(
    'header.dash-head',
    h('button.icon-btn.ghost', { onclick: () => { store.setLast(null); home(); }, 'aria-label': 'Switch profile' }, icon('users')),
    h('div.dash-title', { lang: p.course === 'km' ? 'km' : 'en' }, p.title),
    h('div.stat', { title: t('streak') }, icon('flame', { size: 18 }), h('b', String(store.streak(p.id)))),
    slowToggle(),
  );

  const todayCard = h(
    'section.today',
    h(
      'div.today-top',
      h('div', h('div.today-label', { lang }, t('practice')), h('div.today-meta', `${due} to review · ~${minutes} min`)),
      goalRing(today, DAILY_GOAL, t('goal')),
    ),
    h('div.today-progress', h('span', { style: `width:${(learned / allItems.length) * 100}%` })),
    h('div.today-foot', h('span.muted', `${learned} / ${allItems.length} learned`),
      h('button.btn.primary', { onclick: () => startSession(p, null), lang }, icon('play', { size: 16 }), h('span', t('start')))),
  );

  const tool = (ic, label, onclick, opts = {}) => h('button.tool-card', { onclick, ...opts }, h('span.tool-ic', icon(ic, { size: 20 })), h('span', label));
  const weak = weakItems(course, p.id).length;
  const weakTool = tool('refresh', `${t('weak')}${weak ? ` · ${weak}` : ''}`, () => (weak ? startSession(p, 'weak') : null), { lang, disabled: !weak });
  const tools = course.id === 'km'
    ? h('div.tools', tool('book', 'Alphabet', () => alphabet(p)), tool('pencil', t('writing'), () => writing(p)), tool('globe', t('translate'), () => translator(p)), tool('headphones', t('checkTitle'), () => nativeCheck(p)), weakTool)
    : h('div.tools', tool('pencil', t('writing'), () => writing(p), { lang: 'km' }), tool('book', t('grammar'), () => grammarRef(p), { lang: 'km' }), weakTool);

  // Lessons grouped into sections, each row with its progress.
  const current = course.units.findIndex((u) => u.items.some((id) => store.card(p.id, id).box === 0));
  const sections = [];
  course.units.forEach((u, i) => {
    let sec = sections.find((x) => x.name === u.section);
    if (!sec) sections.push((sec = { name: u.section, rows: [] }));
    const total = u.items.length;
    const seen = u.items.filter((id) => store.card(p.id, id).box > 0).length;
    const strong = u.items.filter((id) => store.card(p.id, id).box >= 4).length;
    const state = strong === total ? 'mastered' : i === current ? 'current' : seen ? 'started' : 'fresh';
    const isKmIcon = /^[ក-៿]/.test(u.icon);
    sec.rows.push(
      h(
        `button.lesson.${state}`,
        { onclick: () => startSession(p, i) },
        h('span.lesson-ic', { lang: isKmIcon ? 'km' : 'en' }, u.icon),
        h(
          'span.lesson-body',
          h('span.lesson-title', u.title),
          h('span.lesson-bar', h('span', { style: `width:${((seen + strong) / (2 * total)) * 100}%` })),
        ),
        state === 'mastered' ? h('span.lesson-end.done', icon('check', { size: 18 }))
          : state === 'current' ? h('span.lesson-end.go', { lang }, t('start'))
          : h('span.lesson-end', `${seen}/${total}`),
      ),
    );
  });

  const extraGroup = course.id === 'en' ? [storiesGroup(p, t, lang), dialoguesGroup(p, t)] : dialoguesGroup(p, t);
  show(
    h(
      'div.screen.dash',
      header,
      todayCard,
      tools,
      sections.map((sec) => h('section.lesson-group', h('h3.group-title', sec.name), h('div.lesson-list', sec.rows))),
      extraGroup,
    ),
  );
  document.querySelector('.lesson.current')?.scrollIntoView({ block: 'nearest' });
  window.scrollTo(0, 0);
}

function goalRing(value, goal, label) {
  const pct = Math.min(value / goal, 1);
  const r = 18;
  const c = 2 * Math.PI * r;
  const el = h('div.goal', { title: label, 'aria-label': `${label}: ${value}/${goal}` });
  el.innerHTML = `<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="${r}" class="ring-bg"/><circle cx="22" cy="22" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`;
  el.append(h('span.goal-num', pct >= 1 ? '✓' : `${value}`));
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
      h('div.topbar', h('button.icon-btn.ghost', { onclick: () => dashboard(p), 'aria-label': 'Back' }, icon('back')), h('div.top-title', 'Khmer alphabet'), slowToggle()),

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
  { id: 'trace', icon: 'pencil' },
  { id: 'copy', icon: 'copy' },
  { id: 'memory', icon: 'headphones' },
];

/** Writing sets per course: [{ title, items: [{ g, say: [lang, key], label }] }]. */
function writingSets(course) {
  if (course.id === 'km') {
    const { consonants, subscripts } = data.script;
    return [
      { title: 'ក ខ គ', items: consonants.map((c) => ({ g: c.ch, say: ['km', c.ch], label: c.rom, s: c.s })) },
      { title: 'ខ្ញុំ', items: subscripts.map((w) => ({ g: w.word, say: ['km', w.word], label: `${w.rom} — ${w.en}` })) },
      // Short Khmer words, with their meaning
      {
        title: 'ពាក្យ',
        items: data.concepts
          .filter((c) => c.km && c.cat !== 'phrases' && c.cat !== 'sight' && [...c.km].length <= 6 && !/[\s/?]/.test(c.km))
          .map((c) => ({ g: c.km, say: ['km', c.km], emoji: c.emoji, label: `${c.rom} — ${c.en}` })),
      },
    ];
  }
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const phonicsWords = course.units.filter((u) => u.phonics).flatMap((u) => u.items).map((id) => data.items[id].c);
  return [
    { title: 'A B C', items: [...L].map((x) => ({ g: x, say: ['en', `letter:${x}`] })) },
    { title: 'a b c', items: [...L.toLowerCase()].map((x) => ({ g: x, say: ['en', `letter:${x.toUpperCase()}`] })) },
    { title: 'cat', items: phonicsWords.map((c) => ({ g: c.en.toLowerCase(), say: ['en', c.en], emoji: c.emoji, km: c.km })) },
  ];
}

async function writing(p, state = { set: 0, i: 0, mode: 'trace' }) {
  setTheme(p.theme);
  const course = data.courses[p.course];
  const km = course.id === 'km';
  const lang = course.ui;
  const t = (k) => data.ui[lang][k];
  const font = km ? KHMER_FONT : LATIN_FONT;
  const padOpts = km ? { font, ink: 0.024 } : { font, ink: 0.032, lines: true };
  await document.fonts.load(`400 100px ${font}`).catch(() => {});
  const sets = writingSets(course);
  const bestKey = `learnering:writing:${course.id}`;
  const best = (() => { try { return JSON.parse(localStorage.getItem(bestKey)) || {}; } catch { return {}; } })();
  const starKey = (g) => `${state.mode}:${g}`;
  const modes = km ? [...MODES, { id: 'record', icon: 'record' }] : MODES;

  const tabs = h('div.mode-tabs', { style: `grid-template-columns:repeat(${modes.length},1fr)` });
  const setTabs = h('div.set-tabs');
  const instr = h('div.instruction.center', { lang });
  const strip = h('div.glyph-strip');
  const stage = h('div.stage');
  show(
    h(
      'div.screen.writing',
      h('div.topbar', h('button.icon-btn.ghost', { onclick: () => dashboard(p), 'aria-label': 'Back' }, icon('back')), h('div.top-title', { lang }, t('writing')), slowToggle()),
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
        h('span.mode-icon', icon(m.icon, { size: 20 })), m.id === 'record' ? 'Record' : t(capKey[m.id]))));
    setTabs.replaceChildren(...sets.map((st, j) =>
      h(`button.set-tab${j === state.set ? '.on' : ''}`, { lang: km ? 'km' : 'en', onclick: () => { state.set = j; state.i = 0; render(); } }, st.title)));
    instr.replaceChildren(
      lang === 'km' ? h('button.mini', { onclick: () => speak(modeKey[state.mode]), 'aria-label': 'Repeat' }, icon('volume', { size: 16 })) : '',
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
    result.replaceChildren(h('span.stars', Array.from({ length: 3 }, (_, i) => icon(i < stars ? 'starFill' : 'star', { size: 24 }))));
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
    const nextBtn = h('button.btn', { onclick: next, 'aria-label': 'Next' }, icon('next', { size: 20 }));
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
        const stars = mistakes <= 1 ? 3 : mistakes <= 3 ? 2 : 1;
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
    if (state.mode === 'memory') prompt.append(h('button.speaker.big', { onclick: say, 'aria-label': 'Listen' }, icon('volume', { size: 34 })));
    else prompt.append(h('button.speaker', { onclick: say, 'aria-label': 'Listen' }, icon('volume', { size: 22 })));
    if (canWatch && state.mode !== 'memory') prompt.append(h('button.tool.accent', { onclick: watch, lang }, icon('play', { size: 16 }), h('span', t('watch'))));
    if (x.emoji) prompt.append(h('span.pic.small', x.emoji));
    // The meaning: Khmer for her English words (tap to hear), English for Khmer words.
    if (x.km) prompt.append(h('button.mini.wide', { onclick: () => play('km', x.km) }, icon('volume', { size: 16 }), h('span', { lang: 'km' }, x.km)));
    if (x.label) prompt.append(h('div.write-label', h('span.rom', x.label), x.s ? [' ', seriesBadge(x.s)] : ''));
    if (km && !canWatch && state.mode === 'trace') {
      // No recorded stroke order: show the letter clearly as the example (no guessed animation).
      prompt.append(h('div.model-card', modelCanvas(x.g, { ...padOpts, px: 96 })));
    }

    const buttons = [h('button.btn', { onclick: () => { pad.clear(); result.replaceChildren(); hint.textContent = ''; }, 'aria-label': 'Clear' }, icon('refresh', { size: 20 }))];
    if (!pad.guided) {
      buttons.push(h('button.btn.primary', {
        lang,
        onclick: async () => {
          if (pad.empty) return;
          const score = pad.score();
          const stars = score >= 0.75 ? 3 : score >= 0.55 ? 2 : score >= 0.4 ? 1 : 0;
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
      h('div.write-prompt', h('button.speaker', { onclick: say, 'aria-label': 'Listen' }, icon('volume', { size: 22 })), x.label ? h('span.rom', x.label) : ''),
      pad.el,
      status,
      h(
        'div.row',
        h('button.btn', { onclick: () => pad.clear(), 'aria-label': 'Clear' }, icon('refresh', { size: 20 })),
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
  const out = data.concepts.filter((c) => c.km).map((c) => ({ key: `w:${c.id}`, km: c.km, label: `${c.emoji} ${c.en}`, emoji: c.emoji, en: c.en, rom: c.rom }));
  for (const c of data.script.consonants) out.push({ key: `C:${c.ch}`, km: c.ch, emoji: '🔤', en: `consonant ${c.rom}`, rom: c.rom });
  for (const v of data.script.vowels) {
    out.push({ key: `V1:${v.v}`, km: 'ក' + v.v, emoji: '🔤', en: 'syllable', rom: 'k' + v.r1 });
    out.push({ key: `V2:${v.v}`, km: 'គ' + v.v, emoji: '🔤', en: 'syllable', rom: 'k' + v.r2 });
  }
  for (const s of data.script.subscripts) out.push({ key: `S:${s.word}`, km: s.word, emoji: '🔤', en: s.en, rom: s.rom });
  for (const d of data.dialogues) d.lines.forEach((l, i) => out.push({ key: `D:${d.id}:${i}`, km: l.km, emoji: d.emoji, en: l.en, rom: l.rom }));
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
      h('div.topbar', h('button.icon-btn.ghost', { onclick: () => checkSummary(p, items), 'aria-label': 'Results' }, icon('list')), counter, h('span')),
      h('div.instruction.center', { lang: 'km' }, h('button.mini', { onclick: () => play('km', data.ui.km.checkHelp, { slow: false }), 'aria-label': 'Repeat' }, icon('volume', { size: 16 })), data.ui.km.checkHelp),
      stage,
    ),
  );
  render(false);
  play('km', data.ui.km.checkHelp, { slow: false }).then(() => play('km', items[i].km, { machine: true }));

  function render(speak = true) {
    if (i >= items.length) return checkSummary(p, items);
    const it = items[i];
    const key = `km|${it.km}`;
    counter.textContent = `${i + 1} / ${items.length}`;
    const mark = (v) => {
      store.setCheck(it.key, v);
      i++;
      render();
    };
    // The ✓/✗ judges the computer voice, so always play that one here.
    const machine = (slow = false) => play('km', it.km, { slow, machine: true });

    // 🎙️ Her own voice: tap to record, tap again (or wait 4 s) to stop. It replaces the computer voice.
    const voiceRow = h('div.voice-row');
    const drawVoice = () => {
      const has = Boolean(nativeVoice('km', it.km));
      voiceRow.replaceChildren(
        h('button.mic.sm', { onclick: startRecording, 'aria-label': 'Record my voice' }, icon('mic', { size: 26 })),
        has ? h('button.speaker', { onclick: () => play('km', it.km), 'aria-label': 'My recording' }, icon('play', { size: 20 })) : '',
        has ? h('button.mini', { onclick: async () => { await deleteClip(key); setLocalVoice(key, null); drawVoice(); }, 'aria-label': 'Delete recording' }, icon('trash', { size: 16 })) : '',
        h('div.voice-hint', { lang: 'km' }, has ? '✓ ' : '', data.ui.km.recordHint),
      );
    };
    async function startRecording() {
      stop();
      let session;
      try {
        session = await record({ maxMs: 4000 });
      } catch {
        voiceRow.querySelector('.voice-hint').textContent = 'Microphone not available';
        return;
      }
      const mic = voiceRow.querySelector('.mic');
      mic.classList.add('recording');
      mic.replaceChildren(icon('stop', { size: 24 }));
      mic.onclick = () => session.stop();
      const blob = await session.done;
      if (blob.size > 1000) {
        await saveClip(key, blob);
        setLocalVoice(key, blob);
      }
      drawVoice();
      play('km', it.km); // play it back
    }
    drawVoice();

    stage.replaceChildren(
      h('div.check-card', h('div.big-emoji', it.emoji), h('div.khmer-big', { lang: 'km' }, it.km), h('div.muted', it.en)),
      h('div.row', h('button.speaker.big', { onclick: () => machine(), 'aria-label': 'Computer voice' }, icon('volume', { size: 34 })), h('button.speaker.slow', { onclick: () => machine(true), 'aria-label': 'Slow' }, icon('slow', { size: 20 }), h('small', '0.7×'))),
      h('div.verdict', h('button.vbtn.bad', { onclick: () => mark('bad'), 'aria-label': 'Wrong' }, icon('x', { size: 36 })), h('button.vbtn.ok', { onclick: () => mark('ok'), 'aria-label': 'Correct' }, icon('check', { size: 36 }))),
      voiceRow,
      i > 0 ? h('button.link', { onclick: () => { i--; render(); } }, '← back') : '',
    );
    if (speak) machine();
  }
}

async function checkSummary(p, items) {
  setTheme(p.theme);
  const voiceCount = Object.keys(await allClips()).length;
  const verdicts = store.checks();
  const bad = items.filter((it) => verdicts[it.key] === 'bad');
  const done = items.filter((it) => verdicts[it.key]).length;
  const report = bad.map((it) => `${it.key}\t${it.km}\t${it.rom}\t${it.en}`).join('\n');
  show(
    h(
      'div.screen',
      h('div.topbar', h('button.icon-btn.ghost', { onclick: () => dashboard(p), 'aria-label': 'Back' }, icon('back')), h('div.top-title', 'Native check'), h('span')),
      h('section.card', h('h3', `${done} / ${items.length} checked · ${bad.length} flagged`), h('p.muted', data.ui.en.checkHelp),
        h('div.row', h('button.btn.primary', { onclick: () => nativeCheck(p) }, done < items.length ? 'Continue checking' : 'Review again'),
          done ? h('button.btn', { onclick: () => { if (confirm('Clear all verdicts?')) { Object.keys(verdicts).forEach((k) => store.setCheck(k, undefined)); checkSummary(p, items); } } }, 'Reset') : null)),
      h(
        'section.card',
        h('h3', `${voiceCount} voice recording${voiceCount === 1 ? '' : 's'} on this phone`),
        h('p.muted', 'Recordings play instead of the computer voice on this phone right away. To put them on both phones: download the file, send it to your Mac (AirDrop), save it in the project\'s “recordings” folder and ask Claude to import it.'),
        voiceCount ? h('button.btn.primary.wide', { onclick: async (e) => { const btn = e.currentTarget; const n = await exportClips(); btn.textContent = `Downloaded ${n} ✓`; } }, icon('download', { size: 18 }), h('span', 'Download recordings')) : '',
      ),
      bad.length
        ? h(
            'section.card',
            h('h3', 'Flagged — send this list to Claude'),
            h('ul.flag-list', bad.map((it) => h('li', h('button.mini', { onclick: () => play('km', it.km), 'aria-label': 'Listen' }, icon('volume', { size: 16 })), ' ', h('b', { lang: 'km' }, it.km), ` ${it.rom} — ${it.en}`))),
            h('button.btn.wide', { onclick: (e) => { navigator.clipboard?.writeText(report); e.currentTarget.textContent = 'Copied ✓'; } }, 'Copy list'),
          )
        : null,
    ),
  );
}

// ---------- reading stories (her) ----------
const STORY_KEY = 'learnering:stories';
const loadJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const tokens = (sentence) => sentence.split(/\s+/).filter(Boolean);
const bare = (w) => w.toLowerCase().replace(/[^a-z']/g, '');

/** The vocabulary item for a word in a story (to play it and to know whether it has been learned). */
function wordItem(w) {
  const c = data.concepts.find((x) => x.en.toLowerCase() === bare(w));
  return c ? { audio: c.en, id: `w:${c.id}` } : null;
}

/** Share of a story's words she has already met (stories unlock at 80%). */
function storyReadiness(p, story) {
  const words = [...new Set(story.sentences.flatMap((s) => tokens(s.en).map(bare)))];
  const known = words.filter((w) => { const it = wordItem(w); return !it || store.card(p.id, it.id).box > 0; }).length;
  return known / words.length;
}

function storiesGroup(p, t, lang) {
  if (!data.stories.length) return '';
  const done = loadJSON(STORY_KEY);
  return h(
    'section.lesson-group',
    h('h3.group-title', { lang }, t('stories')),
    h('div.lesson-list', data.stories.map((st) => {
      const ready = storyReadiness(p, st);
      const open = ready >= 0.8;
      const stars = done[st.id] || 0;
      return h(
        `button.lesson.${stars ? 'mastered' : open ? 'started' : 'fresh'}`,
        { onclick: () => open && storyReader(p, st), disabled: !open },
        h('span.lesson-ic', st.emoji),
        h('span.lesson-body', h('span.lesson-title', st.title), h('span.lesson-bar', h('span', { style: `width:${Math.min(ready / 0.8, 1) * 100}%` }))),
        open
          ? (stars ? h('span.lesson-end.done', Array.from({ length: stars }, () => icon('starFill', { size: 14 }))) : h('span.lesson-end.go', { lang }, t('start')))
          : h('span.lesson-end', icon('lock', { size: 16 })),
      );
    })),
  );
}

function storyReader(p, st) {
  setTheme(p.theme);
  const course = data.courses[p.course];
  const lang = course.ui;
  const t = (k) => data.ui[lang][k] || data.ui.en[k];
  let running = false;

  const lines = st.sentences.map((s) => {
    const spans = tokens(s.en).map((w) => {
      const it = wordItem(w);
      return h('button.rw', { onclick: () => it && play('en', it.audio) }, w);
    });
    const row = h(
      'div.read-line',
      h('button.tool', { onclick: () => readLine(s, spans), 'aria-label': 'Read' }, icon('volume', { size: 18 })),
      h('div.read-text', h('div.read-words', spans), h('button.read-km', { onclick: () => play('km', s.km), lang: 'km' }, icon('volume', { size: 14 }), h('span', s.km))),
    );
    return { s, spans, row };
  });

  async function readLine(s, spans) {
    spans.forEach((x) => x.classList.remove('lit'));
    await playTimed('en', s.en, { onWord: (i) => spans.forEach((x, k) => x.classList.toggle('lit', k === i)) });
  }

  async function readAll() {
    if (running) { running = false; stop(); return; }
    running = true;
    for (const l of lines) {
      if (!running) break;
      l.row.classList.add('active');
      l.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await readLine(l.s, l.spans);
      l.row.classList.remove('active');
      await new Promise((r) => setTimeout(r, 400));
    }
    running = false;
  }

  show(
    h(
      'div.screen.reader',
      h('div.topbar', h('button.icon-btn.ghost', { onclick: () => { running = false; dashboard(p); }, 'aria-label': 'Back' }, icon('back')), h('div.top-title', st.title), slowToggle()),
      h('div.story-head', h('div.pic', st.emoji), h('h2.story-title', st.title), h('button.read-km', { onclick: () => play('km', st.titleKm), lang: 'km' }, icon('volume', { size: 14 }), h('span', st.titleKm))),
      h('div.read-list', lines.map((l) => l.row)),
      h('div.foot.row', h('button.btn', { onclick: readAll, lang }, icon('play', { size: 16 }), h('span', t('readToMe'))), h('button.btn.primary', { onclick: () => storyQuiz(p, st), lang }, h('span', t('quiz')), icon('next', { size: 18 }))),
    ),
  );
  setTimeout(readAll, 500);
}

/** Hear a sentence of the story, find it written (3 rounds). */
function storyQuiz(p, st) {
  const lang = data.courses[p.course].ui;
  const t = (k) => data.ui[lang][k] || data.ui.en[k];
  const rounds = [...st.sentences].sort(() => Math.random() - 0.5).slice(0, 3);
  let i = 0;
  let right = 0;
  const stage = h('main.stage');
  show(h('div.screen.session', h('header.s-head', h('button.icon-btn.ghost', { onclick: () => storyReader(p, st), 'aria-label': 'Close' }, icon('close')), h('div.progress', h('div.bar'))), stage));
  const bar = document.querySelector('.s-head .bar');
  const round = () => {
    if (i >= rounds.length) {
      const stars = right === rounds.length ? 3 : right >= 2 ? 2 : 1;
      const done = loadJSON(STORY_KEY);
      done[st.id] = Math.max(done[st.id] || 0, stars);
      saveJSON(STORY_KEY, done);
      store.recordSession(p.id, rounds.length);
      stage.replaceChildren(
        h('div.done-badge', icon('check', { size: 44 })),
        h('div.done-stars', Array.from({ length: 3 }, (_, k) => icon(k < stars ? 'starFill' : 'star', { size: 30 }))),
        h('div.foot', h('button.btn.primary.wide', { onclick: () => dashboard(p), lang }, t('next'), icon('next', { size: 18 }))),
      );
      tone(true);
      return;
    }
    bar.style.width = `${(i / rounds.length) * 100}%`;
    const target = rounds[i];
    const opts = [target, ...st.sentences.filter((s) => s !== target).sort(() => Math.random() - 0.5).slice(0, 2)].sort(() => Math.random() - 0.5);
    const grid = h('div.options.one', opts.map((s) => h('button.opt.sentence-opt', {
      onclick: (e) => {
        const ok = s === target;
        if (ok) right++;
        e.currentTarget.classList.add(ok ? 'right' : 'wrong');
        grid.querySelectorAll('.opt').forEach((b) => (b.disabled = true));
        tone(ok);
        setTimeout(() => { i++; round(); }, 1100);
      },
    }, s.en)));
    stage.replaceChildren(
      h('p.instruction', { lang }, lang === 'km' ? h('button.mini', { onclick: () => play('km', data.ui.km.storyQuiz, { slow: false }) }, icon('volume', { size: 16 })) : '', h('span', t('storyQuiz'))),
      h('button.speaker.big', { onclick: () => play('en', target.en), 'aria-label': 'Listen' }, icon('volume', { size: 34 })),
      grid,
    );
    (i === 0 && lang === 'km' ? play('km', data.ui.km.storyQuiz, { slow: false }) : Promise.resolve()).then(() => play('en', target.en));
  };
  round();
}

// ---------- grammar reference (her) ----------
function grammarRef(p) {
  setTheme(p.theme);
  const lang = data.courses[p.course].ui;
  const t = (k) => data.ui[lang][k] || data.ui.en[k];
  show(
    h(
      'div.screen',
      h('div.topbar', h('button.icon-btn.ghost', { onclick: () => dashboard(p), 'aria-label': 'Back' }, icon('back')), h('div.top-title', { lang }, t('grammar')), slowToggle()),
      data.grammar.map((g) =>
        h(
          'section.card.grammar-card',
          h('h3', { onclick: () => play('km', g.explainKm, { slow: false }) }, g.title),
          h('button.explain', { onclick: () => play('km', g.explainKm, { slow: false }), lang: 'km' }, h('span.explain-ic', icon('volume', { size: 20 })), h('span', g.explainKm)),
          h('div.examples', g.examples.map((en, i) => h('button.example-row', { onclick: () => play('en', en) }, icon('volume', { size: 16 }), h('span.ex-en', en), h('span.ex-km', { lang: 'km' }, g.examplesKm[i])))),
        ),
      ),
    ),
  );
}

// ---------- conversations ----------
const DIALOGUE_KEY = 'learnering:dialogues';

const dialogueList = (p) => (p.course === 'en' ? data.dialoguesEn : data.dialogues);

function dialoguesGroup(p, t) {
  const list = dialogueList(p);
  if (!list.length) return '';
  const done = loadJSON(DIALOGUE_KEY);
  return h(
    'section.lesson-group',
    h('h3.group-title', { lang: data.courses[p.course].ui }, t('conversations')),
    h('div.lesson-list', list.map((d) => {
      const stars = done[d.id] || 0;
      return h(
        `button.lesson.${stars ? 'mastered' : 'started'}`,
        { onclick: () => dialogueScreen(p, d) },
        h('span.lesson-ic', d.emoji),
        h('span.lesson-body', h('span.lesson-title', d.title), h('span.note', `${d.lines.length} lines`)),
        stars ? h('span.lesson-end.done', Array.from({ length: stars }, () => icon('starFill', { size: 14 }))) : h('span.lesson-end.go', t('start')),
      );
    })),
  );
}

// A dialogue line: for her the English is the main text (Khmer meaning below); for Xavier the Khmer is.
const lineSay = (p, l) => (p.course === 'en' ? ['en', l.en] : ['km', l.km]);

function dialogueScreen(p, d) {
  setTheme(p.theme);
  const english = p.course === 'en';
  const lang = data.courses[p.course].ui;
  const t = (k) => data.ui[lang][k] || data.ui.en[k];
  let showRom = true;
  let showEn = true;
  let running = false;
  const bubbles = d.lines.map((l) => {
    const rom = english ? h('div.b-en', { lang: 'km' }, l.km) : h('div.b-rom', l.rom);
    const en = english ? h('span') : h('div.b-en', l.en);
    const main = english ? h('div.b-main.hand', l.en) : h('div.b-km', { lang: 'km' }, l.km);
    const b = h(`button.bubble.${l.speaker === 'A' ? 'me' : 'them'}`, { onclick: () => play(...lineSay(p, l)) }, main, rom, en);
    return { l, b, rom, en };
  });
  const toggles = () => bubbles.forEach((x) => { x.rom.hidden = !showRom; x.en.hidden = !showEn; });
  async function playAll() {
    if (running) { running = false; stop(); return; }
    running = true;
    for (const x of bubbles) {
      if (!running) break;
      x.b.classList.add('active');
      x.b.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await play(...lineSay(p, x.l));
      x.b.classList.remove('active');
      await new Promise((r) => setTimeout(r, 350));
    }
    running = false;
  }
  const chip = (label, get, set) => {
    const b = h('button.set-tab', { onclick: () => { set(!get()); b.classList.toggle('on', get()); toggles(); } }, label);
    b.classList.toggle('on', get());
    return b;
  };
  show(
    h(
      'div.screen.dialogue',
      h('div.topbar', h('button.icon-btn.ghost', { onclick: () => { running = false; dashboard(p); }, 'aria-label': 'Back' }, icon('back')), h('div.top-title', d.title), slowToggle()),
      english
        ? h('div.set-tabs', chip('ខ្មែរ', () => showRom, (v) => { showRom = v; }))
        : h('div.set-tabs', chip('Romanization', () => showRom, (v) => { showRom = v; }), chip('English', () => showEn, (v) => { showEn = v; })),
      h('div.chat', bubbles.map((x) => x.b)),
      h('div.foot.row', h('button.btn', { onclick: playAll }, icon('play', { size: 16 }), h('span', english ? '' : 'Play all')), h('button.btn.primary', { onclick: () => dialogueQuiz(p, d), lang }, h('span', t('quiz')), icon('next', { size: 18 }))),
    ),
  );
}

/** For each of your lines: hear what was said before, choose your reply. */
function dialogueQuiz(p, d) {
  const english = p.course === 'en';
  const lang = data.courses[p.course].ui;
  const t = (k) => data.ui[lang][k] || data.ui.en[k];
  const mine = d.lines.map((l, i) => ({ l, i })).filter((x) => x.l.speaker === 'A');
  let k = 0;
  let right = 0;
  const stage = h('main.stage');
  show(h('div.screen.session', h('header.s-head', h('button.icon-btn.ghost', { onclick: () => dialogueScreen(p, d), 'aria-label': 'Close' }, icon('close')), h('div.progress', h('div.bar'))), stage));
  const bar = document.querySelector('.s-head .bar');
  const round = () => {
    if (k >= mine.length) {
      const stars = right === mine.length ? 3 : right >= mine.length - 1 ? 2 : 1;
      const done = loadJSON(DIALOGUE_KEY);
      done[d.id] = Math.max(done[d.id] || 0, stars);
      saveJSON(DIALOGUE_KEY, done);
      store.recordSession(p.id, mine.length);
      stage.replaceChildren(
        h('div.done-badge', icon('check', { size: 44 })),
        h('div.done-stars', Array.from({ length: 3 }, (_, n) => icon(n < stars ? 'starFill' : 'star', { size: 30 }))),
        h('div.foot', h('button.btn.primary.wide', { onclick: () => dialogueScreen(p, d) }, 'Done', icon('next', { size: 18 }))),
      );
      tone(true);
      return;
    }
    bar.style.width = `${(k / mine.length) * 100}%`;
    const { l, i } = mine[k];
    const before = d.lines[i - 1];
    const others = mine.filter((x) => x.l !== l).map((x) => x.l).sort(() => Math.random() - 0.5).slice(0, 2);
    const opts = [l, ...others].sort(() => Math.random() - 0.5);
    const grid = h('div.options.one', opts.map((o) => h('button.opt.sentence-opt', {
      onclick: (e) => {
        const ok = o === l;
        if (ok) right++;
        e.currentTarget.classList.add(ok ? 'right' : 'wrong');
        grid.querySelectorAll('.opt').forEach((b) => (b.disabled = true));
        tone(ok);
        play(...lineSay(p, l));
        setTimeout(() => { k++; round(); }, 1800);
      },
    }, english ? h('span.hand', o.en) : [h('span', { lang: 'km' }, o.km), h('small.opt-rom', o.rom)])));
    stage.replaceChildren(
      h('p.instruction', { lang }, english ? h('button.mini', { onclick: () => play('km', data.ui.km.dialogueQuiz, { slow: false }) }, icon('volume', { size: 16 })) : '', h('span', t('dialogueQuiz'))),
      before
        ? h('button.bubble.them', { onclick: () => play(...lineSay(p, before)) }, english ? h('div.b-main.hand', before.en) : h('div.b-km', { lang: 'km' }, before.km), h('div.b-en', { lang: english ? 'km' : 'en' }, english ? before.km : before.en))
        : h('div.note', { lang: english ? 'km' : 'en' }, english ? l.km : `Start the conversation: “${l.en}”`),
      grid,
    );
    if (before) play(...lineSay(p, before));
    else if (english) play('km', l.km);
  };
  round();
}

// ---------- settings: Gemini key ----------
function settingsScreen(back = home) {
  setTheme('');
  const input = h('input.key-input', {
    type: 'password',
    placeholder: hasGemini() ? 'Paste a new key to replace the current one' : 'Paste your Gemini API key',
    autocomplete: 'off',
    spellcheck: false,
  });
  const status = h('div.key-status', hasGemini() ? `✓ Connected — model ${geminiModel()}` : 'Not connected');
  const connect = h('button.btn.primary', {
    onclick: async () => {
      const key = input.value.trim();
      if (!key) return;
      connect.disabled = true;
      status.textContent = 'Checking…';
      try {
        const model = await connectGemini(key);
        input.value = '';
        status.textContent = `✓ Connected — model ${model}`;
      } catch (err) {
        status.textContent = `✗ ${err.message}`;
      }
      connect.disabled = false;
    },
  }, hasGemini() ? 'Replace key' : 'Connect');
  show(
    h(
      'div.screen',
      h('div.topbar', h('button.icon-btn.ghost', { onclick: () => back(), 'aria-label': 'Back' }, icon('back')), h('div.top-title', 'Settings'), h('span')),
      h(
        'section.card',
        h('h3', 'Google Gemini'),
        h('p.muted', 'Turns on the 🎤 “say it” speaking exercise and the 🌐 Khmer translator. Get a free key at ',
          h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'),
          ', then paste it here — on each phone. The key stays on this phone only.'),
        input,
        h('div.row.start', connect, hasGemini() ? h('button.btn', { onclick: () => { forgetGemini(); settingsScreen(back); } }, 'Remove key') : ''),
        status,
        h('p.muted.small', 'Privacy: on the free tier Google may use what is sent (her voice clips, your sentences) to improve its products. A paid key (billing enabled, a few cents a month) avoids that.'),
      ),
    ),
  );
}

// ---------- translator (Gemini): any sentence → Khmer with a word-by-word breakdown ----------
function translator(p) {
  setTheme(p.theme);
  if (!hasGemini()) return settingsScreen(() => translator(p));
  const HIST = 'learnering:translations';
  const history = (() => { try { return JSON.parse(localStorage.getItem(HIST)) || []; } catch { return []; } })();
  const input = h('textarea.translate-input', { rows: 3, placeholder: 'English or French… e.g. “Where is the market?”' });
  const out = h('div');
  const go = h('button.btn.primary.wide', {
    onclick: async () => {
      const text = input.value.trim();
      if (!text) return;
      // Asked before? Reuse it (free and instant).
      const cached = history.find((x) => x.text.trim().toLowerCase() === text.toLowerCase());
      if (cached) return out.replaceChildren(translationCard(text, cached.r));
      go.disabled = true;
      out.replaceChildren(h('p.muted.center-text', '…'));
      try {
        const r = await translateToKhmer(text);
        history.unshift({ text, r });
        try { localStorage.setItem(HIST, JSON.stringify(history.slice(0, 30))); } catch { /* ignore */ }
        out.replaceChildren(translationCard(text, r));
      } catch (err) {
        out.replaceChildren(h('p.muted', `✗ ${err.message}`));
      }
      go.disabled = false;
    },
  }, icon('globe', { size: 18 }), h('span', 'Translate to Khmer'));
  show(
    h(
      'div.screen',
      h('div.topbar', h('button.icon-btn.ghost', { onclick: () => dashboard(p), 'aria-label': 'Back' }, icon('back')), h('div.top-title', 'Translate'), h('button.icon-btn.ghost', { onclick: () => settingsScreen(() => translator(p)), 'aria-label': 'Settings' }, icon('settings'))),
      input,
      go,
      out,
      history.length ? h('h3.section', 'Recent') : '',
      history.slice(0, 30).map(({ text, r }) => h('details.history', h('summary', h('span', { lang: 'km' }, r.khmer), h('span.muted', ` — ${text}`)), translationCard(text, r))),
    ),
  );
}

function translationCard(text, r) {
  // Play a word when we happen to have audio for it (known vocabulary); new sentences have no audio.
  const known = new Set(data.concepts.map((c) => c.km));
  const wordChip = (w) =>
    h('div.tw', h('div', { lang: 'km' }, w.khmer, known.has(w.khmer) ? h('button.mini', { onclick: () => play('km', w.khmer), 'aria-label': 'Listen' }, icon('volume', { size: 14 })) : ''), h('div.rom', w.romanization), h('div.muted.small', w.english));
  return h(
    'section.card.translation',
    h('div.muted.small', text),
    h('div.khmer-big', { lang: 'km' }, r.khmer),
    h('div.rom', r.romanization),
    h('div.tw-row', (r.words || []).map(wordChip)),
    r.notes ? h('p.muted', r.notes) : '',
    (r.examples || []).length ? h('div', h('h3', 'Examples'), r.examples.map((e) => h('div.example-line', h('span', { lang: 'km' }, e.khmer), h('span.rom', ` ${e.romanization}`), h('div.muted.small', e.english)))) : '',
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
  }, icon('slow', { size: 20 }));
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
