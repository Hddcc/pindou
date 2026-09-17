import {afterEach, describe, expect, it, vi} from 'vitest';
import {blank, DEFAULT_GRID_SETTINGS} from '../src/domain/editor';
import {pngDimensions, renderPNG} from '../src/infrastructure/files';

afterEach(() => vi.unstubAllGlobals());
function canvasMock() {
  const ctx = {fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    fillRect: vi.fn(), fillText: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn()};
  const canvas = {width: 0, height: 0, getContext: () => ctx};
  vi.stubGlobal('document', {createElement: () => canvas});
  return {ctx, canvas};
}

describe('PNG pattern and statistics', () => {
  it('exports selected dimensions and selected-color counts only', () => {
    const snapshot = blank('test', 8, 8).snapshot;
    snapshot.cells = [{x: 1, y: 1, colorCode: 'H7'}, {x: 4, y: 4, colorCode: 'F9'}];
    const region = {x: 1, y: 1, width: 2, height: 3};
    expect(pngDimensions(snapshot, false, false, region)).toMatchObject({width: 40, height: 60});
    const {ctx, canvas} = canvasMock(); renderPNG(snapshot, false, true, DEFAULT_GRID_SETTINGS, region);
    expect(canvas.height).toBe(180);
    expect(ctx.fillText.mock.calls.map(args => args[0])).toEqual(['用色统计', '共 1 颗拼豆 · 1 种颜色', 'H07', '1 颗']);
  });
  it('preserves original clean dimensions without statistics', () => {
    expect(pngDimensions(blank('test', 8, 12).snapshot, false, false)).toMatchObject({width: 160, height: 240, margin: 0});
    const {ctx} = canvasMock(); renderPNG(blank('test', 8, 12).snapshot, false);
    expect(ctx.fillRect).not.toHaveBeenCalled(); expect(ctx.fillText).not.toHaveBeenCalled();
  });
  it('renders every number on all four rulers and normalized color labels', () => {
    const snapshot = blank('test', 3, 2).snapshot; snapshot.cells = [{x: 0, y: 0, colorCode: 'F9'}];
    const {ctx, canvas} = canvasMock(); renderPNG(snapshot, true);
    expect(canvas.width).toBe(108); expect(canvas.height).toBe(88);
    expect(ctx.fillText).toHaveBeenCalledWith('F09', 34, 34, 17);
    const labels = ctx.fillText.mock.calls.map(args => args[0]);
    expect(labels).toEqual(['F09', '1', '1', '2', '2', '3', '3', '1', '1', '2', '2']);
  });
  it('appends total and per-color counts without coloring transparent pattern background', () => {
    const snapshot = blank('test', 3, 2).snapshot;
    snapshot.cells = [{x: 0, y: 0, colorCode: 'F9'}, {x: 1, y: 0, colorCode: 'F9'}, {x: 2, y: 0, colorCode: '#123456'}];
    const {ctx, canvas} = canvasMock(); renderPNG(snapshot, false, true);
    expect(canvas.width).toBe(320); expect(canvas.height).toBe(194);
    expect(ctx.fillRect.mock.calls.some(([x, y, w, h]) => x === 0 && y === 0 && w === canvas.width && h === canvas.height)).toBe(false);
    expect(ctx.fillText.mock.calls.map(args => args[0])).toEqual(['用色统计', '共 3 颗拼豆 · 2 种颜色', 'F09', '2 颗', 'RGB(18, 52, 86)', '1 颗']);
  });
  it('applies independent line styles and handles empty statistics', () => {
    const snapshot = blank('test', 1, 1).snapshot;
    const {ctx, canvas} = canvasMock(); renderPNG(snapshot, true, true, {...DEFAULT_GRID_SETTINGS, gridStyle: 'dashed', centerLine: false});
    expect(ctx.setLineDash).toHaveBeenCalledWith([5, 4]); expect(ctx.setLineDash).toHaveBeenCalledWith([]);
    expect(canvas.height).toBe(154); expect(ctx.fillText.mock.calls.map(args => args[0])).toContain('共 0 颗拼豆 · 0 种颜色');
  });
  it('hides cell labels while retaining rulers and full export statistics', () => {
    const snapshot = blank('test', 2, 2).snapshot; snapshot.cells = [{x: 0, y: 0, colorCode: 'H7'}];
    const {ctx} = canvasMock(); renderPNG(snapshot, true, false, {...DEFAULT_GRID_SETTINGS, showCodes: false});
    expect(ctx.fillText.mock.calls.map(args => args[0])).not.toContain('H07');
    expect(ctx.fillText.mock.calls).toHaveLength(8);
    renderPNG(snapshot, true, true, {...DEFAULT_GRID_SETTINGS, showCodes: false});
    expect(ctx.fillText.mock.calls.map(args => args[0])).toContain('H07');
  });
  it('uses the selected center line color', () => {
    const {ctx} = canvasMock(), strokes: string[] = [];
    ctx.stroke.mockImplementation(() => { strokes.push(ctx.strokeStyle); });
    renderPNG(blank('test', 3, 3).snapshot, true, false, {...DEFAULT_GRID_SETTINGS, centerColor: '#123456'});
    expect(strokes).toContain('#123456');
  });
});
