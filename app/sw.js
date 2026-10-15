// Offline support: app shell is precached; audio is cached the first time it plays.
const VERSION = 'v11';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icon.svg',
  'js/main.js', 'js/audio.js', 'js/store.js', 'js/courses.js', 'js/session.js', 'js/trace.js', 'js/strokes.js', 'js/voice.js', 'js/gemini.js', 'js/dom.js',
  'data/concepts.json', 'data/khmer-script.json', 'data/ui.json', 'data/audio-index.json', 'data/khmer-strokes.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(`shell-${VERSION}`).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== `shell-${VERSION}`).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isAudio = url.pathname.includes('/audio/');
  const isFont = url.hostname.includes('fonts.g');
  if (isAudio || isFont) {
    // Cache first: these files never change (audio names are content hashes).
    e.respondWith(
      caches.open(isAudio ? 'audio' : 'fonts').then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.origin !== location.origin) return;
  // Network first for the app itself, so updates show up; cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(`shell-${VERSION}`).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
