// Per-profile progress, kept in localStorage. Export/import lets you back it up.

const KEY = 'learnering:v1';
const DAY = 86400000;
const MIN = 60000;
// "box" is the memory level (it picks how hard the exercise is); the schedule itself is SM-2 style:
// each card has an interval in days and an ease that grows when it's easy and shrinks after lapses.
export const MAX_BOX = 8;
const LEGACY_DAYS = [0, 0, 1, 2, 4, 8, 16, 32, 64]; // intervals of the old fixed-box schedule
const START_EASE = 2.3;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;

let state = load();

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { profiles: {}, last: null };
  } catch {
    return { profiles: {}, last: null };
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode) — progress lives in memory only */
  }
}

export function profile(id) {
  state.profiles[id] ||= { srs: {}, days: {}, streak: 0, lastDay: null };
  return state.profiles[id];
}

export function setLast(id) {
  state.last = id;
  save();
}
export const lastProfile = () => state.last;

export function card(pid, itemId) {
  const c = profile(pid).srs[itemId];
  if (!c) return { box: 0, due: 0, right: 0, wrong: 0, ease: START_EASE, ivl: 0, lapses: 0 };
  // Cards saved by the old schedule have no interval/ease yet.
  return { ease: START_EASE, ivl: LEGACY_DAYS[c.box] || 0, lapses: 0, ...c };
}

/** A small random spread so cards learned together don't all come back on the same day. */
const fuzz = (days) => (days < 3 ? days : days * (0.92 + Math.random() * 0.16));

/**
 * Record an answer. hard = right but with effort (a hint, stroke mistakes, "almost" pronunciation):
 * the interval grows less and the card gets a little harder.
 */
export function grade(pid, itemId, ok, { hard = false } = {}) {
  const p = profile(pid);
  const c = card(pid, itemId);
  if (ok) {
    c.right++;
    c.box = Math.min(c.box + 1, MAX_BOX);
    if (c.ivl < 1) c.ivl = 1; // learned today → see it again tomorrow
    else if (c.ivl < 3) c.ivl = hard ? c.ivl + 1 : 3;
    else c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * (hard ? 1.2 : c.ease))); // always grows a little
    c.ease = Math.min(MAX_EASE, Math.max(MIN_EASE, c.ease + (hard ? -0.15 : 0.05)));
    c.due = Date.now() + fuzz(c.ivl) * DAY;
  } else {
    // Lapse: easier exercise next time, and back tomorrow (it is also repeated within this session).
    c.wrong++;
    c.lapses++;
    c.box = Math.max(1, c.box - 1);
    c.ease = Math.max(MIN_EASE, c.ease - 0.2);
    c.ivl = c.ivl >= 3 ? Math.max(1, Math.round(c.ivl * 0.3)) : 0;
    c.due = Date.now() + (c.ivl ? c.ivl * DAY : 10 * MIN);
  }
  p.srs[itemId] = c;
  save();
  return c;
}

/** Cards due now (or within the next few minutes). */
export const isDue = (pid, itemId) => {
  const c = card(pid, itemId);
  return c.box > 0 && c.due <= Date.now() + 5 * MIN;
};

/** Mark an item as introduced (box 1, due now). */
export function introduce(pid, itemId) {
  const p = profile(pid);
  if (!p.srs[itemId]) p.srs[itemId] = { box: 1, due: Date.now(), right: 0, wrong: 0, ease: START_EASE, ivl: 0, lapses: 0 };
  save();
}

const today = () => new Date().toISOString().slice(0, 10);

export function recordSession(pid, answered) {
  const p = profile(pid);
  const d = today();
  if (p.lastDay !== d) {
    const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    p.streak = p.lastDay === yesterday ? p.streak + 1 : 1;
    p.lastDay = d;
  }
  p.days[d] = (p.days[d] || 0) + answered;
  save();
}

export function streak(pid) {
  const p = profile(pid);
  const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  return p.lastDay === today() || p.lastDay === yesterday ? p.streak : 0;
}

export function exportData() {
  return JSON.stringify(state);
}

export function importData(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed.profiles !== 'object') throw new Error('Invalid backup');
  state = parsed;
  save();
}

// ---------- native-speaker content check ----------

/** Verdicts from the native check screen: { key: 'ok' | 'bad' }. */
export function checks() {
  state.checks ||= {};
  return state.checks;
}

export function setCheck(key, verdict) {
  checks()[key] = verdict;
  save();
}

export function todayCount(pid) {
  return profile(pid).days[today()] || 0;
}
