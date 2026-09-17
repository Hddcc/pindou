import {forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState} from 'react';
import {cellColorLabels, colorHex, erasedBoundary, readableText, type Editor, type GridSettings, type Selection, type Tool} from '../domain/editor';

type Point = {x: number; y: number};
type View = Point & {size: number};
export type BoardHandle = {fit: () => void; zoom: (factor: number) => void; actual: () => void};
type Props = {editor: Editor; tool: Tool; beadMode: boolean; filter: string | null; selection: Selection | null; onSelection: (value: Selection | null) => void; color: string; eraserSize: number; settings: GridSettings; version: number; onChange: () => void; onPick: (code: string) => void; onZoom: (n: number) => void};

export const Board = forwardRef<BoardHandle, Props>(function Board({editor, tool: drawingTool, beadMode, filter, selection, onSelection, color, eraserSize, settings, version, onChange, onPick, onZoom}, ref) {
  const tool = beadMode ? 'pan' : drawingTool;
  const canvas = useRef<HTMLCanvasElement>(null), host = useRef<HTMLDivElement>(null);
  const view = useRef<View>({x: 0, y: 0, size: 12}), dimensions = useRef({width: 0, height: 0});
  const pointers = useRef(new Map<number, Point>()), last = useRef<Point | null>(null);
  const multi = useRef(false), gesture = useRef<{center: Point; distance: number; view: View} | null>(null);
  const action = useRef<Tool>('paint'), hover = useRef<Point | null>(null);
  const selectionGesture = useRef<{start: Point; original: Selection | null; moving: boolean; preview: Selection | null} | null>(null);
  const [frame, redraw] = useState(0);
  function fit() {
    const {width, height} = dimensions.current;
    const size = Math.max(.8, Math.min(24, (width - 72) / editor.width, (height - 72) / editor.height));
    view.current = {size, x: (width - editor.width * size) / 2, y: (height - editor.height * size) / 2};
    onZoom(Math.round(size / 20 * 100)); redraw(v => v + 1);
  }
  function zoom(factor: number, at = {x: dimensions.current.width / 2, y: dimensions.current.height / 2}) {
    const v = view.current, size = Math.min(80, Math.max(.8, v.size * factor)), f = size / v.size;
    view.current = {size, x: at.x - (at.x - v.x) * f, y: at.y - (at.y - v.y) * f};
    onZoom(Math.round(size / 20 * 100)); redraw(n => n + 1);
  }
  useImperativeHandle(ref, () => ({fit, zoom, actual: () => zoom(20 / view.current.size)}));
  useLayoutEffect(() => {
    const el = host.current!;
    const observer = new ResizeObserver(([entry]) => {
      const {width, height} = entry.contentRect, previous = dimensions.current;
      dimensions.current = {width, height};
      if (previous.width === 0) fit();
      else { view.current.x += (width - previous.width) / 2; view.current.y += (height - previous.height) / 2; redraw(n => n + 1); }
    });
    observer.observe(el); return () => observer.disconnect();
  // Each new editor gets a fresh viewport.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
  useEffect(() => {
    editor.cancelStroke(); pointers.current.clear(); last.current = null; multi.current = false; gesture.current = null; hover.current = null;
    if (selectionGesture.current) onSelection(selectionGesture.current.original);
    selectionGesture.current = null;
    redraw(n => n + 1);
  // Cancel interrupted gestures without committing document changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, beadMode, drawingTool]);
  useEffect(() => {
    fit();
    return () => { editor.cancelStroke(); pointers.current.clear(); gesture.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
  useLayoutEffect(() => {
    const c = canvas.current!;
    const {width, height} = dimensions.current, dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr); c.height = Math.round(height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e8ecea'; ctx.fillRect(0, 0, width, height);
    const ruler = 26;
    ctx.save(); ctx.beginPath(); ctx.rect(ruler, ruler, Math.max(0, width - ruler * 2), Math.max(0, height - ruler * 2)); ctx.clip();
    const v = view.current, bw = editor.width * v.size, bh = editor.height * v.size;
    const x0 = Math.max(0, Math.floor(-v.x / v.size)), y0 = Math.max(0, Math.floor(-v.y / v.size));
    const x1 = Math.min(editor.width, Math.ceil((width - v.x) / v.size)), y1 = Math.min(editor.height, Math.ceil((height - v.y) / v.size));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const stored = editor.get(x, y), code = beadMode && filter && stored !== filter ? undefined : stored;
      ctx.fillStyle = code ? colorHex(code) : (x + y) % 2 ? '#F1F3F2' : '#FFFFFF';
      ctx.fillRect(v.x + x * v.size, v.y + y * v.size, v.size, v.size);
    }
    const gridColor = (opacity: number) => `rgba(87, 101, 94, ${opacity / 100})`;
    function gridLines(every: number, style: 'solid' | 'dashed', stroke: string, lineWidth: number) {
      ctx.save(); ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth;
      ctx.setLineDash(style === 'dashed' ? [Math.max(2, v.size * .24), Math.max(2, v.size * .18)] : []); ctx.beginPath();
      for (let x = x0; x <= x1; x++) if (every === 1 || x % every === 0) {
        const px = v.x + x * v.size; ctx.moveTo(px, Math.max(0, v.y)); ctx.lineTo(px, Math.min(height, v.y + bh));
      }
      for (let y = y0; y <= y1; y++) if (every === 1 || y % every === 0) {
        const py = v.y + y * v.size; ctx.moveTo(Math.max(0, v.x), py); ctx.lineTo(Math.min(width, v.x + bw), py);
      }
      ctx.stroke(); ctx.restore();
    }
    if (v.size >= 2) gridLines(1, settings.gridStyle, gridColor(settings.gridOpacity), .65);
    gridLines(settings.guideEvery, settings.guideStyle, gridColor(settings.guideOpacity), 1.35);
    ctx.strokeStyle = gridColor(Math.max(72, settings.guideOpacity)); ctx.lineWidth = 1.2; ctx.strokeRect(v.x, v.y, bw, bh);
    if (settings.centerLine) {
      ctx.save(); ctx.strokeStyle = settings.centerColor; ctx.globalAlpha = .82; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.beginPath();
      ctx.moveTo(v.x + bw / 2, Math.max(0, v.y)); ctx.lineTo(v.x + bw / 2, Math.min(height, v.y + bh));
      ctx.moveTo(Math.max(0, v.x), v.y + bh / 2); ctx.lineTo(Math.min(width, v.x + bw), v.y + bh / 2); ctx.stroke(); ctx.restore();
    }
    if (settings.showCodes && v.size >= 3) {
      const fontSize = Math.min(10, v.size * .38); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${fontSize}px system-ui`;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const code = editor.get(x, y); if (!code || (beadMode && filter && code !== filter)) continue;
        const labels = cellColorLabels(code), labelSize = code.startsWith('#') ? Math.min(10, v.size * .34) : fontSize;
        ctx.font = `600 ${labelSize}px system-ui`; ctx.fillStyle = readableText(code);
        labels.forEach((label, index) => ctx.fillText(label, v.x + (x + .5) * v.size,
          v.y + (y + .5) * v.size + (index - (labels.length - 1) / 2) * labelSize * 1.15, Math.max(1, v.size - Math.min(3, v.size * .12))));
      }
    }
    const activeSelection = selectionGesture.current?.preview ?? selection;
    if (activeSelection && !beadMode) {
      const moving = selectionGesture.current?.moving, original = selectionGesture.current?.original;
      if (moving && original) {
        ctx.fillStyle = 'rgba(255, 255, 255, .75)'; ctx.fillRect(v.x + original.x * v.size, v.y + original.y * v.size, original.width * v.size, original.height * v.size);
        editor.cells.forEach((code, key) => {
          const x = key % editor.width, y = Math.floor(key / editor.width);
          if (x >= original.x && x < original.x + original.width && y >= original.y && y < original.y + original.height) {
            ctx.fillStyle = colorHex(code); ctx.fillRect(v.x + (x + activeSelection.x - original.x) * v.size, v.y + (y + activeSelection.y - original.y) * v.size, v.size, v.size);
          }
        });
      }
      ctx.save(); ctx.strokeStyle = '#416AA2'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(v.x + activeSelection.x * v.size, v.y + activeSelection.y * v.size, activeSelection.width * v.size, activeSelection.height * v.size); ctx.restore();
    }
    if (!beadMode && editor.lastErased.size) {
      ctx.save(); ctx.beginPath();
      for (const edge of erasedBoundary(editor.lastErased, editor.width)) {
        ctx.moveTo(v.x + edge.from.x * v.size, v.y + edge.from.y * v.size);
        ctx.lineTo(v.x + edge.to.x * v.size, v.y + edge.to.y * v.size);
      }
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#416AA2'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.restore();
    }
    if (hover.current && tool !== 'pan' && tool !== 'select') {
      const h = hover.current, brush = tool === 'erase' ? eraserSize : 1, offset = Math.floor(brush / 2);
      const left = Math.max(0, h.x - offset), top = Math.max(0, h.y - offset);
      const right = Math.min(editor.width, h.x - offset + brush), bottom = Math.min(editor.height, h.y - offset + brush);
      ctx.strokeStyle = tool === 'erase' ? '#B54444' : '#16705B'; ctx.lineWidth = 2;
      ctx.strokeRect(v.x + left * v.size + 1, v.y + top * v.size + 1, (right - left) * v.size - 2, (bottom - top) * v.size - 2);
    }
    ctx.restore();
    ctx.fillStyle = '#FAFBFA';
    ctx.fillRect(0, 0, width, ruler); ctx.fillRect(0, height - ruler, width, ruler);
    ctx.fillRect(0, ruler, ruler, height - ruler * 2); ctx.fillRect(width - ruler, ruler, ruler, height - ruler * 2);
    ctx.font = `600 ${Math.max(5, Math.min(11, v.size * .43))}px system-ui`; ctx.fillStyle = '#43564D'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let x = x0; x < x1; x++) {
      const px = v.x + (x + .5) * v.size;
      if (px < ruler || px > width - ruler) continue;
      ctx.fillText(String(x + 1), px, ruler / 2, Math.max(1, v.size - 1)); ctx.fillText(String(x + 1), px, height - ruler / 2, Math.max(1, v.size - 1));
    }
    for (let y = y0; y < y1; y++) {
      const py = v.y + (y + .5) * v.size;
      if (py < ruler || py > height - ruler) continue;
      ctx.fillText(String(y + 1), ruler / 2, py, ruler - 4); ctx.fillText(String(y + 1), width - ruler / 2, py, ruler - 4);
    }
  }, [editor, tool, beadMode, filter, selection, eraserSize, settings, version, frame]);
  useEffect(() => {
    const c = canvas.current!;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const r = c.getBoundingClientRect(); zoom(e.deltaY > 0 ? .9 : 1.1, {x: e.clientX - r.left, y: e.clientY - r.top}); };
    c.addEventListener('wheel', wheel, {passive: false}); return () => c.removeEventListener('wheel', wheel);
  });
  function point(e: React.PointerEvent): Point { const r = canvas.current!.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; }
  function cell(p: Point): Point | null {
    if (p.x < 26 || p.y < 26 || p.x >= dimensions.current.width - 26 || p.y >= dimensions.current.height - 26) return null;
    const v = view.current, x = Math.floor((p.x - v.x) / v.size), y = Math.floor((p.y - v.y) / v.size);
    return x >= 0 && y >= 0 && x < editor.width && y < editor.height ? {x, y} : null;
  }
  function rawCell(p: Point) { const v = view.current; return {x: Math.floor((p.x - v.x) / v.size), y: Math.floor((p.y - v.y) / v.size)}; }
  function metrics() {
    const [a, b] = [...pointers.current.values()];
    return {center: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))};
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    e.preventDefault(); canvas.current!.setPointerCapture(e.pointerId);
    const p = point(e); pointers.current.set(e.pointerId, p);
    if (pointers.current.size >= 2) {
      editor.cancelStroke(); multi.current = true; last.current = null;
      if (selectionGesture.current) onSelection(selectionGesture.current.original);
      selectionGesture.current = null;
      gesture.current = {...metrics(), view: {...view.current}}; redraw(n => n + 1); return;
    }
    multi.current = false; action.current = e.button === 1 ? 'pan' : tool;
    last.current = action.current === 'pan' ? p : cell(p);
    if (action.current === 'select' && last.current) {
      const start = last.current, moving = !!selection && start.x >= selection.x && start.x < selection.x + selection.width && start.y >= selection.y && start.y < selection.y + selection.height;
      const preview = moving ? selection : {x: start.x, y: start.y, width: 1, height: 1};
      selectionGesture.current = {start, original: selection, moving, preview};
      if (!moving) onSelection(preview);
      redraw(n => n + 1);
    }
    if (last.current && ['paint', 'erase'].includes(action.current)) {
      editor.paintBrush(last.current.x, last.current.y, action.current === 'erase' ? eraserSize : 1, action.current === 'erase' ? undefined : color); redraw(n => n + 1);
    }
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = point(e); hover.current = cell(p);
    if (!pointers.current.has(e.pointerId)) { redraw(n => n + 1); return; }
    pointers.current.set(e.pointerId, p);
    if (multi.current) {
      if (pointers.current.size >= 2 && gesture.current) {
        const m = metrics(), g = gesture.current, size = Math.max(.8, Math.min(80, g.view.size * m.distance / g.distance)), f = size / g.view.size;
        view.current = {size, x: m.center.x - (g.center.x - g.view.x) * f, y: m.center.y - (g.center.y - g.view.y) * f}; onZoom(Math.round(size / 20 * 100));
      }
    } else if (action.current === 'pan' && last.current) {
      view.current.x += p.x - last.current.x; view.current.y += p.y - last.current.y; last.current = p;
    } else if (action.current === 'select' && selectionGesture.current) {
      const g = selectionGesture.current, target = rawCell(p);
      if (g.moving && g.original) {
        g.preview = {...g.original, x: Math.max(0, Math.min(editor.width - g.original.width, g.original.x + target.x - g.start.x)), y: Math.max(0, Math.min(editor.height - g.original.height, g.original.y + target.y - g.start.y))};
      } else {
        const x = Math.max(0, Math.min(editor.width - 1, target.x)), y = Math.max(0, Math.min(editor.height - 1, target.y));
        g.preview = {x: Math.min(x, g.start.x), y: Math.min(y, g.start.y), width: Math.abs(x - g.start.x) + 1, height: Math.abs(y - g.start.y) + 1};
        onSelection(g.preview);
      }
    } else if (['paint', 'erase'].includes(action.current)) {
      const next = cell(p);
      if (next) editor.brushLine(last.current ?? next, next, action.current === 'erase' ? eraserSize : 1, action.current === 'erase' ? undefined : color);
      last.current = next;
    }
    redraw(n => n + 1);
  }
  function up(e: React.PointerEvent<HTMLCanvasElement>, cancel = false) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (multi.current) {
      if (pointers.current.size >= 2) gesture.current = {...metrics(), view: {...view.current}};
      if (!pointers.current.size) { multi.current = false; gesture.current = null; }
      return;
    }
    if (action.current === 'select' && selectionGesture.current) {
      const g = selectionGesture.current;
      if (cancel) onSelection(g.original);
      else if (g.moving && g.original && g.preview) {
        if (editor.moveRegion(g.original, g.preview.x - g.original.x, g.preview.y - g.original.y)) onChange();
        onSelection(g.preview);
      } else onSelection(g.preview);
      selectionGesture.current = null;
    }
    else if (cancel) editor.cancelStroke();
    else if (['paint', 'erase'].includes(action.current)) { if (editor.endStroke(action.current === 'erase' ? 'erase' : 'edit')) onChange(); }
    else {
      const target = cell(point(e));
      if (target && action.current === 'fill' && editor.fill(target.x, target.y, color)) onChange();
      if (target && action.current === 'pick') { const code = editor.get(target.x, target.y); if (code) onPick(code); }
    }
    if (e.pointerType !== 'mouse' || action.current === 'erase') hover.current = null;
    last.current = null; redraw(n => n + 1);
  }
  return <div className="board-host" ref={host}>
    <canvas ref={canvas} aria-label={`拼豆画布 ${editor.width} × ${editor.height}`} data-testid="board" className={`board tool-${tool}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={e => up(e)} onPointerCancel={e => up(e, true)}
      onPointerLeave={() => { hover.current = null; redraw(n => n + 1); }} onContextMenu={e => e.preventDefault()}/>
  </div>;
});
