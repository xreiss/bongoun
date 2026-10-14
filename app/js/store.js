// Per-profile progress, kept in localStorage. Export/import lets you back it up.

const KEY = 'learnering:v1';
const DAY = 86400000;
// Interval (ms) applied when an item reaches a given box.
const INTERVALS = [0, 0, 1 * DAY, 2 * DAY, 4 * DAY, 8 * DAY, 16 * DAY, 32 * DAY, 64 * DAY];
export const MAX_BOX = INTERVALS.length - 1;

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
  return profile(pid).srs[itemId] || { box: 0, due: 0, right: 0, wrong: 0 };
}

export function grade(pid, itemId, ok) {
  const p = profile(pid);
  const c = { ...card(pid, itemId) };
  if (ok) {
    c.box = Math.min(c.box + 1, MAX_BOX);
    c.right++;
  } else {
    c.box = Math.max(1, c.box - 1);
    c.wrong++;
  }
  c.due = Date.now() + INTERVALS[c.box];
  p.srs[itemId] = c;
  save();
  return c;
}

/** Mark an item as introduced (box 1, due now). */
export function introduce(pid, itemId) {
  const p = profile(pid);
  if (!p.srs[itemId]) p.srs[itemId] = { box: 1, due: Date.now(), right: 0, wrong: 0 };
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
