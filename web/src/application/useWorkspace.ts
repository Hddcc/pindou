import {useEffect, useRef, useState} from 'react';
import {blank, configureColors, Editor, type Document} from '../domain/editor';
import {clearRecovery, lastLocal, putLocal, readPalette, readRecovery, saveRecovery, uuid, type LocalWork} from '../infrastructure/local';

// Persisted works contain JSON data only; this also supports Safari 14.
function cloneWork(work: LocalWork): LocalWork { return JSON.parse(JSON.stringify(work)) as LocalWork; }

export function useWorkspace() {
  const state = useRef<{work: LocalWork; editor: Editor} | null>(null);
  if (!state.current) { const document = blank(); state.current = {work: {localKey: uuid(), document, cloudRefs: {}}, editor: new Editor(document.snapshot)}; }
  const [version, render] = useState(0), [ready, setReady] = useState(false);
  const [status, setStatus] = useState('正在恢复'), [error, setError] = useState('');
  const dirty = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  function current(): LocalWork {
    const s = state.current!;
    return cloneWork({...s.work, document: {...s.work.document, snapshot: s.editor.snapshot()}});
  }
  async function flush() {
    clearTimeout(timer.current);
    const captured = current(); saveRecovery(captured); setStatus('自动保存中');
    const attempt = queue.current.catch(() => {}).then(() => putLocal(captured));
    queue.current = attempt;
    try {
      await attempt;
      if (state.current!.work.localKey === captured.localKey && JSON.stringify(current()) === JSON.stringify(captured)) {
        dirty.current = false; clearRecovery(captured);
        setStatus(`已自动保存 ${new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false})}`); setError('');
      }
    } catch {
      setStatus('本地保存失败'); setError('浏览器存储不可用或已满，请下载作品文件备份'); throw new Error('本地保存失败，请先下载作品文件备份');
    }
    return captured;
  }
  function changed() {
    state.current!.work.document.updatedAt = new Date().toISOString(); dirty.current = true;
    saveRecovery(current()); setStatus('待自动保存'); render(v => v + 1); clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, 800);
  }
  function replace(work: LocalWork) {
    const editor = new Editor(work.document.snapshot);
    clearTimeout(timer.current); state.current = {work: cloneWork(work), editor}; dirty.current = true;
    saveRecovery(current()); render(v => v + 1); setStatus('待自动保存'); timer.current = setTimeout(() => { void flush().catch(() => {}); }, 50);
  }
  function metadata(work: LocalWork) { state.current!.work = cloneWork(work); dirty.current = true; render(v => v + 1); }
  function create(document: Document) { replace({localKey: uuid(), document, cloudRefs: {}}); }
  useEffect(() => {
    let cancelled = false;
    readPalette().then(cached => { if (cached) configureColors(cached); }).catch(() => {}).then(async () => {
      const recovery = readRecovery();
      const stored = await lastLocal().catch(e => { if (recovery) return undefined; throw e; });
      return recovery ?? stored;
    }).then(work => {
      if (cancelled) return;
      if (work) { state.current = {work, editor: new Editor(work.document.snapshot)}; dirty.current = true; render(v => v + 1); void flush().catch(() => {}); }
      else { dirty.current = true; void flush().catch(() => {}); }
    }).catch(() => { if (!cancelled) { setStatus('本地存储不可用'); setError('无法恢复本地作品，请使用作品文件备份'); } })
      .finally(() => { if (!cancelled) setReady(true); });
    const interval = setInterval(() => { if (dirty.current) void flush().catch(() => {}); }, 10000);
    const visibility = () => { if (document.visibilityState === 'hidden' && dirty.current) void flush().catch(() => {}); };
    const before = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; void flush().catch(() => {}); } };
    const pagehide = () => { if (dirty.current) { saveRecovery(current()); void flush().catch(() => {}); } };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('beforeunload', before); window.addEventListener('pagehide', pagehide);
    return () => { cancelled = true; clearInterval(interval); clearTimeout(timer.current); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('beforeunload', before); window.removeEventListener('pagehide', pagehide); };
  }, []);
  return {work: state.current!.work, editor: state.current!.editor, version, ready, status, error, current, changed, flush, replace, metadata, create};
}
