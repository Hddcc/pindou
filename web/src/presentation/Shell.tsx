import {useEffect, useMemo, useRef, useState, type ChangeEvent} from 'react';
import {ArrowRight, Cloud, FileImage, FileUp, Grid2X2, Home, ImagePlus, LayoutGrid, List, LoaderCircle, LogOut, MoreHorizontal, Pencil, Plus, Smartphone, Trash2, UserRound, X} from 'lucide-react';
import {blank, colorHex, nearestMardColors, parseDocument, validateName, type Document, type Snapshot} from '../domain/editor';
import {cloudDocument, content, request, type CloudWork, type Summary, type User} from '../infrastructure/api';
import {referenceImageData} from '../infrastructure/files';
import {listLocal, putLocal, removeLocal, uuid, type LocalWork} from '../infrastructure/local';
import EditorApp from './App';
import {Modal} from './Modal';
import './shell.css';

type Route = 'home' | 'works' | 'editor';

function routeFromHash(): Route {
  const route = window.location.hash.replace(/^#\/?/, '');
  return route === 'works' || route === 'editor' ? route : 'home';
}

function relativeTime(value: string) {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(value).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric'});
}

function workColors(snapshot: Snapshot) {
  return [...new Set(snapshot.cells.map(cell => colorHex(cell.colorCode)))].slice(0, 6);
}

function WorkPreview({snapshot, large = false}: {snapshot: Snapshot; large?: boolean}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const padding = large ? 18 : 10, size = (canvas.width - padding * 2) / Math.max(snapshot.width, snapshot.height);
    const width = snapshot.width * size, height = snapshot.height * size;
    const offsetX = (canvas.width - width) / 2, offsetY = (canvas.height - height) / 2;
    context.fillStyle = '#f1f4f1'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#dce3de';
    for (let y = 0; y < snapshot.height; y++) for (let x = 0; x < snapshot.width; x++) {
      context.beginPath(); context.arc(offsetX + (x + .5) * size, offsetY + (y + .5) * size, Math.max(.55, size * .16), 0, Math.PI * 2); context.fill();
    }
    snapshot.cells.forEach(cell => {
      context.fillStyle = colorHex(cell.colorCode);
      context.beginPath(); context.arc(offsetX + (cell.x + .5) * size, offsetY + (cell.y + .5) * size, Math.max(1.25, size * .42), 0, Math.PI * 2); context.fill();
    });
  }, [snapshot, large]);
  return <canvas ref={ref} width={large ? 360 : 160} height={large ? 360 : 160} className={`shell-work-preview${large ? ' is-large' : ''}`} aria-label="作品缩略图"/>;
}

async function imageDocument(file: File, size: number): Promise<Document> {
  if (file.size > 15 * 1024 * 1024) throw new Error('图片不能超过 15 MB');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new Error('当前浏览器无法处理图片');
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    context.clearRect(0, 0, size, size); context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    const pixels = context.getImageData(0, 0, size, size).data, cache = new Map<string, string>();
    const cells: Snapshot['cells'] = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      if (pixels[index + 3] < 32) continue;
      const hex = `#${[pixels[index], pixels[index + 1], pixels[index + 2]].map(value => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
      let code = cache.get(hex);
      if (!code) { code = nearestMardColors(hex)[0]?.code ?? hex; cache.set(hex, code); }
      cells.push({x, y, colorCode: code});
    }
    const rawName = file.name.replace(/\.[^.]+$/, '').trim() || '图片拼豆图';
    const result = blank(`${rawName.slice(0, 72)}拼豆图`, size, size); result.snapshot.cells = cells;
    return result;
  } finally { bitmap.close(); }
}

function newRecord(document: Document, referenceImage?: string): LocalWork { return {localKey: uuid(), document, cloudRefs: {}, referenceImage}; }

export default function Shell() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [returnRoute, setReturnRoute] = useState<Exclude<Route, 'editor'>>('home');
  const [localWorks, setLocalWorks] = useState<LocalWork[]>([]);
  const [cloudWorks, setCloudWorks] = useState<Summary[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [tab, setTab] = useState<'local' | 'cloud'>('local');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [size, setSize] = useState(29);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [moreKey, setMoreKey] = useState('');
  const importInput = useRef<HTMLInputElement>(null), imageInput = useRef<HTMLInputElement>(null);

  function navigate(next: Route) {
    const hash = next === 'home' ? '#/' : `#/${next}`;
    if (window.location.hash === hash) setRoute(next); else window.location.hash = hash;
  }

  useEffect(() => {
    const changed = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed);
  }, []);

  async function refreshLocal() { const items = await listLocal(); setLocalWorks(items); return items; }
  async function refreshCloud() {
    if (!user) { setCloudWorks([]); return; }
    const data = await request<{items: Summary[]; nextCursor: string | null}>('/works?limit=100'); setCloudWorks(data.items);
  }

  useEffect(() => {
    if (route === 'editor') return;
    let active = true;
    refreshLocal().catch(e => { if (active) setError((e as Error).message); });
    request<{user: User}>('/me').then(result => { if (active) setUser(result.user); }).catch(() => { if (active) setUser(null); });
    return () => { active = false; };
  }, [route]);

  useEffect(() => { if (route === 'works' && tab === 'cloud' && user) void refreshCloud().catch(e => setError((e as Error).message)); }, [route, tab, user]);
  useEffect(() => {
    if (!moreKey) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreKey(''); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [moreKey]);

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label); setError('');
    try { await task(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  function openAuth() { setError(''); setAuthOpen(true); }

  async function openEditor(work?: LocalWork) {
    if (work) await putLocal(work);
    setReturnRoute(route === 'works' ? 'works' : 'home'); navigate('editor');
  }

  function createBlank() { void run('正在创建画布', () => openEditor(newRecord(blank('未命名拼豆图', size, size)))); }

  function importWork(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    void run('正在导入作品', async () => {
      if (file.size > 3 * 1024 * 1024) throw new Error('作品文件超过 3 MB 上限');
      await openEditor(newRecord(parseDocument(await file.text())));
    });
  }

  function convertImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    void run('正在生成拼豆图', async () => {
      const [document, referenceImage] = await Promise.all([imageDocument(file, size), referenceImageData(file)]);
      await openEditor(newRecord(document, referenceImage));
    });
  }

  async function openCloud(item: Summary) {
    if (!user) return;
    const remote = await request<CloudWork>(`/works/${item.id}`), document = cloudDocument(remote);
    await openEditor({localKey: uuid(), document, cloudRefs: {[user.id]: {userId: user.id, id: remote.id, revision: remote.revision, key: uuid(), savedContent: content(document)}}});
  }

  async function renameLocal(work: LocalWork) {
    const value = window.prompt('作品名称', work.document.name); if (value === null) return;
    const next = {...work, document: {...work.document, name: validateName(value), updatedAt: new Date().toISOString()}};
    await putLocal(next); await refreshLocal(); setMoreKey('');
  }

  async function deleteLocal(work: LocalWork) {
    if (!window.confirm(`删除本机作品“${work.document.name}”？下载文件和云端副本会保留。`)) return;
    await removeLocal(work.localKey); await refreshLocal(); setMoreKey('');
  }

  async function renameCloud(work: Summary) {
    const value = window.prompt('云端作品名称', work.name); if (value === null) return;
    await request(`/works/${work.id}`, {method: 'PATCH', body: JSON.stringify({name: validateName(value), baseRevision: work.revision})});
    await refreshCloud(); setMoreKey('');
  }

  async function deleteCloud(work: Summary) {
    if (!window.confirm(`删除云端作品“${work.name}”？本机副本和下载文件会保留。`)) return;
    await request(`/works/${work.id}?baseRevision=${work.revision}`, {method: 'DELETE'}); await refreshCloud(); setMoreKey('');
  }

  const latest = localWorks[0];
  const activeWorks = tab === 'local' ? localWorks : cloudWorks;
  const activeColorCount = useMemo(() => latest ? new Set(latest.document.snapshot.cells.map(cell => cell.colorCode)).size : 0, [latest]);

  if (route === 'editor') return <EditorApp exitLabel={returnRoute === 'works' ? '返回作品' : '返回首页'} onExit={() => navigate(returnRoute)}/>;

  return <div className="site-shell">
    <ShellHeader route={route} user={user} onNavigate={navigate} onAccount={openAuth}/>
    <main className={`shell-main shell-${route}`}>
      {route === 'home' ? <>
        {latest && <section className="home-section continue-section">
          <SectionHeading title="最近编辑项目"/>
          <button className="continue-card" onClick={() => void run('正在打开作品', () => openEditor(latest))}>
            <div className="continue-preview"><WorkPreview snapshot={latest.document.snapshot} large/><span>{latest.document.snapshot.width} × {latest.document.snapshot.height}</span></div>
            <div className="continue-copy">
              <div className="continue-tags"><i aria-hidden="true"/><time>{relativeTime(latest.document.updatedAt)}保存</time></div>
              <div className="continue-summary"><h1>{latest.document.name}</h1><p>当前已放置 {latest.document.snapshot.cells.length.toLocaleString()} 颗拼豆。</p></div>
              <div className="continue-metrics"><span><small>色盘使用</small><strong>{activeColorCount} <em>种色号</em></strong></span><span><small>画布规格</small><strong>{latest.document.snapshot.width} × {latest.document.snapshot.height}</strong></span></div>
            </div>
            <span className="continue-action">继续绘制<ArrowRight size={18}/></span>
          </button>
        </section>}
        <section className="home-section start-section">
          <SectionHeading title="开始新的创作"/>
          <div className="creation-grid">
            <article className="creation-card blank-card">
              <div className="creation-title"><span className="creation-icon"><Grid2X2/></span><small>FREE_DRAW</small></div>
              <div><h2>空白画布</h2></div>
              <div className="size-picker" aria-label="选择图纸尺寸">{[16, 29, 50].map(value => <button key={value} className={size === value ? 'selected' : ''} onClick={() => setSize(value)}>{value} × {value}</button>)}</div>
              <button className="creation-button secondary" onClick={createBlank}>创建空白画布<Pencil size={17}/></button>
            </article>
            <article className="creation-card image-card">
              <div className="creation-title"><span className="creation-icon"><ImagePlus/></span><small>PALETTE_MAP</small></div>
              <div><h2>图片转拼豆</h2></div>
              <button className="image-drop" onClick={() => imageInput.current?.click()}><FileImage size={24}/><strong>选择或拖入本地图片</strong><small>PNG、JPG、WebP，最大 15 MB</small></button>
              <button className="creation-button primary" onClick={() => imageInput.current?.click()}>选择本地图像转换<ImagePlus size={17}/></button>
            </article>
          </div>
        </section>
      </> : <section className="works-section">
        <div className="works-heading"><div><p>ARCHIVE &amp; BLUEPRINTS / PEG.01 WORKBENCH</p><h1>作品库 <small>共 {activeWorks.length} 个作品</small></h1></div><div className="works-heading-actions"><button className="shell-button secondary" onClick={() => importInput.current?.click()}><FileUp size={18}/>导入图纸</button><button className="shell-button primary" onClick={createBlank}><Plus size={18}/>新建空白画布</button></div></div>
        <div className="works-toolbar"><div className="work-tabs"><button className={tab === 'local' ? 'selected' : ''} onClick={() => setTab('local')}><Smartphone size={18}/>本机 <span>{localWorks.length}</span></button><button className={tab === 'cloud' ? 'selected' : ''} onClick={() => setTab('cloud')}><Cloud size={18}/>云端同步 <span>{cloudWorks.length}</span></button></div><div className="view-toggle"><span>排序：最近编辑</span><button className={view === 'grid' ? 'selected' : ''} aria-label="网格视图" onClick={() => setView('grid')}><LayoutGrid size={18}/></button><button className={view === 'list' ? 'selected' : ''} aria-label="列表视图" onClick={() => setView('list')}><List size={18}/></button></div></div>
        {tab === 'cloud' && !user ? <div className="shell-empty"><Cloud size={34}/><h2>登录后查看云端作品</h2><p>本机作品会继续保留在当前浏览器。</p><button className="shell-button primary" onClick={openAuth}>登录 / 注册</button></div> : activeWorks.length ? <div className={`works-grid ${view === 'list' ? 'list-view' : ''}`}>
          {tab === 'local' ? localWorks.map(work => <LocalWorkCard key={work.localKey} work={work} open={() => void run('正在打开作品', () => openEditor(work))} more={moreKey === work.localKey} toggleMore={() => setMoreKey(moreKey === work.localKey ? '' : work.localKey)} rename={() => void run('正在重命名', () => renameLocal(work))} remove={() => void run('正在删除', () => deleteLocal(work))}/>) : cloudWorks.map(work => <CloudWorkCard key={work.id} work={work} open={() => void run('正在打开云端作品', () => openCloud(work))} more={moreKey === work.id} toggleMore={() => setMoreKey(moreKey === work.id ? '' : work.id)} rename={() => void run('正在重命名', () => renameCloud(work))} remove={() => void run('正在删除', () => deleteCloud(work))}/>) }
        </div> : <div className="shell-empty"><LayoutGrid size={34}/><h2>{tab === 'local' ? '还没有本机作品' : '还没有云端作品'}</h2><p>使用页面右上角的新建入口开始创作。</p></div>}
        <div className="storage-strip"><span><span className="storage-icon">□</span><span><strong>拼豆图纸工坊存储</strong><small>本机已缓存 {localWorks.length} 套作品，云端同步按账号隔离</small></span></span><span><small>作品数量</small><strong>{localWorks.length} / 100</strong></span></div>
      </section>}
    </main>
    <ShellFooter/>
    <ShellNav route={route} onNavigate={navigate}/>
    <input ref={importInput} className="shell-hidden-input" type="file" accept=".pindou,application/json" onChange={importWork}/>
    <input ref={imageInput} className="shell-hidden-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={convertImage}/>
    {busy && <div className="shell-busy" role="status"><LoaderCircle className="spin" size={18}/>{busy}</div>}
    {error && !authOpen && <div className="shell-error" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}><X size={17}/></button></div>}
    {moreKey && <button className="shell-menu-backdrop" aria-label="关闭作品菜单" onClick={() => setMoreKey('')}/>}
    {authOpen && <Modal title={user ? '我的账号' : '云端账号'} onClose={() => { setAuthOpen(false); setError(''); }}>
      {user ? <div className="account-view"><UserRound size={32}/><strong>{user.username}</strong><button className="command secondary" disabled={!!busy} onClick={() => void run('退出登录', async () => {
        await request('/auth/logout', {method: 'POST'}); setUser(null); setCloudWorks([]); setAuthOpen(false);
      })}><LogOut size={18}/>退出登录</button></div> : <>
        <div className="segmented"><button className={authMode === 'login' ? 'selected' : ''} onClick={() => setAuthMode('login')}>登录</button><button className={authMode === 'register' ? 'selected' : ''} onClick={() => setAuthMode('register')}>注册</button></div>
        <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void run(authMode === 'login' ? '登录' : '注册', async () => {
          const result = await request<{user: User}>(`/auth/${authMode}`, {method: 'POST', body: JSON.stringify({username: data.get('username'), password: data.get('password')})});
          setUser(result.user); setAuthOpen(false);
        }); }}>
          <label className="field">用户名<input name="username" pattern="[A-Za-z0-9_]{3,32}" minLength={3} maxLength={32} placeholder="3–32 位字母、数字、下划线" autoComplete="username" required/></label>
          <label className="field">密码<input name="password" type="password" minLength={8} maxLength={72} placeholder="8–72 个字符" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required/></label>
          {authMode === 'register' && <p className="privacy-note">云端保存作品名称、尺寸和色号，作品仅本人可见，可在“我的作品”中删除。当前版本暂不支持找回密码，请妥善保存密码。</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="command primary full" disabled={!!busy}>{busy ? <LoaderCircle size={18} className="spin"/> : <Cloud size={18}/>} {authMode === 'login' ? '登录' : '创建账号'}</button>
        </form>
      </>}
    </Modal>}
  </div>;
}

function ShellHeader({route, user, onNavigate, onAccount}: {route: Route; user: User | null; onNavigate: (route: Route) => void; onAccount: () => void}) {
  return <header className="shell-header"><div className="shell-header-inner">
    <button className="shell-brand" onClick={() => onNavigate('home')}><img src="/icons/laopai-192.png" alt=""/><span>老派拼豆之必要<small>{route === 'works' ? 'ARTWORKS' : 'HOME'}</small></span></button>
    <nav className="shell-desktop-nav" aria-label="主导航"><button className={route === 'home' ? 'selected' : ''} onClick={() => onNavigate('home')}>首页</button><button className={route === 'works' ? 'selected' : ''} onClick={() => onNavigate('works')}>作品</button></nav>
    <div className="shell-account"><button aria-label={user ? `账号：${user.username}` : '登录 / 注册'} onClick={onAccount}>{user ? <img src="/shell-avatar.png" alt=""/> : <UserRound size={20}/>}</button></div>
  </div></header>;
}

function ShellNav({route, onNavigate}: {route: Route; onNavigate: (route: Route) => void}) {
  return <nav className="shell-bottom-nav" aria-label="主导航"><button className={route === 'home' ? 'selected' : ''} onClick={() => onNavigate('home')}><Home size={20}/>首页</button><button className={route === 'works' ? 'selected' : ''} onClick={() => onNavigate('works')}><LayoutGrid size={20}/>作品</button></nav>;
}

function ShellFooter() { return <footer className="shell-footer"><span><strong>老派拼豆之必要</strong> · 慢工出细活的像素拼豆工作台</span><span>色板索引　 图纸规格　 关于工坊</span></footer>; }
function SectionHeading({title}: {title: string}) { return <div className="section-heading"><h2><i/>{title}</h2></div>; }
function BeadSwatches({colors}: {colors: string[]}) { return <span className="bead-swatches">{colors.map((color, index) => <i key={`${color}-${index}`} style={{background: color}}/>)}<small>+{Math.max(0, 65 - colors.length)} 色</small></span>; }

type WorkCardProps = {open: () => void; more: boolean; toggleMore: () => void; rename: () => void; remove: () => void};
function WorkMenu({open, rename, remove}: {open: boolean; rename: () => void; remove: () => void}) { return open ? <div className="work-menu"><button onClick={rename}><Pencil size={15}/>重命名</button><button className="danger" onClick={remove}><Trash2 size={15}/>删除</button></div> : null; }
function LocalWorkCard({work, open, more, toggleMore, rename, remove}: {work: LocalWork} & WorkCardProps) {
  const colors = workColors(work.document.snapshot);
  return <article className="work-card"><button className="work-card-open" onClick={open}><div className="work-card-preview"><WorkPreview snapshot={work.document.snapshot}/></div><div className="work-card-copy"><span><strong>{work.document.name}</strong><time>{relativeTime(work.document.updatedAt)}</time></span><small>{work.document.snapshot.width} × {work.document.snapshot.height} · {new Set(work.document.snapshot.cells.map(cell => cell.colorCode)).size} 种拼豆颜色</small><BeadSwatches colors={colors}/></div></button><div className="work-more"><button aria-label={`管理作品 ${work.document.name}`} onClick={toggleMore}><MoreHorizontal size={20}/></button><WorkMenu open={more} rename={rename} remove={remove}/></div></article>;
}
function CloudWorkCard({work, open, more, toggleMore, rename, remove}: {work: Summary} & WorkCardProps) {
  return <article className="work-card cloud-card"><button className="work-card-open" onClick={open}><div className="work-card-preview cloud-placeholder"><Cloud size={30}/></div><div className="work-card-copy"><span><strong>{work.name}</strong><time>{relativeTime(work.updatedAt)}</time></span><small>{work.width} × {work.height} · 云端版本 {work.revision}</small><span className="cloud-label"><Cloud size={14}/>已同步</span></div></button><div className="work-more"><button aria-label={`管理作品 ${work.name}`} onClick={toggleMore}><MoreHorizontal size={20}/></button><WorkMenu open={more} rename={rename} remove={remove}/></div></article>;
}
