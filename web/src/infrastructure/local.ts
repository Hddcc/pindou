import {parseDocument, type Color, type Document} from '../domain/editor';

export type CloudRef = {userId: string; id?: string; revision?: number; key: string; pending?: Document; savedContent?: string};
export type LocalWork = {localKey: string; document: Document; cloudRefs: Record<string, CloudRef>};
const RECOVERY_KEY = 'pindou-recovery';
export function saveRecovery(work: LocalWork) {
  try { localStorage.setItem(RECOVERY_KEY, JSON.stringify(work)); } catch { /* IndexedDB autosave remains the primary persistence mechanism. */ }
}
export function readRecovery(): LocalWork | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(RECOVERY_KEY) ?? 'null');
    if (!value || typeof value.localKey !== 'string' || !value.cloudRefs || typeof value.cloudRefs !== 'object') return undefined;
    return {localKey: value.localKey, document: parseDocument(JSON.stringify(value.document)), cloudRefs: value.cloudRefs};
  } catch { return undefined; }
}
export function clearRecovery(work: LocalWork) {
  try { if (localStorage.getItem(RECOVERY_KEY) === JSON.stringify(work)) localStorage.removeItem(RECOVERY_KEY); } catch { /* Best-effort recovery cleanup. */ }
}
let connection: Promise<IDBDatabase> | undefined;
function db() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pindou', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('works', {keyPath: 'localKey'});
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = undefined; }; resolve(request.result); };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => reject(new Error('请关闭其他旧版本画板页面后重试'));
  });
}
export function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export async function putLocal(work: LocalWork) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['works', 'settings'], 'readwrite');
    tx.objectStore('works').put(work);
    tx.objectStore('settings').put(work.localKey, 'lastWork');
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('本地保存失败'));
  });
}
export async function listLocal(): Promise<LocalWork[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('works').objectStore('works').getAll();
    request.onsuccess = () => resolve((request.result as LocalWork[]).sort((a, b) => b.document.updatedAt.localeCompare(a.document.updatedAt)));
    request.onerror = () => reject(request.error);
  });
}
export async function lastLocal(): Promise<LocalWork | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['works', 'settings']);
    const key = tx.objectStore('settings').get('lastWork');
    key.onsuccess = () => {
      if (!key.result) { resolve(undefined); return; }
      const work = tx.objectStore('works').get(key.result);
      work.onsuccess = () => resolve(work.result); work.onerror = () => reject(work.error);
    };
    key.onerror = () => reject(key.error);
  });
}
export async function removeLocal(key: string) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('works', 'readwrite'); tx.objectStore('works').delete(key);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
export async function cachePalette(colors: Color[]) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('settings', 'readwrite'); tx.objectStore('settings').put(colors, 'palette');
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
export async function readPalette(): Promise<Color[] | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction('settings').objectStore('settings').get('palette');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
