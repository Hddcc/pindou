import {useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {ArrowDownToLine, ChartColumn, Check, ChevronDown, Cloud, Download, Eraser, Eye, FlipHorizontal2, FlipVertical2, FolderOpen, Grid2X2, ImageDown, LoaderCircle, LogOut, Maximize, MoreHorizontal, Move, PaintBucket, Palette, Pencil, Pipette, Plus, Redo2, Scan, Search, Trash2, Undo2, UserRound, X, ZoomIn, ZoomOut} from 'lucide-react';
import {blank, colorHex, colors, colorStatistics, configureColors, displayColorCode, parseDocument, validateName, type Color, type GridSettings, type Selection, type Snapshot, type Tool} from '../domain/editor';
import {useWorkspace} from '../application/useWorkspace';
import {ApiError, cloudDocument, content, request, workBody, type CloudWork, type Summary, type User} from '../infrastructure/api';
import {cachePalette, listLocal, removeLocal, saveRecovery, uuid, type CloudRef, type LocalWork} from '../infrastructure/local';
import {download, downloadDocument, pngBlob, pngDimensions, renderPNG, safeFilename} from '../infrastructure/files';
import {readGridSettings, saveGridSettings} from '../infrastructure/settings';
import {Board, type BoardHandle} from './Board';
import {ColorPicker} from './ColorPicker';
import {ColorUsage} from './ColorUsage';
import {Modal} from './Modal';
import {DimensionField} from './DimensionField';

function IconButton({label, children, onClick, disabled = false, active = false, expanded, controls}: {label: string; children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; expanded?: boolean; controls?: string}) {
  return <button className={`icon-button ${active ? 'active' : ''}`} title={label} aria-label={label} aria-pressed={active || undefined} aria-expanded={expanded} aria-controls={controls} disabled={disabled} onClick={onClick}>{children}</button>;
}
function Preview({snapshot}: {snapshot: Snapshot}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!; ctx.clearRect(0, 0, 80, 80);
    const size = 72 / Math.max(snapshot.width, snapshot.height), ox = (80 - snapshot.width * size) / 2, oy = (80 - snapshot.height * size) / 2;
    ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, snapshot.width * size, snapshot.height * size);
    snapshot.cells.forEach(c => { ctx.fillStyle = colorHex(c.colorCode); ctx.fillRect(ox + c.x * size, oy + c.y * size, size, size); });
  }, [snapshot]);
  return <canvas ref={ref} width={80} height={80} className="work-preview" aria-label="作品缩略图"/>;
}
const tools: {id: Tool; label: string; icon: typeof Pencil}[] = [
  {id: 'pan', label: '移动', icon: Move}, {id: 'paint', label: '画笔', icon: Pencil}, {id: 'erase', label: '橡皮擦', icon: Eraser},
  {id: 'pick', label: '画布取色', icon: Eye},
  {id: 'select', label: '选区', icon: Scan},
];

export default function App() {
  const workspace = useWorkspace(), board = useRef<BoardHandle>(null), file = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<Tool>('paint'), [color, setColor] = useState('H7');
  const [recent, setRecent] = useState(['H7', 'A1', 'C5', 'F5', 'B12', 'E2']);
  const [query, setQuery] = useState(''), [family, setFamily] = useState('全部'), [paletteOpen, setPaletteOpen] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [paletteView, setPaletteView] = useState<'palette' | 'usage'>('palette');
  const [beadMode, setBeadMode] = useState(false), [beadFilter, setBeadFilter] = useState<string | null>(null);
  const [openInBeadMode, setOpenInBeadMode] = useState(false);
  const [zoom, setZoom] = useState(100), [modal, setModal] = useState<'new' | 'resize' | 'save' | 'library' | 'auth' | 'export' | 'settings' | 'picker' | 'success' | null>(null);
  const [eraserSize, setEraserSize] = useState(1), [gridSettings, setGridSettings] = useState<GridSettings>(readGridSettings);
  const [menu, setMenu] = useState<'actions' | 'brush' | 'eraser' | null>(null), [brushMode, setBrushMode] = useState<'paint' | 'fill'>('paint');
  const eraserTool = useRef<HTMLDivElement>(null), brushTool = useRef<HTMLDivElement>(null), actionsTool = useRef<HTMLDivElement>(null);
  const [success, setSuccess] = useState<{title: string; message: string; returnTo: 'export' | null} | null>(null);
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [failure, setFailure] = useState('');
  const [user, setUser] = useState<User | null>(null), [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [saveAfterAuth, setSaveAfterAuth] = useState(false), [cloudStatus, setCloudStatus] = useState('');
  const [localWorks, setLocalWorks] = useState<LocalWork[]>([]), [cloudWorks, setCloudWorks] = useState<Summary[]>([]);
  const [tab, setTab] = useState<'local' | 'cloud'>('local'), [cursor, setCursor] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{remote: CloudWork; userId: string} | null>(null);
  const [exportGrid, setExportGrid] = useState(true), [exportURL, setExportURL] = useState('');
  const [exportStatistics, setExportStatistics] = useState(true);
  const [exportSelection, setExportSelection] = useState(false);
  const [newSize, setNewSize] = useState({width: '32', height: '32'}), [resizeSize, setResizeSize] = useState({width: '32', height: '32'});
  const [pendingName, setPendingName] = useState('未命名拼豆图');
  const [pwaUpdate, setPwaUpdate] = useState(false);
  const [offlineReady, setOfflineReady] = useState(() => !!navigator.serviceWorker?.controller);
  const [paletteVersion, paletteChanged] = useState(0);
  const statistics = useMemo(() => colorStatistics(workspace.editor.snapshot()), [workspace.editor, workspace.version, paletteVersion]);
  const selectionHasColors = !!selection && [...workspace.editor.cells.keys()].some(key => {
    const x = key % workspace.editor.width, y = Math.floor(key / workspace.editor.width);
    return x >= selection.x && x < selection.x + selection.width && y >= selection.y && y < selection.y + selection.height;
  });
  const visibleFilter = beadFilter && statistics.some(item => item.code === beadFilter) ? beadFilter : null;
  const currentHex = colorHex(color), currentLabel = displayColorCode(color);
  const mobileLabel = beadMode ? visibleFilter ? displayColorCode(visibleFilter) : '全部颜色' : currentLabel;
  const mobileHex = beadMode ? visibleFilter ? colorHex(visibleFilter) : '#E8ECEA' : currentHex;
  useEffect(() => { setSelection(null); setExportSelection(false); }, [workspace.editor, workspace.editor.width, workspace.editor.height]);
  useEffect(() => { saveGridSettings(gridSettings); }, [gridSettings]);
  useEffect(() => { if (modal || paletteOpen) setMenu(null); }, [modal, paletteOpen]);
  useEffect(() => {
    if (!menu) return;
    const active = menu === 'actions' ? actionsTool : menu === 'brush' ? brushTool : eraserTool;
    const outside = (event: PointerEvent) => { if (!active.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(null); active.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);
  useEffect(() => { request<{user: User}>('/me').then(r => setUser(r.user)).catch(() => {}); }, []);
  useEffect(() => { if (!workspace.ready) return; request<{items: Color[]}>('/colors').then(async data => {
    configureColors(data.items); paletteChanged(v => v + 1); await cachePalette(colors);
  }).catch(() => {}); }, [workspace.ready]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(id); }, [notice]);
  useEffect(() => {
    const handler = () => setPwaUpdate(true); window.addEventListener('pindou-update', handler);
    return () => window.removeEventListener('pindou-update', handler);
  }, []);
  useEffect(() => {
    const ready = () => setOfflineReady(true);
    window.addEventListener('pindou-offline-ready', ready);
    return () => window.removeEventListener('pindou-offline-ready', ready);
  }, []);
  useEffect(() => {
    if (modal !== 'export') return;
    try { setExportURL(renderPNG(workspace.current().document.snapshot, exportGrid, exportStatistics, gridSettings, exportSelection ? selection : null).toDataURL()); } catch (e) { setFailure((e as Error).message); }
  }, [modal, exportGrid, exportStatistics, exportSelection, selection, gridSettings, workspace.work.document.updatedAt]);
  function pick(code: string) {
    if (beadMode) { if (statistics.some(item => item.code === code)) setBeadFilter(code); return; }
    setColor(code); setRecent(r => [code, ...r.filter(c => c !== code)].slice(0, 12)); if (tool === 'pick') setTool('paint');
  }
  function switchMode(value: boolean) { setBeadMode(value); setBeadFilter(null); setMenu(null); if (value) { setPaletteView('usage'); setSelection(null); } }
  function history(redo = false) { if (redo ? workspace.editor.redo() : workspace.editor.undo()) { setSelection(null); workspace.changed(); } }
  function chooseTool(value: Tool) {
    setTool(value === 'paint' ? brushMode : value); setPaletteOpen(false);
    const next = value === 'erase' ? 'eraser' : value === 'paint' ? 'brush' : null;
    setMenu(next && menu !== next ? next : null);
  }
  function complete(title: string, message: string, returnTo: 'export' | null = null) { setSuccess({title, message, returnTo}); setMenu(null); setModal('success'); }
  function nativePickerBackup() { saveRecovery(workspace.current()); void workspace.flush().catch(() => {}); }
  function openPicker() {
    void run('保存草稿', async () => {
      await workspace.flush(); setPaletteOpen(false); openModal('picker');
    });
  }
  function openMode() { switchMode(openInBeadMode); }
  async function run(label: string, task: () => Promise<void>) {
    setBusy(label); setFailure('');
    try { await task(); } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setUser(null); setModal('auth'); }
      setFailure((e as Error).message);
    } finally { setBusy(''); }
  }
  async function protect() {
    try { await workspace.flush(); return true; }
    catch { return window.confirm('临时保存失败。继续操作可能丢失当前修改，是否继续？'); }
  }
  function openModal(value: typeof modal) { setFailure(''); setMenu(null); setModal(value); }
  async function bindCloud(ref: CloudRef) {
    const latest = workspace.current(); latest.cloudRefs[ref.userId] = ref; workspace.metadata(latest); await workspace.flush();
  }
  async function saveCloud(account: User, copy = false, baseRevision?: number) {
    setCloudStatus('云端保存中');
    try {
      await workspace.flush();
      let local = workspace.current(), ref = copy ? undefined : local.cloudRefs[account.id];
      if (!ref) {
        ref = {userId: account.id, key: uuid(), pending: local.document};
        await bindCloud(ref);
      }
      let saved: CloudWork;
      if (!ref.id) {
        const pending = ref.pending ?? local.document;
        saved = await request<CloudWork>('/works', {method: 'POST', headers: {'Idempotency-Key': ref.key}, body: workBody(pending)});
        ref = {...ref, id: saved.id, revision: saved.revision, pending: undefined, savedContent: content(cloudDocument(saved))};
        await bindCloud(ref);
        if (content(cloudDocument(saved)) !== content(pending)) {
          setConflict({remote: saved, userId: account.id}); setCloudStatus('云端版本冲突'); return;
        }
        local = workspace.current();
        if (content(local.document) !== content(cloudDocument(saved)))
          saved = await request<CloudWork>(`/works/${ref.id}`, {method: 'PUT', body: workBody(local.document, saved.revision)});
      } else {
        saved = await request<CloudWork>(`/works/${ref.id}`, {method: 'PUT', body: workBody(local.document, baseRevision ?? ref.revision)});
      }
      await bindCloud({...ref, id: saved.id, revision: saved.revision, pending: undefined, savedContent: content(cloudDocument(saved))});
      setCloudStatus('已保存到云端'); complete('保存成功', '作品已保存到云端。'); setConflict(null);
    } catch (e) {
      setCloudStatus('云端保存失败');
      const ref = workspace.current().cloudRefs[account.id];
      if (e instanceof ApiError && e.code === 'WORK_VERSION_CONFLICT' && ref?.id) {
        const remote = await request<CloudWork>(`/works/${ref.id}`); setConflict({remote, userId: account.id}); return;
      }
      if (e instanceof ApiError && e.status === 401) setSaveAfterAuth(true);
      throw e;
    }
  }
  function cloudSave(copy = false) {
    if (!user) { setSaveAfterAuth(true); openModal('auth'); return; }
    void run('云端保存', () => saveCloud(user, copy));
  }
  async function loadLibrary(type: 'local' | 'cloud', more = false) {
    setTab(type);
    if (type === 'local') setLocalWorks(await listLocal());
    else if (user) {
      const data = await request<{items: Summary[]; nextCursor: string | null}>(`/works?limit=20${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      setCloudWorks(old => more ? [...old, ...data.items] : data.items); setCursor(data.nextCursor);
    }
  }
  function showLibrary() { openModal('library'); void run('读取作品', () => loadLibrary('local')); }
  async function importFile(selected: File) {
    if (selected.size > 3 * 1024 * 1024) throw new Error('作品文件超过 3 MiB 上限');
    const document = parseDocument(await selected.text());
    if (await protect()) { workspace.create(document); openMode(); setCloudStatus(''); setNotice('已打开本地作品'); }
  }
  async function openCloud(item: Summary) {
    const w = await request<CloudWork>(`/works/${item.id}`);
    if (!(await protect()) || !user) return;
    // Keep the old local draft intact, including edits not uploaded to the cloud.
    const record: LocalWork = {localKey: uuid(), document: cloudDocument(w), cloudRefs: {[user.id]: {userId: user.id, key: uuid(), id: w.id, revision: w.revision, savedContent: content(cloudDocument(w))}}};
    workspace.replace(record); openMode(); setCloudStatus('已打开云端作品'); setModal(null);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (beadMode || modal || conflict || (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); history(e.shiftKey);
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const filteredColors = colors.filter(c => c.active && (family === '全部' || c.code.startsWith(family)) && `${c.code} ${displayColorCode(c.code)} ${c.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = ['全部', ...new Set(colors.map(c => c.code.replace(/\d+/g, '')))];
  const colorGroups = groups.slice(1).map(name => ({name, items: filteredColors.filter(c => c.code.replace(/\d+/g, '') === name)})).filter(group => group.items.length);
  const cloudRef = user ? workspace.work.cloudRefs[user.id] : undefined;
  const cloudDirty = cloudRef?.id && cloudRef.savedContent !== content(workspace.current().document);
  const exportSize = modal === 'export' ? pngDimensions(workspace.current().document.snapshot, exportGrid, exportStatistics, exportSelection ? selection : null) : null;

  return <div className="app-shell">
    <header className="app-header">
      <div className="header-identity">
      <div className="brand"><img src="/icons/laopai-192.png" alt="" width={32} height={32}/><span>老派拼豆之必要</span></div>
      <div className="document-heading"><button className="document-name" title="重命名作品" disabled={!!busy || !workspace.ready} onClick={() => {
        const name = window.prompt('作品名称', workspace.work.document.name); if (name === null) return;
        try { const w = workspace.current(); w.document.name = validateName(name); workspace.metadata(w); workspace.changed(); } catch (e) { setFailure((e as Error).message); }
      }}>{workspace.work.document.name}<Pencil size={13}/></button><div className="document-meta"><span className="board-dimensions">{workspace.editor.width} × {workspace.editor.height}</span><span className={`save-status ${workspace.error ? 'bad' : ''}`}><span className="status-dot"/>{workspace.status}</span></div></div>
      </div>
      <div className="header-actions" role="group" aria-label="作品操作" ref={actionsTool}>
        <button className="command secondary actions-trigger" aria-label="画布操作" title="画布操作" aria-expanded={menu === 'actions'} aria-controls="canvas-actions-menu" onClick={() => { setPaletteOpen(false); setMenu(menu === 'actions' ? null : 'actions'); }}><MoreHorizontal size={22}/><span>{beadMode ? '拼豆模式' : '绘图模式'}</span><ChevronDown size={14}/></button>
        <div id="canvas-actions-menu" className="actions-menu" role="group" aria-label="画布操作菜单" hidden={menu !== 'actions'}>
          <div className="segmented mode-switch" aria-label="画布模式"><button className={!beadMode ? 'selected' : ''} aria-pressed={!beadMode} disabled={!workspace.ready} onClick={() => switchMode(false)}><Pencil size={16}/>绘图模式</button><button className={beadMode ? 'selected' : ''} aria-pressed={beadMode} disabled={!workspace.ready} onClick={() => switchMode(true)}><Grid2X2 size={16}/>拼豆模式</button></div>
          <div className="menu-commands">
            <button disabled={beadMode || !workspace.editor.canUndo} aria-label="撤回" onClick={() => { history(); setMenu(null); }}><Undo2 size={18}/>撤回</button>
            <button disabled={beadMode || !workspace.editor.canRedo} aria-label="反撤回" onClick={() => { history(true); setMenu(null); }}><Redo2 size={18}/>反撤回</button>
            <button aria-label="查看用色统计" onClick={() => { setMenu(null); setPaletteView('usage'); setPaletteOpen(true); }}><ChartColumn size={18}/>用色统计</button>
            <button aria-label="清空画布" disabled={beadMode || !workspace.ready || !workspace.editor.cells.size} onClick={() => { if (window.confirm('清空当前画布？此操作可以撤回。') && workspace.editor.clear()) { setSelection(null); workspace.changed(); } setMenu(null); }}><Trash2 size={18}/>清空画布</button>
            <button aria-label="水平镜像" disabled={beadMode || !workspace.ready || !workspace.editor.cells.size} onClick={() => { if (workspace.editor.mirror('horizontal')) workspace.changed(); setMenu(null); }}><FlipHorizontal2 size={18}/>左右镜像</button>
            <button aria-label="垂直镜像" disabled={beadMode || !workspace.ready || !workspace.editor.cells.size} onClick={() => { if (workspace.editor.mirror('vertical')) workspace.changed(); setMenu(null); }}><FlipVertical2 size={18}/>上下镜像</button>
          </div>
          <div className="menu-files"><button className="command secondary save-button" aria-label="保存" disabled={!!busy || !workspace.ready} onClick={() => openModal('save')}><Cloud size={18}/>保存</button><button className="command primary export-button" aria-label="导出" disabled={!!busy || !workspace.ready} onClick={() => openModal('export')}><ImageDown size={18}/>导出</button></div>
        </div>
      </div>
      <div className="header-library">
        <IconButton label="新建画布" disabled={!!busy || !workspace.ready} onClick={() => { setPendingName('未命名拼豆图'); openModal('new'); }}><Plus size={20}/></IconButton>
        <IconButton label="我的作品" disabled={!!busy || !workspace.ready} onClick={showLibrary}><FolderOpen size={20}/></IconButton>
        <IconButton label={user ? `账号：${user.username}` : '登录 / 注册'} disabled={!!busy} onClick={() => { setSaveAfterAuth(false); openModal('auth'); }}><UserRound size={20}/></IconButton>
      </div>
    </header>
    {failure || workspace.error ? <div className="error-banner" role="alert"><span>{failure || workspace.error}</span><IconButton label="关闭提示" onClick={() => setFailure('')}><X size={16}/></IconButton></div> : null}
    {pwaUpdate && <div className="update-banner"><span>新版本已准备好</span><button onClick={() => void run('更新', async () => { await workspace.flush(); window.dispatchEvent(new Event('pindou-install-update')); })}>更新</button></div>}
    <div className="editor-layout">
      <main className="canvas-workspace">
        {selection && !beadMode && <div className="selection-bar" data-testid="selection-size"><span>选区 {selection.width} × {selection.height}</span><IconButton label="导出选区" onClick={() => { setExportSelection(true); openModal('export'); }}><ImageDown size={18}/></IconButton><IconButton label="删除选区颜色" disabled={!workspace.ready || !selectionHasColors} onClick={() => { if (window.confirm('删除选区内颜色？此操作可以撤回。') && workspace.editor.clearRegion(selection)) workspace.changed(); }}><Trash2 size={18}/></IconButton><IconButton label="取消选区" onClick={() => setSelection(null)}><X size={18}/></IconButton></div>}
        {beadMode && <div className="bead-filter-strip" aria-label="拼豆颜色筛选"><button className={!visibleFilter ? 'selected' : ''} aria-pressed={!visibleFilter} onClick={() => setBeadFilter(null)}>全部颜色</button>{statistics.map(item => <button key={item.code} className={visibleFilter === item.code ? 'selected' : ''} aria-label={`筛选颜色 ${item.label}`} aria-pressed={visibleFilter === item.code} title={`${item.label} · ${item.count} 颗`} onClick={() => setBeadFilter(item.code)}><span style={{background: item.hex}}/><strong>{item.label}</strong><small>{item.count}</small></button>)}</div>}
        {workspace.ready ? <Board key={workspace.work.localKey} ref={board} editor={workspace.editor} tool={tool} beadMode={beadMode} filter={visibleFilter} selection={selection} onSelection={setSelection} color={color} eraserSize={eraserSize} settings={gridSettings} version={workspace.version} onChange={workspace.changed} onPick={pick} onZoom={setZoom}/> : <div className="loading-board"><LoaderCircle className="spin" size={24}/></div>}
        <footer className="workspace-footer"><span className="bead-count">{workspace.editor.cells.size.toLocaleString()} 颗拼豆</span><div className="recent-colors" aria-label="最近使用颜色">{recent.map(code => <button key={code} className={`recent-swatch ${code === color ? 'selected' : ''}`} title={displayColorCode(code)} aria-label={`选择颜色 ${displayColorCode(code)}`} aria-pressed={code === color} onClick={() => pick(code)} style={{background: colorHex(code)}}/>)}</div>
          <button className={`dock-color ${paletteOpen ? 'active' : ''}`} aria-label="打开色板" title="打开色板" aria-expanded={paletteOpen} aria-controls="palette-panel" onClick={() => { setMenu(null); if (!paletteOpen) setPaletteView(beadMode ? 'usage' : 'palette'); setPaletteOpen(v => !v); }}><span className="dock-swatch" style={{background: mobileHex}}/><strong>{mobileLabel}</strong><Palette size={18}/></button>
          <span className="cloud-indicator">{cloudDirty ? '有修改待上传' : cloudStatus || '本地作品'}</span>{offlineReady && <span className="offline-ready"><Check size={13}/>离线可用</span>}</footer>
      </main>
      <aside id="palette-panel" className={`palette-panel ${paletteOpen ? 'is-open' : 'is-collapsed'} ${paletteView === 'usage' ? 'usage-view' : ''}`} aria-label="MARD291 色板">
        <div className="palette-toolbar"><div className="segmented palette-tabs"><button className={paletteView === 'palette' ? 'selected' : ''} aria-pressed={paletteView === 'palette'} disabled={beadMode} onClick={() => setPaletteView('palette')}><Palette size={16}/>色板</button><button className={paletteView === 'usage' ? 'selected' : ''} aria-pressed={paletteView === 'usage'} onClick={() => setPaletteView('usage')}><ChartColumn size={16}/>用色统计</button></div>
        {paletteView === 'palette' && <>
        <label className="search-box"><Search size={17}/><input aria-label="搜索色号" placeholder="搜索色号 / 名称" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={14}/></button>}</label>
        <div className="family-filter"><label htmlFor="color-family">色系</label><select id="color-family" value={family} onChange={e => setFamily(e.target.value)}>{groups.map(group => <option key={group}>{group}</option>)}</select><span>{filteredColors.length} 色</span></div>
        </>}<IconButton label="收起色板" onClick={() => setPaletteOpen(false)}><X size={18}/></IconButton></div>
        {paletteView === 'palette' ? <div className="color-grid">{colorGroups.map(group => <section key={group.name} className="color-family" aria-label={`${group.name} 系列`}>
          <h3>{group.name}<small>{group.items.length} 色</small></h3>
          <div className="color-family-grid">{group.items.map(c => <button key={c.code} className={`color-tile ${c.code === color ? 'selected' : ''}`} title={`${displayColorCode(c.code)} · ${c.hex}`} aria-label={`颜色 ${displayColorCode(c.code)}`} aria-pressed={c.code === color} onClick={() => pick(c.code)}>
          <span style={{background: c.hex}}>{c.code === color && <Check size={15} color={parseInt(c.hex.slice(1, 3), 16) + parseInt(c.hex.slice(3, 5), 16) + parseInt(c.hex.slice(5), 16) > 390 ? '#173d30' : '#fff'}/>}</span><small>{displayColorCode(c.code)}</small>
        </button>)}</div></section>)}{!filteredColors.length && <div className="empty-colors">没有匹配的色号</div>}</div> : <ColorUsage items={statistics} selected={beadMode ? visibleFilter : color} beadMode={beadMode}
          onSelect={code => { if (beadMode) setBeadFilter(code); else if (code) pick(code); }}/>}
      </aside>
    </div>
    <nav className="bottom-dock" aria-label="绘图工具">
      <div className="dock-tools">{tools.map(({id, label, icon: Icon}) => id === 'erase' ? <div className="dock-eraser" ref={eraserTool} key={id}>
        <IconButton label={label} active={!beadMode && tool === id} disabled={!workspace.ready || beadMode} expanded={menu === 'eraser'} controls="eraser-sizes" onClick={() => chooseTool(id)}><Icon size={22}/><span>{label}</span><small className="eraser-size-badge">{eraserSize}</small></IconButton>
        {menu === 'eraser' && <div id="eraser-sizes" className="eraser-sizes" role="group" aria-label="橡皮擦尺寸">{[1, 2, 4, 8].map(n => <button key={n} aria-label={`橡皮擦尺寸 ${n} × ${n}`} aria-pressed={eraserSize === n} className={eraserSize === n ? 'selected' : ''} onClick={() => { setEraserSize(n); setMenu(null); eraserTool.current?.querySelector('button')?.focus(); }}>{n} × {n}</button>)}</div>}
      </div> : id === 'paint' ? <div className="dock-brush" ref={brushTool} key={id}>
        <IconButton label="画笔" active={!beadMode && (tool === 'paint' || tool === 'fill')} disabled={!workspace.ready || beadMode} expanded={menu === 'brush'} controls="brush-modes" onClick={() => chooseTool(id)}>{tool === 'fill' ? <PaintBucket size={22}/> : <Pencil size={22}/>}<span>{tool === 'fill' ? '填色' : '画笔'}</span><ChevronDown size={10} className="brush-chevron"/></IconButton>
        {menu === 'brush' && <div id="brush-modes" className="brush-modes" role="group" aria-label="画笔方式">{(['paint', 'fill'] as const).map(value => <button key={value} aria-label={value === 'paint' ? '单格画笔' : '填色'} aria-pressed={brushMode === value} className={brushMode === value ? 'selected' : ''} onClick={() => { setBrushMode(value); setTool(value); setMenu(null); brushTool.current?.querySelector('button')?.focus(); }}>{value === 'paint' ? <Pencil size={18}/> : <PaintBucket size={18}/>}<span>{value === 'paint' ? '画笔' : '填色'}</span></button>)}</div>}
      </div> : <IconButton key={id} label={label} active={(beadMode ? 'pan' : tool) === id} disabled={!workspace.ready || (beadMode && id !== 'pan')} onClick={() => chooseTool(id)}><Icon size={22}/><span>{label}</span></IconButton>)}
        <IconButton label="外部取色" disabled={beadMode || !!busy || !workspace.ready} onClick={openPicker}><Pipette size={22}/><span>外部取色</span></IconButton>
        <IconButton label="画布设置" onClick={() => openModal('settings')}><Grid2X2 size={22}/><span>画布</span></IconButton>
      </div>
      <span className="dock-divider"/>
      <div className="zoom-controls">
        <IconButton label="缩小" onClick={() => board.current?.zoom(.8)}><ZoomOut size={17}/></IconButton><button className="zoom-value" title="100% 显示" onClick={() => board.current?.actual()}>{zoom}%</button><IconButton label="放大" onClick={() => board.current?.zoom(1.25)}><ZoomIn size={17}/></IconButton><span className="zoom-divider"/><IconButton label="适配画布" onClick={() => board.current?.fit()}><Maximize size={17}/></IconButton>
      </div>
    </nav>
    {paletteOpen && <button className="palette-backdrop" aria-label="收起色板" onClick={() => setPaletteOpen(false)}/>}
    <input ref={file} className="hidden-input" type="file" aria-label="打开作品文件" accept=".pindou,application/json" onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; if (selected) void run('打开文件', () => importFile(selected)); }}/>
    {notice && <div className="toast" role="status"><Check size={17}/>{notice}</div>}
    {busy && <div className="busy-status" role="status"><LoaderCircle size={16} className="spin"/>{busy}…</div>}

    {modal === 'picker' && <Modal title="外部取色" onClose={() => setModal(null)}><ColorPicker initial={currentHex} onPrepareNativePicker={nativePickerBackup} onApply={code => { pick(code); setTool('paint'); setModal(null); }}/></Modal>}
    {modal === 'settings' && <Modal title="画布设置" onClose={() => setModal(null)}>
      <button className="command secondary full" disabled={beadMode || !workspace.ready} onClick={() => { setResizeSize({width: String(workspace.editor.width), height: String(workspace.editor.height)}); openModal('resize'); }}><Maximize size={18}/>调整画布尺寸</button>
      <label className="setting-row">辅助线间隔<select aria-label="辅助线间隔" value={gridSettings.guideEvery} onChange={e => setGridSettings(s => ({...s, guideEvery: Number(e.target.value) as 5 | 10}))}><option value={5}>每 5 格</option><option value={10}>每 10 格</option></select></label>
      {(['grid', 'guide'] as const).map(kind => <div className="line-settings" key={kind}><h3>{kind === 'grid' ? '普通网格线' : '辅助线'}</h3>
        <label className="setting-row">线型<select aria-label={`${kind === 'grid' ? '普通网格线' : '辅助线'}线型`} value={gridSettings[`${kind}Style`]} onChange={e => setGridSettings(s => ({...s, [`${kind}Style`]: e.target.value}))}><option value="solid">实线</option><option value="dashed">虚线</option></select></label>
        <label className="setting-row">深浅度<div className="range-setting"><input aria-label={`${kind === 'grid' ? '普通网格线' : '辅助线'}深浅度`} type="range" min={0} max={100} value={gridSettings[`${kind}Opacity`]} onChange={e => setGridSettings(s => ({...s, [`${kind}Opacity`]: Number(e.target.value)}))}/><output>{gridSettings[`${kind}Opacity`]}%</output></div></label>
      </div>)}
      <label className="checkbox-row"><input type="checkbox" checked={gridSettings.centerLine} onChange={e => setGridSettings(s => ({...s, centerLine: e.target.checked}))}/><span className="center-line-sample" style={{color: gridSettings.centerColor}}/>中心十字线</label>
      <label className="setting-row">中心线颜色<input type="color" aria-label="中心线颜色" value={gridSettings.centerColor} onChange={e => setGridSettings(s => ({...s, centerColor: e.target.value.toUpperCase()}))}/></label>
      <label className="checkbox-row"><input type="checkbox" checked={gridSettings.showCodes} onChange={e => setGridSettings(s => ({...s, showCodes: e.target.checked}))}/>显示格内色号</label>
      <div className="modal-actions"><button className="command primary full" onClick={() => setModal(null)}><Check size={18}/>完成</button></div>
    </Modal>}

    {modal === 'resize' && <Modal title="调整画布尺寸" onClose={() => setModal(null)}><form onSubmit={event => { event.preventDefault(); void run('调整画布', async () => {
      const width = Number(resizeSize.width), height = Number(resizeSize.height), editor = workspace.editor;
      const dx = Math.floor((width - editor.width) / 2), dy = Math.floor((height - editor.height) / 2);
      const cropped = editor.snapshot().cells.filter(cell => cell.x + dx < 0 || cell.x + dx >= width || cell.y + dy < 0 || cell.y + dy >= height).length;
      if (cropped && !window.confirm(`缩小画布将裁掉 ${cropped} 颗拼豆，是否继续？此操作可以撤回。`)) return;
      if (editor.resize(width, height)) { setSelection(null); workspace.changed(); }
      setModal(null); setNotice('画布尺寸已调整');
    }); }}>
      <div className="field-pair"><DimensionField name="width" label="宽度" value={resizeSize.width} onChange={width => setResizeSize(size => ({...size, width}))}/><span>×</span><DimensionField name="height" label="高度" value={resizeSize.height} onChange={height => setResizeSize(size => ({...size, height}))}/></div>
      <ErrorText text={failure}/><div className="modal-actions"><button type="button" className="command secondary" onClick={() => setModal(null)}>取消</button><button className="command primary" disabled={!!busy}><Check size={18}/>应用尺寸</button></div>
    </form></Modal>}

    {modal === 'new' && <Modal title="新建画布" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void run('新建画布', async () => {
      const document = blank(pendingName, Number(data.get('width')), Number(data.get('height'))); if (await protect()) { workspace.create(document); switchMode(false); setCloudStatus(''); setModal(null); }
    }); }}><label className="field">作品名称<input value={pendingName} onChange={e => setPendingName(e.target.value)} maxLength={80} required/></label>
      <div className="size-presets">{[16, 32, 64, 96, 128].map(n => <button type="button" key={n} className={newSize.width === String(n) && newSize.height === String(n) ? 'selected' : ''} onClick={() => setNewSize({width: String(n), height: String(n)})}>{n} × {n}</button>)}</div>
      <div className="field-pair"><DimensionField name="width" label="宽度" value={newSize.width} onChange={width => setNewSize(size => ({...size, width}))}/><span>×</span><DimensionField name="height" label="高度" value={newSize.height} onChange={height => setNewSize(size => ({...size, height}))}/></div>
      <ErrorText text={failure}/><div className="modal-actions"><button type="button" className="command secondary" onClick={() => setModal(null)}>取消</button><button className="command primary" disabled={!!busy}><Plus size={18}/>创建画布</button></div></form></Modal>}

    {modal === 'save' && <Modal title="保存作品" onClose={() => setModal(null)}>
      <div className="save-options"><button disabled={!!busy} onClick={() => void run('下载作品', async () => { const d = workspace.current().document; await workspace.flush().catch(() => {}); downloadDocument(d); complete('保存成功', '作品文件已生成，已发起下载。'); })}><Download size={22}/><span><strong>保存到本地</strong><small>.pindou</small></span><ArrowDownToLine size={18}/></button>
        <button disabled={!!busy} onClick={() => cloudSave()}><Cloud size={22}/><span><strong>保存到云端</strong><small>{user ? user.username : '登录后保存'}</small></span><ChevronDown size={18}/></button>
        {cloudRef?.id && <button disabled={!!busy} onClick={() => cloudSave(true)}><Plus size={22}/><span><strong>云端另存为</strong><small>新副本</small></span></button>}
      </div><ErrorText text={failure}/><div className="save-detail"><Check size={14}/>{workspace.status}</div>
    </Modal>}

    {modal === 'export' && <Modal title="导出图纸" onClose={() => setModal(null)}>
      <label className="setting-row">导出范围<select aria-label="导出范围" value={exportSelection && selection ? 'selection' : 'canvas'} onChange={e => setExportSelection(e.target.value === 'selection')}><option value="canvas">完整画布</option><option value="selection" disabled={!selection}>当前选区{selection ? `（${selection.width} × ${selection.height}）` : ''}</option></select></label>
      <div className="segmented"><button className={exportGrid ? 'selected' : ''} onClick={() => setExportGrid(true)}><Grid2X2 size={17}/>带网格</button><button className={!exportGrid ? 'selected' : ''} onClick={() => setExportGrid(false)}><ImageDown size={17}/>透明背景</button></div>
      <label className="checkbox-row export-statistics"><input type="checkbox" checked={exportStatistics} onChange={e => setExportStatistics(e.target.checked)}/>附加用色统计</label>
      <div className="export-preview">{exportURL && <img src={exportURL} alt="图纸导出预览"/>}</div>
      <div className="export-spec"><span>PNG</span><span>{exportSize?.width} × {exportSize?.height} px</span></div><ErrorText text={failure}/>
      <div className="modal-actions"><button className="command primary full" disabled={!!busy} onClick={() => void run('导出图片', async () => {
        const d = workspace.current().document; await workspace.flush().catch(() => {});
        download(await pngBlob(d, exportGrid, exportStatistics, gridSettings, exportSelection ? selection : null), `${safeFilename(d.name)}${exportSelection && selection ? '-selection' : ''}-${exportGrid ? 'grid' : 'clean'}.png`); complete('导出成功', 'PNG 图纸已生成，已发起下载。', 'export');
      })}><Download size={18}/>下载 PNG</button></div>
    </Modal>}

    {modal === 'success' && success && <Modal title={success.title} onClose={() => setModal(success.returnTo)}><div className="success-message"><Check size={28}/><p>{success.message}</p></div><div className="modal-actions"><button className="command primary full" onClick={() => setModal(success.returnTo)}><Check size={18}/>完成</button></div></Modal>}

    {modal === 'auth' && <Modal title={user ? '我的账号' : '云端账号'} onClose={() => { setModal(null); setSaveAfterAuth(false); }}>
      {user ? <div className="account-view"><UserRound size={32}/><strong>{user.username}</strong><button className="command secondary" disabled={!!busy} onClick={() => void run('退出登录', async () => { await request('/auth/logout', {method: 'POST'}); setUser(null); setModal(null); setCloudStatus(''); setNotice('已退出登录，本地作品仍保留'); })}><LogOut size={18}/>退出登录</button></div> : <>
        <div className="segmented"><button className={authMode === 'login' ? 'selected' : ''} onClick={() => { setAuthMode('login'); setFailure(''); }}>登录</button><button className={authMode === 'register' ? 'selected' : ''} onClick={() => { setAuthMode('register'); setFailure(''); }}>注册</button></div>
        <form onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const data = new FormData(e.currentTarget); void run(authMode === 'login' ? '登录' : '注册', async () => {
          const result = await request<{user: User}>(`/auth/${authMode}`, {method: 'POST', body: JSON.stringify({username: data.get('username'), password: data.get('password')})});
          setUser(result.user); setModal(null); setNotice('登录成功'); if (saveAfterAuth) { setSaveAfterAuth(false); await saveCloud(result.user); }
        }); }}><label className="field">用户名<input name="username" pattern="[A-Za-z0-9_]{3,32}" minLength={3} maxLength={32} placeholder="3–32 位字母、数字、下划线" autoComplete="username" required/></label>
          <label className="field">密码<input name="password" type="password" minLength={8} maxLength={72} placeholder="8–72 个字符" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required/></label>
          {authMode === 'register' && <p className="privacy-note">云端保存作品名称、尺寸和色号，作品仅本人可见，可在“我的作品”中删除。当前版本暂不支持找回密码，请妥善保存密码。</p>}
          <ErrorText text={failure}/><button className="command primary full" disabled={!!busy}>{busy ? <LoaderCircle size={18} className="spin"/> : <Cloud size={18}/>} {authMode === 'login' ? '登录' : '创建账号'}</button></form>
      </>}
    </Modal>}

    {modal === 'library' && <Modal title="我的作品" wide onClose={() => setModal(null)}>
      <div className="library-top"><div className="segmented"><button className={tab === 'local' ? 'selected' : ''} disabled={!!busy} onClick={() => void run('读取作品', () => loadLibrary('local'))}>本机作品</button><button className={tab === 'cloud' ? 'selected' : ''} disabled={!!busy} onClick={() => void run('读取作品', () => loadLibrary('cloud'))}>云端作品</button></div>
        <button className="command secondary" disabled={!!busy} onClick={() => { setModal(null); file.current?.click(); }}><FolderOpen size={17}/>本地打开</button></div>
      <label className="checkbox-row library-mode"><input type="checkbox" checked={openInBeadMode} onChange={e => setOpenInBeadMode(e.target.checked)}/>以拼豆模式打开</label>
      <ErrorText text={failure}/><div className="work-list">
        {tab === 'local' && localWorks.map(item => <div className="work-row" key={item.localKey}><button className="work-open" disabled={!!busy} onClick={() => void run('打开作品', async () => { if (await protect()) { workspace.replace(item.localKey === workspace.work.localKey ? workspace.current() : item); openMode(); setCloudStatus(''); setModal(null); } })}><Preview snapshot={item.document.snapshot}/><div><strong>{item.document.name}</strong><span>{item.document.snapshot.width} × {item.document.snapshot.height} 格 · {formatTime(item.document.updatedAt)}</span></div></button><IconButton label={`删除本机作品 ${item.document.name}`} disabled={!!busy || item.localKey === workspace.work.localKey} onClick={() => {
          if (window.confirm(`删除本机作品“${item.document.name}”？下载文件和云端副本会保留。`)) void run('删除作品', async () => { await removeLocal(item.localKey); await loadLibrary('local'); });
        }}><Trash2 size={17}/></IconButton></div>)}
        {tab === 'local' && !localWorks.length && <div className="empty-state"><FolderOpen size={30}/><p>暂无本机作品</p></div>}
        {tab === 'cloud' && !user && <div className="empty-state"><Cloud size={30}/><p>登录后查看云端作品</p><button className="command primary" onClick={() => { setSaveAfterAuth(false); openModal('auth'); }}>登录 / 注册</button></div>}
        {tab === 'cloud' && user && cloudWorks.map(item => <div className="work-row" key={item.id}><button className="work-open" disabled={!!busy} onClick={() => void run('打开云端作品', () => openCloud(item))}><span className="cloud-preview"><Grid2X2 size={25}/></span><div><strong>{item.name}</strong><span>{item.width} × {item.height} 格 · {formatTime(item.updatedAt)}</span></div></button><IconButton label={`重命名 ${item.name}`} disabled={!!busy} onClick={() => {
          const name = window.prompt('云端作品名称', item.name); if (name === null) return;
          void run('重命名', async () => { await request(`/works/${item.id}`, {method: 'PATCH', body: JSON.stringify({name: validateName(name), baseRevision: item.revision})}); await loadLibrary('cloud'); });
        }}><Pencil size={16}/></IconButton><IconButton label={`删除云端作品 ${item.name}`} disabled={!!busy} onClick={() => {
          if (window.confirm(`删除云端作品“${item.name}”？本机副本和下载文件会保留。`)) void run('删除云端作品', async () => {
            await request(`/works/${item.id}?baseRevision=${item.revision}`, {method: 'DELETE'});
            const local = workspace.current(); if (local.cloudRefs[user.id]?.id === item.id) { delete local.cloudRefs[user.id]; workspace.metadata(local); await workspace.flush(); }
            await loadLibrary('cloud');
          });
        }}><Trash2 size={17}/></IconButton></div>)}
        {tab === 'cloud' && user && !cloudWorks.length && <div className="empty-state"><Cloud size={30}/><p>暂无云端作品</p></div>}
      </div>{tab === 'cloud' && cursor && <button className="command secondary full" disabled={!!busy} onClick={() => void run('读取更多', () => loadLibrary('cloud', true))}>加载更多</button>}
    </Modal>}

    {conflict && <Modal title="作品有新版本" onClose={() => setConflict(null)}>
      <p className="conflict-description">云端作品已在其他设备更新。当前本机修改已保留。</p><div className="conflict-meta">云端版本 {conflict.remote.revision} · {formatTime(conflict.remote.updatedAt)}</div><ErrorText text={failure}/>
      <div className="conflict-actions"><button className="command primary" disabled={!!busy} onClick={() => {
        if (user?.id !== conflict.userId) return; void run('保存本机版本', () => saveCloud(user, false, conflict.remote.revision));
      }}>保留本机，更新云端</button><button className="command secondary" disabled={!!busy} onClick={() => void run('打开云端版本', async () => {
        if (!(await protect())) return;
        const r = conflict.remote, u = conflict.userId;
        workspace.replace({localKey: uuid(), document: cloudDocument(r), cloudRefs: {[u]: {userId: u, id: r.id, revision: r.revision, key: uuid(), savedContent: content(cloudDocument(r))}}});
        setConflict(null); setModal(null); setCloudStatus('已打开云端版本');
      })}>打开云端，保留本机副本</button><button className="command secondary" disabled={!!busy} onClick={() => { if (user?.id === conflict.userId) void run('另存副本', () => saveCloud(user, true)); }}>将本机另存为云端副本</button></div>
    </Modal>}
  </div>;
}
function ErrorText({text}: {text: string}) { return text ? <p className="form-error" role="alert">{text}</p> : null; }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}); }
