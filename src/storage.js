// Browser-only persistence (IndexedDB). Files are stored as ArrayBuffers on this device only.
const DB = 'tender-package-builder';
const STORE = 'kv';

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
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
  });
}

export async function saveProject(project) {
  try {
    await tx('readwrite', (s) => s.put(project, 'project'));
  } catch (e) {
    console.warn('autosave failed', e);
  }
}

export async function loadProject() {
  try {
    return (await tx('readonly', (s) => s.get('project'))) || null;
  } catch {
    return null;
  }
}

export async function clearProject() {
  try {
    await tx('readwrite', (s) => s.delete('project'));
  } catch {}
}

// ---- Project file export/import (JSON with base64 file contents) ----

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

export function exportProjectFile(project) {
  const data = {
    format: 'tender-package-builder',
    version: 1,
    ...project,
    files: project.files.map((f) => ({ ...f, buf: toB64(f.buf) })),
    seal: project.seal ? { ...project.seal, png: toB64(project.seal.png) } : null,
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export function importProjectFile(text) {
  const d = JSON.parse(text);
  if (d.format !== 'tender-package-builder' || !d.reqs || !Array.isArray(d.files)) throw new Error('bad_project');
  return {
    reqs: d.reqs,
    files: d.files.map((f) => ({ ...f, buf: fromB64(f.buf) })),
    matches: d.matches || {},
    expiries: d.expiries || {},
    seal: d.seal ? { ...d.seal, png: fromB64(d.seal.png) } : null,
    includeIndex: d.includeIndex !== false,
  };
}
