import {describe, expect, it} from 'vitest';
import {blank, colorStatistics, colors, cropSnapshot, displayColorCode, Editor, erasedBoundary, nearestMardColors, normalizeHex, parseDocument, validateSnapshot} from '../src/domain/editor';

describe('MARD291 and validation', () => {
  it('contains 291 unique real colors', () => { expect(colors).toHaveLength(291); expect(new Set(colors.map(c => c.code)).size).toBe(291); expect(colors.find(c => c.code === 'H7')?.hex).toBe('#000000'); });
  it.each([0, -1, 201, 2.2, NaN])('rejects invalid width %s', width => { expect(() => blank('test', width, 32)).toThrow(); });
  it('accepts minimum and maximum', () => { expect(blank('test', 1, 200).snapshot.height).toBe(200); });
  it('rejects duplicates, unknown colors and out of bounds', () => {
    const base = {schemaVersion: 1, width: 3, height: 3}, cell = {x: 1, y: 1, colorCode: 'H7'};
    for (const cells of [[cell, cell], [{...cell, x: 3}], [{...cell, colorCode: 'M001'}], [null]]) expect(() => validateSnapshot({...base, cells})).toThrow();
  });
  it('sorts without retaining untrusted properties', () => {
    expect(validateSnapshot({schemaVersion: 1, width: 3, height: 3, cells: [{x: 2, y: 2, colorCode: 'A1'}, {x: 0, y: 0, colorCode: 'H7', extra: 'ignored'}]}).cells[0]).toEqual({x: 0, y: 0, colorCode: 'H7'});
  });
  it('accepts canonical custom RGB colors and formats labels', () => {
    const snapshot = validateSnapshot({schemaVersion: 1, width: 2, height: 2, cells: [{x: 0, y: 0, colorCode: '#1a2b3c'}]});
    expect(snapshot.cells[0].colorCode).toBe('#1A2B3C');
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(displayColorCode('F9')).toBe('F09');
    expect(displayColorCode('#1A2B3C')).toBe('RGB(26, 43, 60)');
  });
  it('round-trips file and rejects corrupt input', () => {
    const d = blank('小花', 16, 32); expect(parseDocument(JSON.stringify(d))).toEqual(d);
    for (const t of ['null', '{}', 'bad', '{"fileType":"pindou","schemaVersion":2}']) expect(() => parseDocument(t)).toThrow();
  });
});
describe('nearest MARD colors', () => {
  it('returns three active, distinct palette colors ordered by perceptual distance', () => {
    const result = nearestMardColors('#8CC9DE');
    expect(result).toHaveLength(3);
    expect(new Set(result.map(c => c.hex.toUpperCase())).size).toBe(3);
    expect(result.every(c => c.active && colors.includes(c))).toBe(true);
    expect(nearestMardColors('#000000')[0].code).toBe('H7');
    expect(nearestMardColors('#ffffff')[0].hex.toUpperCase()).toBe('#FFFFFF');
    expect(nearestMardColors('invalid')).toEqual([]);
  });
  it('excludes inactive colors even if they match exactly', () => {
    const black = colors.find(c => c.code === 'H7')!;
    const active = black.active;
    try { black.active = false; expect(nearestMardColors('#000000').some(c => c.code === 'H7')).toBe(false); }
    finally { black.active = active; }
  });
});
describe('last erased stroke boundary', () => {
  it('retains only the actual erased union of the last completed stroke', () => {
    const e = new Editor(blank('test', 6, 6).snapshot); e.fill(0, 0, 'H7');
    e.paint(1, 1); e.paint(1, 2); e.paint(2, 2); e.endStroke('erase');
    expect([...e.lastErased].sort((a, b) => a - b)).toEqual([7, 13, 14]);
    const edges = erasedBoundary(e.lastErased, e.width);
    expect(edges).toHaveLength(8);
    expect(edges).toContainEqual({from: {x: 1, y: 1}, to: {x: 2, y: 1}});
    expect(edges).not.toContainEqual({from: {x: 1, y: 2}, to: {x: 2, y: 2}});
    expect(edges).not.toContainEqual({from: {x: 2, y: 2}, to: {x: 2, y: 3}});
    e.paint(4, 4); e.paint(1, 1); e.endStroke('erase');
    expect([...e.lastErased]).toEqual([28]);
  });
  it.each([1, 2, 4, 8])('tracks the whole %s-cell brush drag, clipping borders and ignoring empty cells', size => {
    const e = new Editor(blank('test', 8, 8).snapshot); e.fill(0, 0, 'H7');
    e.brushLine({x: 0, y: 0}, {x: 4, y: 1}, size); e.endStroke('erase');
    expect(e.lastErased.size).toBe(64 - e.cells.size);
    expect(e.lastErased.size).toBeGreaterThan(size);
    const erased = new Set(e.lastErased);
    e.undo(); expect(e.cells.size).toBe(64); expect(e.lastErased.size).toBe(0);
    e.redo(); expect(e.lastErased).toEqual(erased);
  });
  it('preserves the previous outline on cancellation and removes it on new edits or empty erases', () => {
    const e = new Editor(blank('test', 4, 4).snapshot); e.fill(0, 0, 'H7');
    e.paint(0, 0); e.endStroke('erase');
    e.paint(1, 1); e.cancelStroke(); expect([...e.lastErased]).toEqual([0]); expect(e.get(1, 1)).toBe('H7');
    expect(e.endStroke('erase')).toBe(false); expect(e.lastErased.size).toBe(0);
    e.paint(1, 1); e.endStroke('erase'); e.paint(3, 3, 'F9'); e.endStroke(); expect(e.lastErased.size).toBe(0);
  });
  it('handles holes, separated areas and adjacent keys on different rows', () => {
    expect(erasedBoundary(new Set([3, 4]), 4)).toHaveLength(8);
    expect(erasedBoundary(new Set([0, 1, 2, 3, 5, 6, 7, 8]), 3)).toHaveLength(16);
  });
});
describe('clear and mirror', () => {
  const snapshot = validateSnapshot({schemaVersion: 1, width: 5, height: 3, cells: [
    {x: 0, y: 0, colorCode: 'F9'}, {x: 4, y: 1, colorCode: 'H7'}, {x: 2, y: 2, colorCode: '#123456'},
  ]});
  it('clears as one history entry and restores all colors', () => {
    const e = new Editor(snapshot); expect(e.clear()).toBe(true); expect(e.cells.size).toBe(0);
    expect(e.clear()).toBe(false); e.undo(); expect(e.snapshot()).toEqual(snapshot); expect(e.canUndo).toBe(false);
    e.redo(); expect(e.cells.size).toBe(0);
  });
  it.each(['horizontal', 'vertical'] as const)('mirrors a sparse rectangular board %s as one history entry', axis => {
    const e = new Editor(snapshot); expect(e.mirror(axis)).toBe(true);
    expect(e.cells.size).toBe(3);
    snapshot.cells.forEach(c => expect(e.get(axis === 'horizontal' ? 4 - c.x : c.x, axis === 'vertical' ? 2 - c.y : c.y)).toBe(c.colorCode));
    const mirrored = e.snapshot(); e.undo(); expect(e.snapshot()).toEqual(snapshot); expect(e.canUndo).toBe(false);
    e.redo(); expect(e.snapshot()).toEqual(mirrored); e.mirror(axis); expect(e.snapshot()).toEqual(snapshot);
  });
  it('does not record an empty or symmetric mirror', () => {
    const e = new Editor(blank('test', 1, 1).snapshot); expect(e.mirror('horizontal')).toBe(false);
    e.paint(0, 0, 'F9'); e.endStroke(); expect(e.mirror('vertical')).toBe(false);
    e.undo(); expect(e.cells.size).toBe(0);
  });
});
describe('editing and history', () => {
  it('groups a continuous stroke, erases and undoes', () => {
    const e = new Editor(blank().snapshot); e.line({x: 1, y: 1}, {x: 6, y: 1}, 'H7'); e.endStroke(); expect(e.cells.size).toBe(6);
    e.undo(); expect(e.cells.size).toBe(0); e.redo(); expect(e.cells.size).toBe(6);
    e.paint(1, 1); e.endStroke(); expect(e.get(1, 1)).toBeUndefined(); e.undo(); expect(e.get(1, 1)).toBe('H7');
  });
  it('does not record no-op and clears redo on a new stroke', () => {
    const e = new Editor(blank().snapshot); e.paint(0, 0, 'H7'); e.endStroke(); e.paint(0, 0, 'H7'); expect(e.endStroke()).toBe(false);
    e.undo(); e.paint(1, 0, 'A1'); e.endStroke(); expect(e.canRedo).toBe(false);
  });
  it('cancels a stroke when a second finger starts a gesture', () => {
    const e = new Editor(blank().snapshot); e.paint(0, 0, 'H7'); e.cancelStroke(); expect(e.cells.size).toBe(0); expect(e.canUndo).toBe(false);
  });
  it('fills with four-neighbor connectivity only', () => {
    const e = new Editor(blank('test', 3, 3).snapshot);
    e.paint(1, 0, 'H7'); e.paint(0, 1, 'H7'); e.endStroke(); e.fill(0, 0, 'A1');
    expect(e.get(0, 0)).toBe('A1'); expect(e.get(1, 1)).toBeUndefined(); e.undo(); expect(e.get(0, 0)).toBeUndefined();
  });
  it('fills an enclosed area without crossing its border', () => {
    const e = new Editor(blank('test', 5, 5).snapshot);
    for (let n = 1; n <= 3; n++) { e.paint(n, 1, 'H7'); e.paint(n, 3, 'H7'); e.paint(1, n, 'H7'); e.paint(3, n, 'H7'); }
    e.endStroke(); e.fill(2, 2, 'A1'); expect(e.cells.size).toBe(9); expect(e.get(0, 0)).toBeUndefined();
  });
  it('fills 40,000 cells as one step', () => {
    const e = new Editor(blank('test', 200, 200).snapshot); e.fill(0, 0, 'H7'); expect(e.cells.size).toBe(40000);
    expect(e.fill(0, 0, 'H7')).toBe(false); e.undo(); expect(e.cells.size).toBe(0); e.redo(); expect(e.cells.size).toBe(40000);
  });
  it('retains the last 100 steps', () => {
    const e = new Editor(blank('test', 200, 1).snapshot);
    for (let x = 0; x < 105; x++) { e.paint(x, 0, 'H7'); e.endStroke(); }
    let steps = 0; while (e.undo()) steps++; expect(steps).toBe(100); expect(e.cells.size).toBe(5);
  });
  it('uses a square eraser brush as one undoable stroke', () => {
    const e = new Editor(blank('test', 8, 8).snapshot); e.fill(0, 0, 'H7');
    e.brushLine({x: 3, y: 3}, {x: 4, y: 3}, 2); e.endStroke();
    expect(e.cells.size).toBe(58); e.undo(); expect(e.cells.size).toBe(64);
  });
  it('clips larger erasers at the border and cancels without losing cells', () => {
    const e = new Editor(blank('test', 8, 8).snapshot); e.fill(0, 0, 'H7');
    e.paintBrush(0, 0, 4); expect(e.cells.size).toBe(60); e.cancelStroke(); expect(e.cells.size).toBe(64);
    e.paintBrush(4, 4, 4); e.endStroke(); expect(e.cells.size).toBe(48); e.undo(); expect(e.cells.size).toBe(64);
  });
  it('counts each used color for export statistics', () => {
    const snapshot = validateSnapshot({schemaVersion: 1, width: 3, height: 2, cells: [
      {x: 0, y: 0, colorCode: 'F9'}, {x: 1, y: 0, colorCode: 'F9'}, {x: 2, y: 0, colorCode: '#123456'},
    ]});
    expect(colorStatistics(snapshot)).toEqual([
      {code: 'F9', label: 'F09', hex: colors.find(c => c.code === 'F9')!.hex, count: 2},
      {code: '#123456', label: 'RGB(18, 52, 86)', hex: '#123456', count: 1},
    ]);
  });
});
describe('selection movement and export', () => {
  const snapshot = validateSnapshot({schemaVersion: 1, width: 8, height: 6, cells: [
    {x: 1, y: 1, colorCode: 'H7'}, {x: 2, y: 2, colorCode: '#123456'},
    {x: 4, y: 2, colorCode: 'F9'}, {x: 5, y: 2, colorCode: 'A1'},
  ]});
  it('moves sparse colors as one history entry and leaves blank destinations intact', () => {
    const editor = new Editor(snapshot);
    expect(editor.moveRegion({x: 1, y: 1, width: 2, height: 2}, 3, 0)).toBe(true);
    expect(editor.get(1, 1)).toBeUndefined(); expect(editor.get(2, 2)).toBeUndefined();
    expect(editor.get(4, 1)).toBe('H7'); expect(editor.get(5, 2)).toBe('#123456'); expect(editor.get(4, 2)).toBe('F9');
    const moved = editor.snapshot(); editor.undo(); expect(editor.snapshot()).toEqual(snapshot); expect(editor.canUndo).toBe(false);
    editor.redo(); expect(editor.snapshot()).toEqual(moved);
  });
  it('handles overlap safely and clamps the whole selection at the board edge', () => {
    const editor = new Editor(snapshot);
    editor.moveRegion({x: 1, y: 1, width: 2, height: 2}, 1, 1);
    expect(editor.get(2, 2)).toBe('H7'); expect(editor.get(3, 3)).toBe('#123456');
    editor.undo(); editor.moveRegion({x: 1, y: 1, width: 2, height: 2}, 100, 100);
    expect(editor.get(6, 4)).toBe('H7'); expect(editor.get(7, 5)).toBe('#123456');
  });
  it('does not record a zero or empty move', () => {
    const editor = new Editor(snapshot);
    expect(editor.moveRegion({x: 1, y: 1, width: 2, height: 2}, 0, 0)).toBe(false);
    expect(editor.moveRegion({x: 0, y: 5, width: 1, height: 1}, 2, 0)).toBe(false);
    expect(editor.canUndo).toBe(false);
  });
  it('crops only the selected cells, resets their origin and retains blank padding', () => {
    expect(cropSnapshot(snapshot, {x: 1, y: 1, width: 2, height: 3})).toEqual({schemaVersion: 1, width: 2, height: 3, cells: [
      {x: 0, y: 0, colorCode: 'H7'}, {x: 1, y: 1, colorCode: '#123456'},
    ]});
    expect(snapshot.cells).toHaveLength(4);
  });
});
