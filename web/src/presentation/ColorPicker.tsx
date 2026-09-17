import {useRef, useState, type ChangeEvent, type PointerEvent} from 'react';
import {Check, ImagePlus, Pipette} from 'lucide-react';
import {colors, displayColorCode, nearestMardColors, normalizeHex} from '../domain/editor';

type EyeDropperConstructor = new () => {open: () => Promise<{sRGBHex: string}>};

export function ColorPicker({initial, onApply, onPrepareNativePicker}: {initial: string; onApply: (code: string) => void; onPrepareNativePicker: () => void}) {
  const [hex, setHex] = useState(initial), [error, setError] = useState(''), [imageReady, setImageReady] = useState(false), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), file = useRef<HTMLInputElement>(null);
  const sourceImage = useRef<HTMLImageElement | null>(null);
  const normalized = normalizeHex(hex), matched = colors.find(c => c.active && c.hex.toUpperCase() === normalized);
  const originalCode = matched?.code ?? normalized, code = selected ?? originalCode;
  const recommendations = normalized ? nearestMardColors(normalized) : [];
  const rgb = [1, 3, 5].map(i => normalized ? parseInt(normalized.slice(i, i + 2), 16) : 0);
  const EyeDropper = (window as Window & {EyeDropper?: EyeDropperConstructor}).EyeDropper;
  function updateHex(value: string) { setHex(value); setSelected(null); }
  async function screenPick() {
    if (!EyeDropper) return;
    setError(''); setBusy(true);
    try { const result = await new EyeDropper().open(); updateHex(normalizeHex(result.sRGBHex) ?? initial); }
    catch (e) { if ((e as Error).name !== 'AbortError') setError('屏幕取色失败，请尝试从图片取色'); }
    finally { setBusy(false); }
  }
  async function loadImage(e: ChangeEvent<HTMLInputElement>) {
    const imageFile = e.target.files?.[0]; e.target.value = '';
    if (!imageFile) return;
    setError(''); setBusy(true);
    const url = URL.createObjectURL(imageFile);
    try {
      if (imageFile.size > 20 * 1024 * 1024) throw new Error('请选择小于 20 MiB 的图片');
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('图片无法读取，请选择 PNG、JPEG 或 WebP')); image.src = url; });
      if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片分辨率过大，请使用截图或较小的图片');
      const target = canvas.current;
      if (!target) return;
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      target.width = Math.max(1, Math.round(image.naturalWidth * scale)); target.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = target.getContext('2d', {willReadFrequently: true});
      if (!context) throw new Error('当前浏览器无法读取图片颜色');
      context.drawImage(image, 0, 0, target.width, target.height); sourceImage.current = image; setImageReady(true);
    } catch (e) { setError((e as Error).message); }
    finally { URL.revokeObjectURL(url); setBusy(false); }
  }
  function imagePick(e: PointerEvent<HTMLCanvasElement>) {
    if (!imageReady || busy) return;
    e.preventDefault();
    const target = canvas.current!, bounds = target.getBoundingClientRect(), source = sourceImage.current;
    if (!source) return;
    const x = Math.max(0, Math.min(source.naturalWidth - 1, Math.floor((e.clientX - bounds.left) * source.naturalWidth / bounds.width)));
    const y = Math.max(0, Math.min(source.naturalHeight - 1, Math.floor((e.clientY - bounds.top) * source.naturalHeight / bounds.height)));
    const sample = document.createElement('canvas'); sample.width = 1; sample.height = 1;
    const ctx = sample.getContext('2d', {willReadFrequently: true})!;
    ctx.drawImage(source, x, y, 1, 1, 0, 0, 1, 1);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    if (!pixel[3]) { setError('该位置为透明像素，请选择有颜色的区域'); return; }
    setError(''); updateHex(`#${[pixel[0], pixel[1], pixel[2]].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`);
  }
  return <div className="color-picker">
    <div className="picker-sources">
      <button className="command secondary" disabled={!EyeDropper || busy} title={EyeDropper ? '从屏幕选择颜色' : '当前浏览器不支持屏幕取色，可从图片取色'} onClick={() => void screenPick()}><Pipette size={18}/>屏幕取色</button>
      <button className="command secondary" disabled={busy} onClick={() => { onPrepareNativePicker(); file.current?.click(); }}><ImagePlus size={18}/>从图片取色</button>
    </div>
    <input ref={file} className="hidden-input" type="file" accept="image/*" aria-label="选择取色图片" onChange={e => void loadImage(e)}/>
    <div className={`picker-image ${imageReady ? 'ready' : ''}`}><canvas ref={canvas} aria-label="图片取色画布" onPointerDown={imagePick}/></div>
    <button className={`picker-result ${selected === null ? 'selected' : ''}`} aria-label="使用原始颜色" aria-pressed={selected === null} disabled={!normalized || busy} onClick={() => setSelected(null)}><span style={{background: normalized ?? 'transparent'}}/><div><small>原始颜色</small><strong>{normalized ? displayColorCode(normalized) : '颜色值无效'}</strong><small>{normalized ?? '请输入有效的 HEX'}</small></div>{selected === null && <Check size={18}/>}</button>
    <label className="field">HEX<input aria-label="HEX 颜色" value={hex} maxLength={7} onChange={e => updateHex(e.target.value)} placeholder="#RRGGBB" autoComplete="off" spellCheck={false}/></label>
    <div className="rgb-inputs">{['R', 'G', 'B'].map((channel, index) => <label key={channel} className="field">{channel}<input aria-label={`${channel} 颜色通道`} type="number" min={0} max={255} step={1} value={rgb[index]} onChange={e => {
      const next = [...rgb]; next[index] = Math.min(255, Math.max(0, Math.round(Number(e.target.value))));
      updateHex(`#${next.map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`);
    }}/></label>)}</div>
    {recommendations.length > 0 && <div className="picker-recommendations"><h3>相近 MARD291 颜色</h3><div>{recommendations.map(c => <button key={c.code} className={`recommended-color ${selected === c.code ? 'selected' : ''}`} title={`${displayColorCode(c.code)} · ${c.hex}`} aria-label={`推荐颜色 ${displayColorCode(c.code)}`} aria-pressed={selected === c.code} disabled={busy} onClick={() => setSelected(c.code)}><span style={{background: c.hex}}/><strong>{displayColorCode(c.code)}</strong><small>{c.hex}</small>{selected === c.code && <Check size={14}/>}</button>)}</div></div>}
    <div className="picker-selection">当前选择<strong>{code ? displayColorCode(code) : '颜色值无效'}</strong></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="command primary full" disabled={!code || busy} onClick={() => { if (code) onApply(code); }}><Check size={18}/>使用此颜色</button>
  </div>;
}
