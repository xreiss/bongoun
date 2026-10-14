// App shell: profile picker, course path, Khmer alphabet reference, native-speaker check.

import { h } from './dom.js';
import { loadAudioIndex, play, audioSettings, stop } from './audio.js';
import * as store from './store.js';
import { buildCourses } from './courses.js';
import { runSession, seriesBadge } from './session.js';

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
  await loadAudioIndex();
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
          h('button.chip', { onclick: () => nativeCheck(p) }, '🎧 ', t('checkTitle')),
        )
      : null,
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
