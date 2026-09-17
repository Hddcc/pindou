import {DEFAULT_GRID_SETTINGS, normalizeHex, type GridSettings} from '../domain/editor';

export function readGridSettings(): GridSettings {
  try {
    const value = JSON.parse(localStorage.getItem('pindou-grid-settings') ?? '{}');
    return {
      guideEvery: value.guideEvery === 10 ? 10 : 5,
      gridStyle: value.gridStyle === 'dashed' ? 'dashed' : 'solid',
      guideStyle: value.guideStyle === 'dashed' ? 'dashed' : 'solid',
      gridOpacity: typeof value.gridOpacity === 'number' && value.gridOpacity >= 0 && value.gridOpacity <= 100 ? value.gridOpacity : DEFAULT_GRID_SETTINGS.gridOpacity,
      guideOpacity: typeof value.guideOpacity === 'number' && value.guideOpacity >= 0 && value.guideOpacity <= 100 ? value.guideOpacity : DEFAULT_GRID_SETTINGS.guideOpacity,
      centerLine: typeof value.centerLine === 'boolean' ? value.centerLine : DEFAULT_GRID_SETTINGS.centerLine,
      centerColor: typeof value.centerColor === 'string' ? normalizeHex(value.centerColor) ?? DEFAULT_GRID_SETTINGS.centerColor : DEFAULT_GRID_SETTINGS.centerColor,
      showCodes: typeof value.showCodes === 'boolean' ? value.showCodes : DEFAULT_GRID_SETTINGS.showCodes,
    };
  } catch { return {...DEFAULT_GRID_SETTINGS}; }
}
export function saveGridSettings(settings: GridSettings) {
  try { localStorage.setItem('pindou-grid-settings', JSON.stringify(settings)); } catch { /* Drawing remains available when settings cannot be persisted. */ }
}
