// App shell: profile picker, course dashboard, Khmer alphabet reference.

import { h } from './dom.js';
import { loadAudioIndex, play, audioSettings, stop } from './audio.js';
import * as store from './store.js';
import { buildCourses } from './courses.js';
import { runSession, seriesBadge } from './session.js';

const PROFILES = [
  { id: 'her', course: 'en', flag: '🇬🇧', title: 'English', sub: 'រៀនភាសាអង់គ្លេស', subLang: 'km' },
  { id: 'xavier', course: 'km', flag: '🇰🇭', title: 'ភាសាខ្មែរ', sub: 'Learn Khmer — Xavier', subLang: 'en' },
];

const app = document.getElementById('app');
let data;

async function init() {
  const [concepts, script, ui] = await Promise.all(
    ['concepts', 'khmer-script', 'ui'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())),
  );
  await loadAudioIndex();
  data = { ...buildCourses(concepts, script), script, ui };
  const last = PROFILES.find((p) => p.id === store.lastProfile());
  last ? dashboard(last) : home();
}

// ---------- screens ----------
function home() {
  stop();
  app.replaceChildren(
    h(
      'div.screen.home',
      h('h1', 'BongOun'),
      h(
        'div.profiles',
        PROFILES.map((p) =>
          h(
            'button.profile-card',
            { onclick: () => { store.setLast(p.id); dashboard(p); } },
            h('span.flag', p.flag),
            h('span.p-title', { lang: p.course === 'km' ? 'km' : 'en' }, p.title),
            h('span.p-sub', { lang: p.subLang }, p.sub),
          ),
        ),
      ),
      h('div.footer', h('button.link', { onclick: backupDialog }, 'Backup / restore progress')),
    ),
  );
}

function dashboard(p) {
  stop();
  const course = data.courses[p.course];
  const kmUI = course.ui === 'km';
  const t = (k) => data.ui[course.ui][k];
  const now = Date.now();
  const allItems = course.units.flatMap((u) => u.items);
  const due = allItems.filter((id) => { const c = store.card(p.id, id); return c.box > 0 && c.due <= now; }).length;
  const streak = store.streak(p.id);

  const top = h(
    'div.topbar',
    h('button.icon-btn', { onclick: () => { store.setLast(null); home(); }, 'aria-label': 'Switch profile' }, '⇄'),
    h('div.streak', '🔥 ', String(streak)),
    slowToggle(),
  );

  const nextUnit = course.units.findIndex((u) => u.items.some((id) => store.card(p.id, id).box === 0));
  const practice = h(
    'button.btn.primary.hero',
    { onclick: () => startSession(p, null), lang: course.ui },
    h('span.hero-icon', '▶'),
    h('span', t('practice')),
    due ? h('span.pill', String(due)) : null,
  );

  const units = h(
    'div.units',
    course.units.map((u, i) => {
      const total = u.items.length;
      const seen = u.items.filter((id) => store.card(p.id, id).box > 0).length;
      const strong = u.items.filter((id) => store.card(p.id, id).box >= 4).length;
      return h(
        `button.unit${i === nextUnit ? '.current' : ''}${seen === 0 && i > nextUnit ? '.fresh' : ''}`,
        { onclick: () => startSession(p, i) },
        h('span.unit-icon', { lang: /^[ក-៿]/.test(u.icon) ? 'km' : 'en' }, u.icon),
        h(
          'span.unit-body',
          h('span.unit-title', u.title),
          h('span.unit-bar', h('span.seen', { style: `width:${(seen / total) * 100}%` }), h('span.strong', { style: `width:${(strong / total) * 100}%` })),
        ),
        h('span.unit-count', strong === total ? '⭐' : `${seen}/${total}`),
      );
    }),
  );

  const extras = course.id === 'km'
    ? h('button.btn.wide', { onclick: () => alphabet(p) }, h('span', { lang: 'km' }, 'ក ខ គ'), '  Alphabet reference')
    : null;

  app.replaceChildren(
    h('div.screen', top, h('div.welcome', { lang: course.ui }, t('welcome')), practice, extras, h('h3', { lang: course.ui }, t('lessons')), units),
  );
  if (kmUI) setTimeout(() => play('km', data.ui.km.welcome, { slow: false }), 300);
}

function startSession(p, unitIdx) {
  const course = data.courses[p.course];
  app.replaceChildren();
  const root = h('div.screen.session');
  app.append(root);
  runSession(root, { course, items: data.items, ui: data.ui, pid: p.id, unitIdx, onExit: () => dashboard(p) });
}

function alphabet(p) {
  const { consonants, vowels, subscripts, seriesDemo } = data.script;
  const cell = (c) =>
    h(`button.kcell.s${c.s === 1 ? 'A' : 'O'}`, { onclick: () => play('km', c.ch) }, h('span.kch', { lang: 'km' }, c.ch), h('span.krom', c.rom));
  app.replaceChildren(
    h(
      'div.screen.alphabet',
      h('div.topbar', h('button.icon-btn', { onclick: () => dashboard(p) }, '←'), h('div', 'Khmer alphabet'), slowToggle()),

      h('h3', 'The golden rule: two series'),
      h('p.muted', 'Every consonant belongs to series A (high voice, inherent “â”) or series O (low voice, inherent “ô”). The same vowel sign is read differently depending on the series. Tap to compare:'),
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

      h('h3', '33 consonants ', seriesBadge(1), ' ', seriesBadge(2)),
      h('div.kgrid', consonants.map(cell)),

      h('h3', 'Dependent vowels'),
      h('p.muted', 'Left: with a series-A consonant (ក). Right: with a series-O consonant (គ).'),
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

      h('h3', 'Subscripts (ជើងអក្សរ — “feet”)'),
      h('p.muted', 'A second consonant written under the first, with no vowel between them. Tap a word to hear it.'),
      subscripts.map((s) =>
        h(
          'div.sub-card',
          h('button.sub-word', { onclick: () => play('km', s.word) }, h('span', { lang: 'km' }, s.word), h('span.krom', ` ${s.rom} — ${s.en}`)),
          h('ul', s.parts.map(([g, d]) => h('li', h('b', { lang: 'km' }, g), ' ', d))),
        ),
      ),
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
