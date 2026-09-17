import {differenceCiede2000} from 'culori';
import palette from '../data/mard291.json';

export type Color = {code: string; name: string; hex: string; sortOrder: number; active: boolean};
export const colors: Color[] = palette;
export const colorMap = new Map(colors.map(c => [c.code, c]));
export type GridLineStyle = 'solid' | 'dashed';
export type GridSettings = {
  guideEvery: 5 | 10;
  gridStyle: GridLineStyle;
  guideStyle: GridLineStyle;
  gridOpacity: number;
  guideOpacity: number;
  centerLine: boolean;
  centerColor: string;
  showCodes: boolean;
};
export const DEFAULT_GRID_SETTINGS: GridSettings = {
  guideEvery: 5, gridStyle: 'solid', guideStyle: 'solid', gridOpacity: 32, guideOpacity: 68, centerLine: true, centerColor: '#D23030', showCodes: true,
};

export function normalizeHex(value: string) {
  const text = value.trim();
  const expanded = /^#[0-9a-f]{3}$/i.test(text) ? `#${[...text.slice(1)].map(c => c + c).join('')}` : text;
  return /^#[0-9a-f]{6}$/i.test(expanded) ? expanded.toUpperCase() : undefined;
}
export function colorHex(code: string) { return colorMap.get(code)?.hex ?? normalizeHex(code) ?? '#FF00FF'; }
const colorDistance = differenceCiede2000();
export function nearestMardColors(hex: string): Color[] {
  const normalized = normalizeHex(hex);
  if (!normalized) return [];
  const unique = new Map<string, Color>();
  colors.filter(c => c.active).forEach(c => { const key = c.hex.toUpperCase(); if (!unique.has(key)) unique.set(key, c); });
  return [...unique.values()].map(color => ({color, distance: colorDistance(normalized, color.hex)}))
    .sort((a, b) => a.distance - b.distance || a.color.sortOrder - b.color.sortOrder).slice(0, 3).map(item => item.color);
}
export function displayColorCode(code: string) {
  const custom = normalizeHex(code);
  if (custom) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(custom.slice(i, i + 2), 16));
    return `RGB(${r}, ${g}, ${b})`;
  }
  const match = /^([A-Za-z]+)(\d+)$/.exec(code);
  return match ? `${match[1]}${match[2].padStart(2, '0')}` : code;
}
export function cellColorLabels(code: string) { return code.startsWith('#') ? [code.slice(0, 4), code.slice(4)] : [displayColorCode(code)]; }
export function readableText(hex: string) {
  const value = colorHex(hex).slice(1);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? '#26352E' : '#FFFFFF';
}
export function configureColors(next: Color[]) {
  if (!Array.isArray(next) || !next.length || next.some(c => !c || typeof c.code !== 'string' || typeof c.name !== 'string' || !/^#[0-9a-f]{6}$/i.test(c.hex)))
    throw new Error('色库数据无效');
  const incoming = new Set(next.map(c => c.code));
  const old = colors.filter(c => !incoming.has(c.code)).map(c => ({...c, active: false}));
  colors.splice(0, colors.length, ...next, ...old);
  colors.forEach(c => colorMap.set(c.code, c));
}
export type Cell = {x: number; y: number; colorCode: string};
export type Snapshot = {schemaVersion: 1; width: number; height: number; cells: Cell[]};
export type Document = {fileType: 'pindou'; schemaVersion: 1; name: string; snapshot: Snapshot; updatedAt: string};
export type Tool = 'paint' | 'erase' | 'fill' | 'pick' | 'pan' | 'select';
export type Selection = {x: number; y: number; width: number; height: number};
type Change = {key: number; before?: string; after?: string};
type History = {kind: 'edit' | 'erase'; keys: Uint32Array; before: Uint16Array; after: Uint16Array; palette: (string | undefined)[]};
function compact(changes: Change[], kind: History['kind']): History {
  const palette: (string | undefined)[] = [undefined], index = new Map<string | undefined, number>([[undefined, 0]]);
  const colorIndex = (code?: string) => { if (!index.has(code)) { index.set(code, palette.length); palette.push(code); } return index.get(code)!; };
  return {kind, keys: Uint32Array.from(changes.map(c => c.key)), before: Uint16Array.from(changes.map(c => colorIndex(c.before))),
    after: Uint16Array.from(changes.map(c => colorIndex(c.after))), palette};
}

export function validateName(name: string) {
  if (typeof name !== 'string') throw new Error('作品名称无效');
  const trimmed = name.trim();
  if (!trimmed || [...trimmed].length > 80) throw new Error('作品名称需要 1 至 80 个字符');
  return trimmed;
}

export function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('作品数据无效');
  const s = value as Snapshot;
  if (s.schemaVersion !== 1) throw new Error('暂不支持此作品格式版本');
  if (![s.width, s.height].every(n => Number.isInteger(n) && n >= 1 && n <= 200))
    throw new Error('画布宽高需要在 1 至 200 格之间');
  if (!Array.isArray(s.cells) || s.cells.length > s.width * s.height) throw new Error('格子数据无效');
  const seen = new Set<number>();
  const cells = s.cells.map(c => {
    if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y) || c.x < 0 || c.y < 0 || c.x >= s.width || c.y >= s.height)
      throw new Error('作品中存在越界格子');
    const key = c.y * s.width + c.x;
    if (seen.has(key)) throw new Error('作品中存在重复格子');
    seen.add(key);
    const colorCode = colorMap.has(c.colorCode) ? c.colorCode : typeof c.colorCode === 'string' && /^#[0-9a-f]{6}$/i.test(c.colorCode) ? normalizeHex(c.colorCode) : undefined;
    if (!colorCode) throw new Error(`未知的 MARD291 色号或 RGB 颜色：${c.colorCode}`);
    return {x: c.x, y: c.y, colorCode};
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  return {schemaVersion: 1, width: s.width, height: s.height, cells};
}

export function parseDocument(text: string): Document {
  if (new TextEncoder().encode(text).length > 3 * 1024 * 1024) throw new Error('作品文件超过 3 MiB 上限');
  let d: Document;
  try { d = JSON.parse(text); } catch { throw new Error('文件内容无法解析，请选择 .pindou 作品文件'); }
  if (!d || d.fileType !== 'pindou' || d.schemaVersion !== 1) throw new Error('请选择有效的 .pindou 作品文件');
  if (typeof d.name !== 'string') throw new Error('作品名称无效');
  return {fileType: 'pindou', schemaVersion: 1, name: validateName(d.name), snapshot: validateSnapshot(d.snapshot),
    updatedAt: typeof d.updatedAt === 'string' && Number.isFinite(Date.parse(d.updatedAt)) ? d.updatedAt : new Date().toISOString()};
}

export class Editor {
  readonly width: number;
  readonly height: number;
  readonly cells = new Map<number, string>();
  private undoStack: History[] = [];
  private redoStack: History[] = [];
  private stroke = new Map<number, Change>();
  private erasedCells = new Set<number>();
  constructor(snapshot: Snapshot) {
    const s = validateSnapshot(snapshot);
    this.width = s.width; this.height = s.height;
    s.cells.forEach(c => this.cells.set(c.y * s.width + c.x, c.colorCode));
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get lastErased(): ReadonlySet<number> { return this.erasedCells; }
  get(x: number, y: number) { return this.cells.get(y * this.width + x); }
  snapshot(): Snapshot {
    return {schemaVersion: 1, width: this.width, height: this.height,
      cells: [...this.cells].sort(([a], [b]) => a - b).map(([key, colorCode]) => ({x: key % this.width, y: Math.floor(key / this.width), colorCode}))};
  }
  private set(key: number, code?: string) { if (code === undefined) this.cells.delete(key); else this.cells.set(key, code); }
  paint(x: number, y: number, code?: string) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const key = y * this.width + x, before = this.cells.get(key);
    if (before === code) return;
    const change = this.stroke.get(key) ?? {key, before};
    change.after = code; this.stroke.set(key, change); this.set(key, code);
  }
  paintBrush(x: number, y: number, size: number, code?: string) {
    const width = Math.max(1, Math.min(8, Math.round(size))), offset = Math.floor(width / 2);
    for (let by = 0; by < width; by++) for (let bx = 0; bx < width; bx++) this.paint(x + bx - offset, y + by - offset, code);
  }
  line(from: {x: number; y: number}, to: {x: number; y: number}, code?: string) {
    this.brushLine(from, to, 1, code);
  }
  brushLine(from: {x: number; y: number}, to: {x: number; y: number}, size: number, code?: string) {
    let x = from.x, y = from.y;
    const dx = Math.abs(to.x - x), dy = -Math.abs(to.y - y), sx = x < to.x ? 1 : -1, sy = y < to.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.paintBrush(x, y, size, code);
      if (x === to.x && y === to.y) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  endStroke(kind: History['kind'] = 'edit') {
    const changes = [...this.stroke.values()].filter(c => c.before !== c.after);
    this.stroke.clear();
    if (kind === 'erase' || changes.length) this.erasedCells = new Set(kind === 'erase' ? changes.filter(c => c.before !== undefined && c.after === undefined).map(c => c.key) : []);
    if (!changes.length) return false;
    this.undoStack.push(compact(changes, kind)); this.undoStack = this.undoStack.slice(-100); this.redoStack = [];
    return true;
  }
  cancelStroke() { this.stroke.forEach(c => this.set(c.key, c.before)); this.stroke.clear(); }
  fill(x: number, y: number, code: string) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height || this.get(x, y) === code) return false;
    const target = this.get(x, y), queue = [y * this.width + x], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i], cx = key % this.width, cy = Math.floor(key / this.width);
      this.paint(cx, cy, code);
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        const k = ny * this.width + nx;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && !seen.has(k) && this.get(nx, ny) === target) {
          seen.add(k); queue.push(k);
        }
      }
    }
    return this.endStroke();
  }
  clear() {
    for (const key of this.cells.keys()) this.paint(key % this.width, Math.floor(key / this.width));
    return this.endStroke();
  }
  mirror(axis: 'horizontal' | 'vertical') {
    const next = new Map<number, string>();
    this.cells.forEach((code, key) => {
      const x = key % this.width, y = Math.floor(key / this.width);
      next.set((axis === 'vertical' ? this.height - 1 - y : y) * this.width + (axis === 'horizontal' ? this.width - 1 - x : x), code);
    });
    for (const key of new Set([...this.cells.keys(), ...next.keys()])) this.paint(key % this.width, Math.floor(key / this.width), next.get(key));
    return this.endStroke();
  }
  moveRegion(selection: Selection, dx: number, dy: number) {
    const x = Math.max(0, Math.min(this.width - selection.width, Math.round(selection.x + dx)));
    const y = Math.max(0, Math.min(this.height - selection.height, Math.round(selection.y + dy)));
    const offsetX = x - selection.x, offsetY = y - selection.y;
    if (offsetX === 0 && offsetY === 0) return false;
    const source = new Map<number, string>();
    for (let row = 0; row < selection.height; row++) for (let col = 0; col < selection.width; col++) {
      const key = (selection.y + row) * this.width + selection.x + col, code = this.cells.get(key);
      if (code) source.set(key, code);
    }
    for (let row = 0; row < selection.height; row++) for (let col = 0; col < selection.width; col++)
      this.paint(selection.x + col, selection.y + row);
    source.forEach((code, key) => {
      const sx = key % this.width, sy = Math.floor(key / this.width);
      this.paint(sx + offsetX, sy + offsetY, code);
    });
    return this.endStroke();
  }
  undo() { const c = this.undoStack.pop(); if (!c) return false; c.keys.forEach((key, i) => this.set(key, c.palette[c.before[i]])); this.erasedCells.clear(); this.redoStack.push(c); return true; }
  redo() {
    const c = this.redoStack.pop(); if (!c) return false;
    this.erasedCells = new Set<number>();
    c.keys.forEach((key, i) => { this.set(key, c.palette[c.after[i]]); if (c.kind === 'erase' && c.before[i] !== 0 && c.after[i] === 0) this.erasedCells.add(key); });
    this.undoStack.push(c); return true;
  }
}

export function cropSnapshot(snapshot: Snapshot, selection: Selection): Snapshot {
  const x = Math.max(0, Math.min(snapshot.width - 1, Math.floor(selection.x)));
  const y = Math.max(0, Math.min(snapshot.height - 1, Math.floor(selection.y)));
  const width = Math.max(1, Math.min(snapshot.width - x, Math.floor(selection.width)));
  const height = Math.max(1, Math.min(snapshot.height - y, Math.floor(selection.height)));
  return validateSnapshot({schemaVersion: 1, width, height, cells: snapshot.cells
    .filter(cell => cell.x >= x && cell.x < x + width && cell.y >= y && cell.y < y + height)
    .map(cell => ({x: cell.x - x, y: cell.y - y, colorCode: cell.colorCode}))});
}

export function erasedBoundary(cells: ReadonlySet<number>, width: number) {
  const edges: {from: {x: number; y: number}; to: {x: number; y: number}}[] = [];
  cells.forEach(key => {
    const x = key % width, y = Math.floor(key / width);
    // Only exposed edges belong to the outline; neighboring cells share no visible border.
    if (!cells.has(key - width)) edges.push({from: {x, y}, to: {x: x + 1, y}});
    if (x === width - 1 || !cells.has(key + 1)) edges.push({from: {x: x + 1, y}, to: {x: x + 1, y: y + 1}});
    if (!cells.has(key + width)) edges.push({from: {x: x + 1, y: y + 1}, to: {x, y: y + 1}});
    if (x === 0 || !cells.has(key - 1)) edges.push({from: {x, y: y + 1}, to: {x, y}});
  });
  return edges;
}

export type ColorStatistic = {code: string; label: string; hex: string; count: number};
export function colorStatistics(snapshot: Snapshot): ColorStatistic[] {
  const counts = new Map<string, number>();
  snapshot.cells.forEach(cell => counts.set(cell.colorCode, (counts.get(cell.colorCode) ?? 0) + 1));
  return [...counts].map(([code, count]) => ({code, count, hex: colorHex(code), label: displayColorCode(code)}))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function blank(name = '未命名拼豆图', width = 32, height = 32): Document {
  return {fileType: 'pindou', schemaVersion: 1, name: validateName(name),
    snapshot: validateSnapshot({schemaVersion: 1, width, height, cells: []}), updatedAt: new Date().toISOString()};
}
