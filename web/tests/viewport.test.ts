import {afterEach, expect, it, vi} from 'vitest';
import {trackViewport} from '../src/presentation/viewport';

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); });
function setup(viewport?: EventTarget & {height: number; scale: number}) {
  const browser = Object.assign(new EventTarget(), {innerHeight: 900, visualViewport: viewport});
  const setProperty = vi.fn();
  vi.stubGlobal('window', browser); vi.stubGlobal('document', {documentElement: {style: {setProperty}}});
  stop = trackViewport(); return {browser, setProperty};
}
it('uses the visible viewport and updates when browser chrome resizes', () => {
  const viewport = Object.assign(new EventTarget(), {height: 780, scale: 1});
  const {setProperty} = setup(viewport); expect(setProperty).toHaveBeenLastCalledWith('--app-height', '780px');
  viewport.height = 680; viewport.dispatchEvent(new Event('resize'));
  expect(setProperty).toHaveBeenLastCalledWith('--app-height', '680px');
});
it('falls back to innerHeight and updates on orientation changes', () => {
  const {browser, setProperty} = setup(); expect(setProperty).toHaveBeenLastCalledWith('--app-height', '900px');
  browser.innerHeight = 600; browser.dispatchEvent(new Event('orientationchange'));
  expect(setProperty).toHaveBeenLastCalledWith('--app-height', '600px');
});
it('keeps page zoom from shrinking the application layout', () => {
  const {setProperty} = setup(Object.assign(new EventTarget(), {height: 450, scale: 2}));
  expect(setProperty).toHaveBeenLastCalledWith('--app-height', '900px');
});
it('removes viewport listeners on cleanup', () => {
  const viewport = Object.assign(new EventTarget(), {height: 780, scale: 1});
  const {browser, setProperty} = setup(viewport); stop!(); setProperty.mockClear();
  viewport.dispatchEvent(new Event('resize')); browser.dispatchEvent(new Event('resize')); browser.dispatchEvent(new Event('orientationchange'));
  expect(setProperty).not.toHaveBeenCalled();
});
