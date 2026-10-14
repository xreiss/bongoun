// Native-speaker voice recordings: record in the app, keep on this phone (IndexedDB), export to a file.
// Exported files are imported by tools/import_voice.py so every phone gets them.

const DB = 'learnering-voice';
const STORE = 'clips';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const saveClip = (key, blob) => tx('readwrite', (s) => s.put(blob, key));
export const deleteClip = (key) => tx('readwrite', (s) => s.delete(key));

/** All local clips as { key: Blob }. */
export async function allClips() {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const out = {};
      const req = db.transaction(STORE).objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out[c.key] = c.value;
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return {}; // private mode or IndexedDB unavailable
  }
}

/** Record from the microphone until stop() is called (or maxMs). Resolves with a Blob. */
export async function record({ maxMs = 5000 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  // iPhone Safari records AAC in MP4, Chrome records Opus in WebM; both play back on their own device.
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: rec.mimeType || type || 'audio/mp4' }));
    };
  });
  rec.start();
  const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxMs);
  return {
    stop() {
      clearTimeout(timer);
      if (rec.state !== 'inactive') rec.stop();
    },
    done,
  };
}

const toBase64 = (blob) =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });

/** Download every local clip as one JSON file to send to the Mac. */
export async function exportClips() {
  const clips = await allClips();
  const out = {};
  for (const [key, blob] of Object.entries(clips)) out[key] = { type: blob.type, data: await toBase64(blob) };
  const file = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = `bongoun-voice-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return Object.keys(out).length;
}
