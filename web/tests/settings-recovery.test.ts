import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {blank, DEFAULT_GRID_SETTINGS} from '../src/domain/editor';
import {clearRecovery, readRecovery, saveRecovery, type LocalWork} from '../src/infrastructure/local';
import {readGridSettings, saveGridSettings} from '../src/infrastructure/settings';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key)});
});
afterEach(() => vi.unstubAllGlobals());

it('persists grid settings and falls back for malformed data', () => {
  const settings = {...DEFAULT_GRID_SETTINGS, centerLine: false, guideOpacity: 42, centerColor: '#123456', showCodes: false};
  saveGridSettings(settings); expect(readGridSettings()).toEqual(settings);
  localStorage.setItem('pindou-grid-settings', '{bad'); expect(readGridSettings()).toEqual(DEFAULT_GRID_SETTINGS);
  localStorage.setItem('pindou-grid-settings', '{"gridOpacity":999,"guideEvery":12}'); expect(readGridSettings()).toEqual(DEFAULT_GRID_SETTINGS);
});
it('adds display defaults for older settings and validates center colors', () => {
  localStorage.setItem('pindou-grid-settings', '{"centerLine":false,"centerColor":"invalid","showCodes":"false"}');
  expect(readGridSettings()).toEqual({...DEFAULT_GRID_SETTINGS, centerLine: false});
  localStorage.setItem('pindou-grid-settings', '{"centerColor":"#abc","showCodes":false}');
  expect(readGridSettings()).toEqual({...DEFAULT_GRID_SETTINGS, centerColor: '#AABBCC', showCodes: false});
});
it('preserves a newer recovery draft when an older async save finishes', () => {
  const old: LocalWork = {localKey: 'one', document: blank('test'), cloudRefs: {}};
  const next = structuredClone(old); next.document.snapshot.cells = [{x: 0, y: 0, colorCode: '#123456'}];
  saveRecovery(next); clearRecovery(old); expect(readRecovery()).toEqual(next);
  clearRecovery(next); expect(readRecovery()).toBeUndefined();
});
it('ignores invalid recovery content and unavailable storage', () => {
  localStorage.setItem('pindou-recovery', '{"localKey":"a","document":{},"cloudRefs":{}}'); expect(readRecovery()).toBeUndefined();
  vi.stubGlobal('localStorage', {getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }});
  expect(readRecovery()).toBeUndefined(); expect(readGridSettings()).toEqual(DEFAULT_GRID_SETTINGS);
  expect(() => saveRecovery({localKey: 'a', document: blank(), cloudRefs: {}})).not.toThrow();
});
