import {cellColorLabels, colorHex, colorStatistics, DEFAULT_GRID_SETTINGS, readableText, type Document, type GridSettings, type Selection, type Snapshot, cropSnapshot} from '../domain/editor';
export const CELL_PIXELS = 20;
const RULER = 24, STAT_COLUMN = 250, STAT_ROW = 34;
export function pngDimensions(snapshot: Snapshot, grid: boolean, statistics: boolean, selection?: Selection | null) {
  if (selection) snapshot = cropSnapshot(snapshot, selection);
  const margin = grid ? RULER : 0, patternWidth = snapshot.width * CELL_PIXELS + margin * 2;
  const patternHeight = snapshot.height * CELL_PIXELS + margin * 2;
  const width = statistics ? Math.max(320, patternWidth) : patternWidth;
  const columns = Math.max(1, Math.floor((width - 32) / STAT_COLUMN));
  const statisticsHeight = statistics ? 86 + Math.ceil(colorStatistics(snapshot).length / columns) * STAT_ROW : 0;
  return {width, height: patternHeight + statisticsHeight, patternWidth, patternHeight, margin, columns};
}
export function renderPNG(snapshot: Snapshot, grid: boolean, statistics = false, settings: GridSettings = DEFAULT_GRID_SETTINGS, selection?: Selection | null): HTMLCanvasElement {
  if (selection) snapshot = cropSnapshot(snapshot, selection);
  const canvas = document.createElement('canvas'), layout = pngDimensions(snapshot, grid, statistics);
  canvas.width = layout.width; canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法生成图片');
  const bw = snapshot.width * CELL_PIXELS, bh = snapshot.height * CELL_PIXELS;
  const ox = (layout.width - bw) / 2, oy = layout.margin;
  if (grid) {
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, layout.patternHeight);
    ctx.fillStyle = '#F1F3F2';
    for (let y = 0; y < snapshot.height; y++) for (let x = 0; x < snapshot.width; x++) if ((x + y) % 2) ctx.fillRect(ox + x * CELL_PIXELS, oy + y * CELL_PIXELS, CELL_PIXELS, CELL_PIXELS);
  }
  for (const c of snapshot.cells) {
    ctx.fillStyle = colorHex(c.colorCode); ctx.fillRect(ox + c.x * CELL_PIXELS, oy + c.y * CELL_PIXELS, CELL_PIXELS, CELL_PIXELS);
    if (grid && settings.showCodes) {
      const labels = cellColorLabels(c.colorCode), fontSize = c.colorCode.startsWith('#') ? 6.8 : 8;
      ctx.fillStyle = readableText(c.colorCode); ctx.font = `600 ${fontSize}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      labels.forEach((label, index) => ctx.fillText(label, ox + (c.x + .5) * CELL_PIXELS,
        oy + (c.y + .5) * CELL_PIXELS + (index - (labels.length - 1) / 2) * fontSize * 1.15, CELL_PIXELS - 3));
    }
  }
  if (grid) {
    const drawLines = (every: number, style: string, opacity: number, lineWidth: number) => {
      ctx.save(); ctx.strokeStyle = `rgba(87, 101, 94, ${opacity / 100})`; ctx.lineWidth = lineWidth; ctx.setLineDash(style === 'dashed' ? [5, 4] : []); ctx.beginPath();
      for (let x = 0; x <= snapshot.width; x++) if (x % every === 0) { ctx.moveTo(ox + x * CELL_PIXELS, oy); ctx.lineTo(ox + x * CELL_PIXELS, oy + bh); }
      for (let y = 0; y <= snapshot.height; y++) if (y % every === 0) { ctx.moveTo(ox, oy + y * CELL_PIXELS); ctx.lineTo(ox + bw, oy + y * CELL_PIXELS); }
      ctx.stroke(); ctx.restore();
    };
    drawLines(1, settings.gridStyle, settings.gridOpacity, .65); drawLines(settings.guideEvery, settings.guideStyle, settings.guideOpacity, 1.35);
    ctx.strokeStyle = '#7D8C84'; ctx.lineWidth = 1.2; ctx.strokeRect(ox, oy, bw, bh);
    if (settings.centerLine) {
      ctx.save(); ctx.strokeStyle = settings.centerColor; ctx.globalAlpha = .82; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(ox + bw / 2, oy); ctx.lineTo(ox + bw / 2, oy + bh); ctx.moveTo(ox, oy + bh / 2); ctx.lineTo(ox + bw, oy + bh / 2); ctx.stroke(); ctx.restore();
    }
    ctx.font = '600 9px system-ui'; ctx.fillStyle = '#43564D'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let x = 0; x < snapshot.width; x++) { const px = ox + (x + .5) * CELL_PIXELS; ctx.fillText(String(x + 1), px, RULER / 2); ctx.fillText(String(x + 1), px, oy + bh + RULER / 2); }
    for (let y = 0; y < snapshot.height; y++) { const py = oy + (y + .5) * CELL_PIXELS; ctx.fillText(String(y + 1), ox - RULER / 2, py); ctx.fillText(String(y + 1), ox + bw + RULER / 2, py); }
  }
  if (statistics) {
    const stats = colorStatistics(snapshot), top = layout.patternHeight;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, top, canvas.width, canvas.height - top);
    ctx.strokeStyle = '#CBD5CE'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(16, top + 1); ctx.lineTo(canvas.width - 16, top + 1); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#26352E'; ctx.font = '600 16px system-ui'; ctx.fillText('用色统计', 16, top + 26);
    ctx.font = '12px system-ui'; ctx.fillText(`共 ${snapshot.cells.length.toLocaleString()} 颗拼豆 · ${stats.length} 种颜色`, 16, top + 51);
    const columnWidth = (canvas.width - 32) / layout.columns;
    stats.forEach((stat, index) => {
      const x = 16 + index % layout.columns * columnWidth, y = top + 78 + Math.floor(index / layout.columns) * STAT_ROW;
      ctx.fillStyle = stat.hex; ctx.fillRect(x, y - 9, 18, 18); ctx.strokeStyle = '#ABB9B0'; ctx.lineWidth = .6; ctx.strokeRect(x, y - 9, 18, 18);
      ctx.font = '12px system-ui'; ctx.fillStyle = '#26352E'; ctx.textAlign = 'left'; ctx.fillText(stat.label, x + 27, y, columnWidth - 88);
      ctx.textAlign = 'right'; ctx.fillText(`${stat.count} 颗`, x + columnWidth - 12, y);
    });
  }
  return canvas;
}
export function safeFilename(name: string) { return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || '拼豆图'; }
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function downloadDocument(d: Document) { download(new Blob([JSON.stringify(d)], {type: 'application/json'}), `${safeFilename(d.name)}.pindou`); }
export async function pngBlob(d: Document, grid: boolean, statistics = false, settings: GridSettings = DEFAULT_GRID_SETTINGS, selection?: Selection | null) {
  return new Promise<Blob>((resolve, reject) => renderPNG(d.snapshot, grid, statistics, settings, selection).toBlob(blob => blob ? resolve(blob) : reject(new Error('图片导出失败，请重试')), 'image/png'));
}
