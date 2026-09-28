import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent} from 'react';
import {EyeOff, GripHorizontal, ImagePlus, Maximize, ZoomIn, ZoomOut} from 'lucide-react';

type Point = {x: number; y: number};
type Gesture =
  | {kind: 'pan'; pointerId: number; start: Point; offset: Point}
  | {kind: 'pinch'; distance: number; midpoint: Point; scale: number; offset: Point};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});

export function ReferenceImagePanel({src, visible, onReplace, onHide}: {src: string; visible: boolean; onReplace: () => void; onHide: () => void}) {
  const panel = useRef<HTMLElement>(null), stage = useRef<HTMLDivElement>(null);
  const panelDrag = useRef<{pointerId: number; start: Point; position: Point} | null>(null);
  const pointers = useRef(new Map<number, Point>()), gesture = useRef<Gesture | null>(null);
  const scaleValue = useRef(1), offsetValue = useRef<Point>({x: 0, y: 0});
  const [position, setPosition] = useState<Point>(() => ({x: Math.max(12, window.innerWidth - 380), y: 88}));
  const [scale, setScale] = useState(1), [offset, setOffset] = useState<Point>({x: 0, y: 0});

  function keepPanelInView(next: Point) {
    const bounds = panel.current?.getBoundingClientRect();
    const width = bounds?.width ?? Math.min(360, window.innerWidth - 24), height = bounds?.height ?? 340;
    return {x: clamp(next.x, 8, Math.max(8, window.innerWidth - width - 8)), y: clamp(next.y, 8, Math.max(8, window.innerHeight - height - 8))};
  }
  function limitOffset(next: Point, nextScale: number) {
    const bounds = stage.current?.getBoundingClientRect();
    if (!bounds || nextScale <= 1) return {x: 0, y: 0};
    return {x: clamp(next.x, -bounds.width * (nextScale - 1) / 2, bounds.width * (nextScale - 1) / 2),
      y: clamp(next.y, -bounds.height * (nextScale - 1) / 2, bounds.height * (nextScale - 1) / 2)};
  }
  function applyTransform(nextScale: number, nextOffset: Point) {
    const normalizedScale = clamp(nextScale, 1, 5), normalizedOffset = limitOffset(nextOffset, normalizedScale);
    scaleValue.current = normalizedScale; offsetValue.current = normalizedOffset;
    setScale(normalizedScale); setOffset(normalizedOffset);
  }
  function resetView() { applyTransform(1, {x: 0, y: 0}); }
  function zoomTo(nextScale: number, anchor?: Point) {
    const bounds = stage.current?.getBoundingClientRect(), currentScale = scaleValue.current;
    const normalizedScale = clamp(nextScale, 1, 5);
    if (!bounds || normalizedScale === currentScale) return;
    const point = anchor ?? {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2};
    const local = {x: point.x - bounds.left - bounds.width / 2, y: point.y - bounds.top - bounds.height / 2}, ratio = normalizedScale / currentScale;
    applyTransform(normalizedScale, {x: local.x - (local.x - offsetValue.current.x) * ratio, y: local.y - (local.y - offsetValue.current.y) * ratio});
  }

  useEffect(resetView, [src]);
  useEffect(() => {
    if (visible) setPosition(current => keepPanelInView(current));
  }, [visible]);
  useEffect(() => {
    const resized = () => setPosition(current => keepPanelInView(current));
    window.addEventListener('resize', resized); return () => window.removeEventListener('resize', resized);
  }, []);

  function startPanelDrag(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panelDrag.current = {pointerId: event.pointerId, start: {x: event.clientX, y: event.clientY}, position};
  }
  function movePanel(event: ReactPointerEvent<HTMLElement>) {
    const drag = panelDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(keepPanelInView({x: drag.position.x + event.clientX - drag.start.x, y: drag.position.y + event.clientY - drag.start.y}));
  }
  function endPanelDrag(event: ReactPointerEvent<HTMLElement>) {
    if (panelDrag.current?.pointerId === event.pointerId) panelDrag.current = null;
  }
  function beginImageGesture(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
    const active = [...pointers.current.entries()];
    if (active.length >= 2) {
      const a = active[0][1], b = active[1][1];
      gesture.current = {kind: 'pinch', distance: Math.max(1, distance(a, b)), midpoint: midpoint(a, b), scale: scaleValue.current, offset: offsetValue.current};
    } else gesture.current = {kind: 'pan', pointerId: event.pointerId, start: {x: event.clientX, y: event.clientY}, offset: offsetValue.current};
  }
  function moveImage(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    event.preventDefault(); pointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
    const active = [...pointers.current.values()], current = gesture.current;
    if (active.length >= 2 && current?.kind === 'pinch') {
      const nextMidpoint = midpoint(active[0], active[1]), nextScale = clamp(current.scale * distance(active[0], active[1]) / current.distance, 1, 5);
      const ratio = nextScale / current.scale;
      applyTransform(nextScale, {x: nextMidpoint.x - current.midpoint.x + current.offset.x * ratio, y: nextMidpoint.y - current.midpoint.y + current.offset.y * ratio});
    } else if (active.length === 1 && current?.kind === 'pan' && current.pointerId === event.pointerId)
      applyTransform(scaleValue.current, {x: current.offset.x + event.clientX - current.start.x, y: current.offset.y + event.clientY - current.start.y});
  }
  function endImageGesture(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    const remaining = [...pointers.current.entries()];
    gesture.current = remaining.length === 1 ? {kind: 'pan', pointerId: remaining[0][0], start: remaining[0][1], offset: offsetValue.current} : null;
  }
  function wheelImage(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault(); zoomTo(scaleValue.current * (event.deltaY < 0 ? 1.15 : 1 / 1.15), {x: event.clientX, y: event.clientY});
  }

  return <section ref={panel} className="reference-panel" aria-label="参考图窗口" hidden={!visible} style={{left: position.x, top: position.y}}>
    <header className="reference-panel-heading" onPointerDown={startPanelDrag} onPointerMove={movePanel} onPointerUp={endPanelDrag} onPointerCancel={endPanelDrag}>
      <span><GripHorizontal size={17}/><strong>参考图</strong></span>
      <div><button className="icon-button" aria-label="更换参考图" title="更换参考图" onClick={onReplace}><ImagePlus size={18}/></button><button className="icon-button" aria-label="隐藏参考图" title="隐藏参考图" onClick={onHide}><EyeOff size={18}/></button></div>
    </header>
    <div ref={stage} className="reference-image-stage" aria-label="参考图查看区域" onPointerDown={beginImageGesture} onPointerMove={moveImage} onPointerUp={endImageGesture} onPointerCancel={endImageGesture} onWheel={wheelImage}>
      <img src={src} alt="当前参考图" draggable={false} style={{transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`}}/>
    </div>
    <footer className="reference-image-controls">
      <button className="icon-button" aria-label="缩小参考图" title="缩小参考图" disabled={scale <= 1} onClick={() => zoomTo(scaleValue.current / 1.25)}><ZoomOut size={17}/></button>
      <button className="reference-scale" aria-label="重置参考图缩放" title="重置参考图缩放" onClick={resetView}>{Math.round(scale * 100)}%</button>
      <button className="icon-button" aria-label="放大参考图" title="放大参考图" disabled={scale >= 5} onClick={() => zoomTo(scaleValue.current * 1.25)}><ZoomIn size={17}/></button>
      <button className="icon-button" aria-label="适配参考图" title="适配参考图" onClick={resetView}><Maximize size={17}/></button>
    </footer>
  </section>;
}
