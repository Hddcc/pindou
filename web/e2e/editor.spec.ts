import {expect, test, type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {clickTool as clickCurrentTool, dismissSuccess, openActions} from './helpers';

async function clickTool(page: Page, name: string) {
  await clickCurrentTool(page, name);
}

async function loadPattern(page: Page, width: number, height: number, cells: {x: number; y: number; colorCode: string}[], beadMode = false) {
  await page.getByRole('button', {name: '我的作品', exact: true}).click();
  if (beadMode) await page.getByLabel('以拼豆模式打开', {exact: true}).check();
  await page.getByRole('button', {name: '本地打开', exact: true}).click();
  await page.getByLabel('打开作品文件', {exact: true}).setInputFiles({name: 'features.pindou', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    fileType: 'pindou', schemaVersion: 1, name: '新功能测试', updatedAt: new Date().toISOString(), snapshot: {schemaVersion: 1, width, height, cells},
  }))});
  await expect(page.getByRole('button', {name: '新功能测试', exact: true})).toBeVisible();
}
async function savedCells(page: Page) {
  await clickTool(page, '保存');
  const event = page.waitForEvent('download');
  await page.getByRole('button', {name: '保存到本地', exact: false}).click();
  const location = await (await event).path();
  if (!location) throw new Error('Missing downloaded pattern');
  const cells = JSON.parse(await readFile(location, 'utf8')).snapshot.cells as {x: number; y: number; colorCode: string}[];
  await dismissSuccess(page, '保存成功');
  return cells;
}
async function hidePalette(page: Page) {
  const close = page.getByRole('button', {name: '收起色板', exact: true}).first();
  if (await close.isVisible()) await close.click();
}

test('picker saves the draft before opening and cancellation returns to the same board', async ({page}) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await loadPattern(page, 8, 8, []);
  await page.getByTestId('board').click();
  await clickTool(page, '外部取色');
  await expect(page.getByRole('dialog', {name: '外部取色'})).toBeVisible();
  expect(await page.locator('.save-status').textContent()).toMatch(/已自动保存/);
  await page.getByLabel('选择取色图片', {exact: true}).dispatchEvent('cancel');
  await expect(page.getByRole('dialog', {name: '外部取色'})).toBeVisible();
  await page.getByRole('button', {name: '关闭', exact: true}).click();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('.bead-count')).toHaveText('1 颗拼豆');
  await page.reload(); await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('.bead-count')).toHaveText('1 颗拼豆');
});
async function sampleBoard(page: Page, x: number, y: number, width = 8, height = 8) {
  return page.getByTestId('board').evaluate((element: HTMLCanvasElement, p) => {
    const ctx = element.getContext('2d')!, dpr = window.devicePixelRatio || 1;
    const px = element.clientWidth / 2 - p.width * 10 + p.x * 20 + 3, py = element.clientHeight / 2 - p.height * 10 + p.y * 20 + 3;
    return Array.from(ctx.getImageData(Math.round(px * dpr), Math.round(py * dpr), 1, 1).data);
  }, {x, y, width, height});
}

test('touch-friendly drawing, undo, fill and reload recovery', async ({page}) => {
  await page.goto('/');
  const board = page.getByTestId('board'); await expect(board).toBeVisible();
  await expect(page.getByRole('button', {name: '新建画布', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: '新建画布', exact: true}).click();
  await page.getByLabel('作品名称', {exact: true}).fill('测试拼豆图');
  await page.getByRole('button', {name: '16 × 16', exact: true}).click();
  await page.getByRole('button', {name: '创建画布', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const bounds = await board.boundingBox(); if (!bounds) throw new Error('Canvas not rendered');
  await board.click({position: {x: bounds.width / 2, y: bounds.height / 2}});
  await expect(page.getByRole('button', {name: '撤回', exact: true, includeHidden: true})).toBeEnabled();
  await clickTool(page, '撤回');
  await expect(page.getByRole('button', {name: '反撤回', exact: true, includeHidden: true})).toBeEnabled();
  await clickTool(page, '反撤回');
  await clickTool(page, '填色');
  await board.click({position: {x: bounds.width / 2 - 22, y: bounds.height / 2}});
  await expect(page.locator('.bead-count')).toHaveText('256 颗拼豆');
  await expect(page.locator('.save-status')).toHaveText(/已自动保存 \d{2}:\d{2}/);
  await page.reload(); await expect(board).toBeVisible();
  await expect(page.locator('.bead-count')).toHaveText('256 颗拼豆');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('local file round trip and transparent/grid downloads', async ({page}, testInfo) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await page.getByRole('button', {name: '我的作品', exact: true}).click();
  await page.getByRole('button', {name: '本地打开', exact: true}).click();
  await page.getByLabel('打开作品文件', {exact: true}).setInputFiles(path.resolve('e2e/fixtures/sample.pindou'));
  await expect(page.getByRole('button', {name: '测试文件', exact: true})).toBeVisible();
  await expect(page.locator('.bead-count')).toHaveText('4 颗拼豆');
  await clickTool(page, '保存');
  const fileDownload = page.waitForEvent('download');
  await page.getByRole('button', {name: '保存到本地', exact: false}).click();
  const downloaded = await fileDownload, filename = testInfo.outputPath('roundtrip.pindou'); await downloaded.saveAs(filename);
  await dismissSuccess(page, '保存成功');
  const d = JSON.parse(await readFile(filename, 'utf8'));
  expect(d.snapshot.cells).toHaveLength(4); expect(d.name).toBe('测试文件');
  await clickTool(page, '导出');
  for (const mode of ['grid', 'clean']) {
    if (mode === 'clean') await page.getByRole('button', {name: '透明背景', exact: true}).click();
    const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', {name: '下载 PNG', exact: true}).click();
    const png = await downloadEvent; expect(png.suggestedFilename()).toBe(`测试文件-${mode}.png`);
    await png.saveAs(testInfo.outputPath(`${mode}.png`));
    await dismissSuccess(page, '导出成功');
  }
});

test('palette groups colors by family and preserves search, filters and selection', async ({page}, testInfo) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await page.getByRole('button', {name: '打开色板', exact: true}).click();
  const palette = page.locator('.color-grid');
  const families = palette.locator('.color-family');
  await expect(palette.getByRole('button')).toHaveCount(291);
  const names = await families.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')!));
  expect(names).toEqual([...names].sort());
  for (const group of await families.all()) {
    const name = (await group.getAttribute('aria-label'))!.split(' ')[0];
    const buttons = await group.getByRole('button').all();
    for (const button of buttons) expect(await button.getAttribute('aria-label')).toMatch(new RegExp(`^颜色 ${name}\\d+$`));
  }
  const a = palette.getByRole('region', {name: 'A 系列', exact: true});
  const b = palette.getByRole('region', {name: 'B 系列', exact: true});
  const aBox = (await a.boundingBox())!, bBox = (await b.boundingBox())!;
  expect(bBox.y).toBeGreaterThan(aBox.y + aBox.height);
  await page.screenshot({path: testInfo.outputPath('grouped-palette.png')});
  await page.getByLabel('色系', {exact: true}).selectOption('B');
  await expect(families).toHaveCount(1); await expect(b.getByRole('button')).toHaveCount(32);
  await b.getByRole('button', {name: '颜色 B01', exact: true}).click();
  await expect(page.getByRole('button', {name: '选择颜色 B01', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(b.getByRole('button', {name: '颜色 B01', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('色系', {exact: true}).selectOption('全部');
  await page.getByLabel('搜索色号', {exact: true}).fill('F09');
  await expect(families).toHaveCount(1);
  await expect(palette.getByRole('region', {name: 'F 系列', exact: true}).getByRole('button', {name: '颜色 F09', exact: true})).toBeVisible();
  await page.getByLabel('搜索色号', {exact: true}).fill('ZZ999');
  await expect(families).toHaveCount(0); await expect(palette).toHaveText('没有匹配的色号');
  await page.getByRole('button', {name: '清除搜索', exact: true}).click();
  await expect(families).toHaveCount(names.length); await expect(palette.getByRole('button')).toHaveCount(291);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('invalid import preserves the editor', async ({page}) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await page.getByRole('button', {name: '我的作品', exact: true}).click();
  await page.getByRole('button', {name: '本地打开', exact: true}).click();
  await page.getByLabel('打开作品文件', {exact: true}).setInputFiles({name: 'bad.pindou', mimeType: 'application/json', buffer: Buffer.from('{"bad":true}')});
  await expect(page.getByRole('alert')).toContainText('有效的 .pindou');
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByRole('button', {name: '未命名拼豆图', exact: true})).toBeVisible();
});

test('custom RGB, large eraser, grid settings and immediate reload recovery', async ({page}, testInfo) => {
  await page.goto('/');
  const board = page.getByTestId('board'); await expect(board).toBeVisible();
  await page.getByRole('button', {name: '新建画布', exact: true}).click();
  await page.getByLabel('作品名称', {exact: true}).fill('RGB 拼豆测试');
  await page.getByLabel('宽度（格）', {exact: true}).fill('8'); await page.getByLabel('高度（格）', {exact: true}).fill('8');
  await page.getByRole('button', {name: '创建画布', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await clickTool(page, '外部取色');
  await page.getByLabel('HEX 颜色', {exact: true}).fill('#1A2B3C');
  await expect(page.locator('.picker-result strong')).toHaveText('RGB(26, 43, 60)');
  await page.getByRole('button', {name: '使用此颜色', exact: true}).click();
  await clickTool(page, '填色');
  const bounds = await board.boundingBox(); if (!bounds) throw new Error('Canvas not rendered');
  await board.click({position: {x: bounds.width / 2 + 8, y: bounds.height / 2 + 8}});
  await expect(page.locator('.bead-count')).toHaveText('64 颗拼豆');
  await page.reload(); await expect(board).toBeVisible();
  await expect(page.locator('.bead-count')).toHaveText('64 颗拼豆');
  await clickTool(page, '橡皮擦');
  await page.getByRole('button', {name: '橡皮擦尺寸 4 × 4', exact: true}).click();
  const afterReload = await board.boundingBox(); if (!afterReload) throw new Error('Canvas not rendered');
  await board.click({position: {x: afterReload.width / 2 + 8, y: afterReload.height / 2 + 8}});
  await expect(page.locator('.bead-count')).toHaveText('48 颗拼豆');
  await clickTool(page, '撤回');
  await expect(page.locator('.bead-count')).toHaveText('64 颗拼豆');
  await page.getByRole('button', {name: '画布设置', exact: true}).click();
  await page.getByLabel('辅助线间隔', {exact: true}).selectOption('10');
  await page.getByLabel('辅助线线型', {exact: true}).selectOption('dashed');
  await page.getByLabel('中心十字线', {exact: true}).uncheck();
  await page.screenshot({path: testInfo.outputPath('grid-settings.png')});
  await page.getByRole('button', {name: '完成', exact: true}).click();
  await page.reload(); await expect(board).toBeVisible();
  await page.getByRole('button', {name: '画布设置', exact: true}).click();
  await expect(page.getByLabel('辅助线间隔', {exact: true})).toHaveValue('10');
  await expect(page.getByLabel('辅助线线型', {exact: true})).toHaveValue('dashed');
  await expect(page.getByLabel('中心十字线', {exact: true})).not.toBeChecked();
  await page.getByRole('button', {name: '完成', exact: true}).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({path: testInfo.outputPath('rgb-board.png')});

  await clickTool(page, '导出');
  const preview = page.getByAltText('图纸导出预览'); await expect(preview).toBeVisible();
  await expect(page.locator('.export-spec')).toContainText('320 × 328 px');
  const pixel = await preview.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0);
    // Sample beside the label, away from glyphs and the cell border.
    return Array.from(ctx.getImageData(81, 34, 1, 1).data);
  });
  expect(pixel).toEqual([26, 43, 60, 255]);
  await page.screenshot({path: testInfo.outputPath('statistics-export.png')});
  await page.getByRole('button', {name: '透明背景', exact: true}).click();
  const alpha = await preview.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
  expect(alpha).toBe(0);
  await page.getByLabel('附加用色统计', {exact: true}).uncheck();
  await expect(page.locator('.export-spec')).toContainText('160 × 160 px');
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', {name: '下载 PNG', exact: true}).click();
  const png = await downloadEvent, filename = testInfo.outputPath('rgb-clean.png'); await png.saveAs(filename);
  await dismissSuccess(page, '导出成功');
  await page.getByRole('button', {name: '关闭', exact: true}).click();
  await clickTool(page, '外部取色');
  await page.getByLabel('HEX 颜色', {exact: true}).fill('#FFFFFF');
  await page.getByLabel('选择取色图片', {exact: true}).setInputFiles(filename);
  await expect(page.locator('.picker-image.ready')).toBeVisible();
  await page.getByLabel('图片取色画布', {exact: true}).click();
  await expect(page.getByLabel('HEX 颜色', {exact: true})).toHaveValue('#1A2B3C');
});

test('recommendations preserve original RGB and apply a chosen MARD color', async ({page}, testInfo) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await loadPattern(page, 8, 8, []);
  await clickTool(page, '外部取色');
  await page.getByLabel('HEX 颜色', {exact: true}).fill('#8CC9DE');
  const recommended = page.getByRole('button', {name: /^推荐颜色 /});
  await expect(recommended).toHaveCount(3);
  const label = await recommended.first().getAttribute('aria-label');
  const colorCode = label!.replace('推荐颜色 ', '');
  await recommended.first().click();
  await expect(page.locator('.picker-selection strong')).toHaveText(colorCode);
  await expect(page.locator('.picker-result strong')).toHaveText('RGB(140, 201, 222)');
  await expect(page.getByLabel('HEX 颜色', {exact: true})).toHaveValue('#8CC9DE');
  await page.getByRole('button', {name: '使用原始颜色', exact: true}).click();
  await expect(page.locator('.picker-selection strong')).toHaveText('RGB(140, 201, 222)');
  await recommended.first().click();
  await page.screenshot({path: testInfo.outputPath('color-recommendations.png')});
  await page.getByRole('button', {name: '使用此颜色', exact: true}).click();
  await clickTool(page, '填色');
  await page.getByTestId('board').click();
  const cells = await savedCells(page);
  expect(cells).toHaveLength(64); expect(new Set(cells.map(c => c.colorCode))).toEqual(new Set([colorCode.replace(/^(\D+)0+(\d+)$/, '$1$2')]));
  await clickTool(page, '外部取色');
  await page.getByLabel('HEX 颜色', {exact: true}).fill('#1A2B3C');
  await recommended.first().click(); await page.getByLabel('HEX 颜色', {exact: true}).fill('#123456');
  await expect(page.getByRole('button', {name: '使用原始颜色', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: '使用此颜色', exact: true}).click();
  await clickTool(page, '填色');
  await page.getByTestId('board').click();
  expect((await savedCells(page)).every(c => c.colorCode === '#123456')).toBe(true);
});

test('bead mode isolates used colors without editing or changing export data', async ({page}, testInfo) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  const original = [{x: 1, y: 1, colorCode: 'H7'}, {x: 1, y: 2, colorCode: 'H7'}, {x: 2, y: 1, colorCode: 'F9'}, {x: 3, y: 1, colorCode: '#123456'}];
  await loadPattern(page, 8, 8, original, true);
  await openActions(page); await expect(page.getByRole('button', {name: '拼豆模式', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: '画布操作', exact: true}).click();
  await page.getByRole('button', {name: '筛选颜色 H07', exact: true}).click();
  await page.locator('.zoom-value').click();
  expect(await sampleBoard(page, 1, 1)).toEqual([0, 0, 0, 255]);
  expect(await sampleBoard(page, 2, 1)).toEqual([241, 243, 242, 255]);
  expect(await sampleBoard(page, 3, 1)).toEqual([255, 255, 255, 255]);
  await expect(page.getByRole('button', {name: '画笔', exact: true, includeHidden: true})).toBeDisabled();
  await expect(page.getByRole('button', {name: '清空画布', exact: true, includeHidden: true})).toBeDisabled();
  await page.getByTestId('board').click();
  expect(await savedCells(page)).toEqual(original.sort((a, b) => a.y - b.y || a.x - b.x));
  await clickTool(page, '查看用色统计');
  await expect(page.getByTestId('usage-total')).toHaveText('3 色4 颗拼豆');
  await page.getByRole('button', {name: '已用颜色 F09，1 颗', exact: true}).click();
  await page.screenshot({path: testInfo.outputPath('used-color-statistics.png')});
  await hidePalette(page);
  expect(await sampleBoard(page, 1, 1)).toEqual([255, 255, 255, 255]);
  await clickTool(page, '导出');
  await page.getByRole('button', {name: '透明背景', exact: true}).click();
  const pixel = await page.getByAltText('图纸导出预览').evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0);
    return Array.from(ctx.getImageData(103, 23, 1, 1).data);
  });
  expect(pixel).toEqual([0, 0, 0, 255]);
  await page.getByRole('button', {name: '关闭', exact: true}).click();
  await clickTool(page, '绘图模式');
  await page.getByRole('button', {name: '适配画布', exact: true}).click();
  const toolbarFits = await page.locator('.actions-menu').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return element.scrollWidth <= element.clientWidth && [...element.querySelectorAll('button')].every(button => {
      const r = button.getBoundingClientRect();
      return r.left >= bounds.left && r.right <= bounds.right && button.scrollWidth <= button.clientWidth;
    });
  });
  expect(toolbarFits).toBe(true);
  await page.screenshot({path: testInfo.outputPath('drawing-mode.png')});
  expect(await savedCells(page)).toHaveLength(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mirrors, clear confirmation and realtime statistics follow undo and recovery', async ({page}) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await loadPattern(page, 8, 6, [{x: 1, y: 1, colorCode: 'F9'}, {x: 2, y: 1, colorCode: 'F9'}, {x: 0, y: 5, colorCode: '#123456'}]);
  await clickTool(page, '水平镜像');
  expect(await savedCells(page)).toEqual([{x: 5, y: 1, colorCode: 'F9'}, {x: 6, y: 1, colorCode: 'F9'}, {x: 7, y: 5, colorCode: '#123456'}]);
  await clickTool(page, '撤回');
  await clickTool(page, '垂直镜像');
  expect(await savedCells(page)).toEqual([{x: 0, y: 0, colorCode: '#123456'}, {x: 1, y: 4, colorCode: 'F9'}, {x: 2, y: 4, colorCode: 'F9'}]);
  page.once('dialog', dialog => dialog.dismiss());
  await clickTool(page, '清空画布'); await expect(page.locator('.bead-count')).toHaveText('3 颗拼豆');
  page.once('dialog', dialog => dialog.accept());
  await clickTool(page, '清空画布'); await expect(page.locator('.bead-count')).toHaveText('0 颗拼豆');
  await clickTool(page, '撤回'); await expect(page.locator('.bead-count')).toHaveText('3 颗拼豆');
  await clickTool(page, '查看用色统计');
  await expect(page.getByRole('button', {name: '已用颜色 F09，2 颗', exact: true})).toBeVisible();
  await expect(page.getByTestId('usage-total')).toHaveText('2 色3 颗拼豆');
  await page.getByRole('button', {name: '色号', exact: true}).click();
  await hidePalette(page);
  await clickTool(page, '橡皮擦');
  await page.getByRole('button', {name: '橡皮擦尺寸 8 × 8', exact: true}).click();
  await page.getByTestId('board').click(); await expect(page.locator('.bead-count')).toHaveText('0 颗拼豆');
  await clickTool(page, '查看用色统计'); await expect(page.getByTestId('usage-total')).toHaveText('0 色0 颗拼豆');
  await hidePalette(page); await clickTool(page, '撤回');
  await page.reload(); await expect(page.getByTestId('board')).toBeVisible(); await expect(page.locator('.bead-count')).toHaveText('3 颗拼豆');
});

test('cell labels scale with canvas zoom within readable limits', async ({page}) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(...args: Parameters<typeof original>) {
      if (args[0] === 'H07') (window as typeof window & {labelFont: string}).labelFont = this.font;
      return original.apply(this, args);
    };
  });
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await loadPattern(page, 8, 8, [{x: 1, y: 1, colorCode: 'H7'}]); await page.locator('.zoom-value').click();
  const font = () => page.evaluate(() => parseFloat(/([\d.]+)px/.exec((window as typeof window & {labelFont: string}).labelFont)![1]));
  const normal = await font();
  for (let n = 0; n < 4; n++) await clickTool(page, '放大');
  expect(await font()).toBeGreaterThan(14); expect(await font()).toBeGreaterThan(normal);
  for (let n = 0; n < 6; n++) await clickTool(page, '放大');
  expect(await font()).toBeLessThanOrEqual(26);
  await page.locator('.zoom-value').click(); expect(await font()).toBeCloseTo(normal);
});

test('center color and cell-label visibility persist and affect canvas and PNG', async ({page}, testInfo) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await loadPattern(page, 8, 8, [{x: 1, y: 1, colorCode: 'H7'}]);
  await page.getByRole('button', {name: '画布设置', exact: true}).click();
  await page.getByLabel('中心线颜色', {exact: true}).fill('#1a2b3c');
  await page.getByLabel('显示格内色号', {exact: true}).uncheck();
  await page.getByRole('button', {name: '完成', exact: true}).click();
  await page.reload(); await expect(page.getByTestId('board')).toBeVisible();
  await page.getByRole('button', {name: '画布设置', exact: true}).click();
  await expect(page.getByLabel('中心线颜色', {exact: true})).toHaveValue(/^#1a2b3c$/i);
  await expect(page.getByLabel('显示格内色号', {exact: true})).not.toBeChecked();
  await page.screenshot({path: testInfo.outputPath('display-settings.png')});
  await page.getByRole('button', {name: '完成', exact: true}).click();
  await page.locator('.zoom-value').click();
  expect(await sampleBoard(page, 1.35, 1.35)).toEqual([0, 0, 0, 255]);
  await clickTool(page, '导出');
  const result = await page.getByAltText('图纸导出预览').evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0);
    const pixels = Array.from(ctx.getImageData(106, 47, 8, 14).data);
    return {allBlack: pixels.every((n, i) => i % 4 === 3 ? n === 255 : n === 0), center: Array.from(ctx.getImageData(160, 30, 1, 1).data)};
  });
  expect(result.allBlack).toBe(true);
  expect(result.center[0]).toBeLessThan(result.center[1]); expect(result.center[1]).toBeLessThan(result.center[2]); expect(result.center[2]).toBeLessThan(180);
});

test('eraser outlines the full irregular stroke, replaces it and clears it on undo', async ({page}, testInfo) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await loadPattern(page, 8, 8, [
    {x: 1, y: 1, colorCode: 'H7'}, {x: 1, y: 2, colorCode: 'H7'}, {x: 1, y: 3, colorCode: 'H7'},
    {x: 2, y: 3, colorCode: 'H7'}, {x: 3, y: 3, colorCode: 'H7'}, {x: 5, y: 5, colorCode: 'F9'},
  ]);
  await page.locator('.zoom-value').click();
  await clickTool(page, '橡皮擦');
  const board = page.getByTestId('board'), bounds = await board.boundingBox();
  if (!bounds) throw new Error('Canvas not rendered');
  const point = (x: number, y: number) => ({x: bounds.x + bounds.width / 2 - 80 + x * 20 + 10, y: bounds.y + bounds.height / 2 - 80 + y * 20 + 10});
  await page.mouse.move(point(1, 1).x, point(1, 1).y); await page.mouse.down();
  await page.mouse.move(point(1, 3).x, point(1, 3).y, {steps: 6});
  await page.mouse.move(point(3, 3).x, point(3, 3).y, {steps: 6}); await page.mouse.up();
  await expect(page.locator('.bead-count')).toHaveText('1 颗拼豆');
  async function hasOutline(x: number, y: number, horizontal = false) {
    return board.evaluate((element: HTMLCanvasElement, p) => {
      const dpr = window.devicePixelRatio || 1, ctx = element.getContext('2d')!;
      const x = element.clientWidth / 2 - 80 + p.x * 20, y = element.clientHeight / 2 - 80 + p.y * 20;
      const pixels = ctx.getImageData(Math.round((x - (p.horizontal ? 0 : 1)) * dpr), Math.round((y - (p.horizontal ? 1 : 0)) * dpr), Math.round((p.horizontal ? 12 : 3) * dpr), Math.round((p.horizontal ? 3 : 20) * dpr)).data;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] - pixels[i] > 40 && pixels[i + 2] - pixels[i + 1] > 20) return true;
      return false;
    }, {x, y, horizontal});
  }
  expect(await hasOutline(1, 1)).toBe(true);
  expect(await hasOutline(2.2, 1, true)).toBe(false);
  expect(await hasOutline(1.2, 2, true)).toBe(false);
  await page.screenshot({path: testInfo.outputPath('irregular-erased-outline.png')});
  await board.click({position: {x: bounds.width / 2 - 80 + 5 * 20 + 10, y: bounds.height / 2 - 80 + 5 * 20 + 10}});
  await expect(page.locator('.bead-count')).toHaveText('0 颗拼豆');
  expect(await hasOutline(1, 1)).toBe(false); expect(await hasOutline(5, 5)).toBe(true);
  await clickTool(page, '撤回');
  expect(await hasOutline(5, 5)).toBe(false);
  await clickTool(page, '反撤回');
  expect(await hasOutline(5, 5)).toBe(true);
});

test('rectangle selection deletes only its colors, confirms, undoes and persists', async ({page}, testInfo) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  const original = [{x: 1, y: 1, colorCode: 'H7'}, {x: 2, y: 2, colorCode: '#123456'}, {x: 6, y: 6, colorCode: 'F9'}];
  await loadPattern(page, 8, 8, original); await page.locator('.zoom-value').click(); await clickTool(page, '选区');
  const bounds = await page.getByTestId('board').boundingBox(); if (!bounds) throw new Error('Canvas not rendered');
  const point = (x: number, y: number) => ({x: bounds.x + bounds.width / 2 - 80 + x * 20 + 10, y: bounds.y + bounds.height / 2 - 80 + y * 20 + 10});
  await page.mouse.move(point(1, 1).x, point(1, 1).y); await page.mouse.down();
  await page.mouse.move(point(2, 2).x, point(2, 2).y, {steps: 6}); await page.mouse.up();
  const selection = page.getByTestId('selection-size'), remove = selection.getByRole('button', {name: '删除选区颜色', exact: true});
  await expect(selection).toContainText('选区 2 × 2'); await expect(remove).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss()); await remove.click();
  expect(await savedCells(page)).toEqual(original); await expect(page.getByRole('button', {name: '撤回', exact: true, includeHidden: true})).toBeDisabled();
  page.once('dialog', dialog => dialog.accept()); await remove.click();
  await expect(selection).toContainText('选区 2 × 2'); await expect(remove).toBeDisabled();
  expect(await savedCells(page)).toEqual([original[2]]);
  await clickTool(page, '查看用色统计');
  await expect(page.getByTestId('usage-total')).toHaveText('1 色1 颗拼豆'); await hidePalette(page);
  await page.screenshot({path: testInfo.outputPath('selection-deleted.png')});
  await clickTool(page, '撤回'); expect(await savedCells(page)).toEqual(original);
  await expect(page.getByRole('button', {name: '撤回', exact: true, includeHidden: true})).toBeDisabled();
  await clickTool(page, '反撤回'); expect(await savedCells(page)).toEqual([original[2]]);
  await page.reload(); await expect(page.getByTestId('board')).toBeVisible(); expect(await savedCells(page)).toEqual([original[2]]);
});

test('rectangle selection moves colors, exports a crop and undoes as one step', async ({page}, testInfo) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  const original = [{x: 1, y: 1, colorCode: 'H7'}, {x: 2, y: 2, colorCode: '#123456'}, {x: 6, y: 6, colorCode: 'F9'}];
  await loadPattern(page, 8, 8, original);
  await page.locator('.zoom-value').click(); await clickTool(page, '选区');
  const board = page.getByTestId('board'), bounds = await board.boundingBox();
  if (!bounds) throw new Error('Canvas not rendered');
  const point = (x: number, y: number) => ({x: bounds.x + bounds.width / 2 - 80 + x * 20 + 10, y: bounds.y + bounds.height / 2 - 80 + y * 20 + 10});
  async function drag(from: {x: number; y: number}, to: {x: number; y: number}) {
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, {steps: 6}); await page.mouse.up();
  }
  await drag(point(1, 1), point(2, 2));
  await expect(page.getByTestId('selection-size')).toContainText('选区 2 × 2');
  await drag(point(1, 1), point(4, 2));
  expect(await savedCells(page)).toEqual([{x: 4, y: 2, colorCode: 'H7'}, {x: 5, y: 3, colorCode: '#123456'}, {x: 6, y: 6, colorCode: 'F9'}]);
  await page.getByRole('button', {name: '导出选区', exact: true}).click();
  await expect(page.getByLabel('导出范围', {exact: true})).toHaveValue('selection');
  await page.getByRole('button', {name: '透明背景', exact: true}).click();
  await page.getByLabel('附加用色统计', {exact: true}).uncheck();
  await expect(page.locator('.export-spec')).toContainText('40 × 40 px');
  await page.screenshot({path: testInfo.outputPath('selection-export.png')});
  const pixel = await page.getByAltText('图纸导出预览').evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0);
    return [Array.from(ctx.getImageData(3, 3, 1, 1).data), Array.from(ctx.getImageData(23, 23, 1, 1).data), ctx.getImageData(23, 3, 1, 1).data[3]];
  });
  expect(pixel).toEqual([[0, 0, 0, 255], [18, 52, 86, 255], 0]);
  await page.getByRole('button', {name: '关闭', exact: true}).click();
  await clickTool(page, '撤回'); expect(await savedCells(page)).toEqual(original);
  await clickTool(page, '反撤回'); expect(await savedCells(page)).toHaveLength(3);
  await page.reload(); await expect(page.getByTestId('board')).toBeVisible();
  expect((await savedCells(page))[0]).toEqual({x: 4, y: 2, colorCode: 'H7'});
});

test('four frozen rulers remain on viewport edges after zoom and pan', async ({page}, testInfo) => {
  await page.goto('/'); const board = page.getByTestId('board'); await expect(board).toBeVisible();
  for (let i = 0; i < 6; i++) await page.getByRole('button', {name: '放大', exact: true}).click();
  async function rulerInk() {
    return board.evaluate((element: HTMLCanvasElement) => {
      const ctx = element.getContext('2d')!, dpr = window.devicePixelRatio || 1, w = element.width, h = element.height, r = Math.round(26 * dpr);
      return [[r, 0, w - r * 2, r], [r, h - r, w - r * 2, r], [0, r, r, h - r * 2], [w - r, r, r, h - r * 2]].map(([x, y, width, height]) => {
        const data = ctx.getImageData(x, y, width, height).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] < 170 && data[i + 1] < 180 && data[i + 2] < 180) count++;
        return count;
      });
    });
  }
  expect((await rulerInk()).every(count => count > 10)).toBe(true);
  await clickTool(page, '移动');
  const bounds = await board.boundingBox(); if (!bounds) throw new Error('Canvas not rendered');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 65, bounds.y + bounds.height / 2 + 45, {steps: 6}); await page.mouse.up();
  expect((await rulerInk()).every(count => count > 10)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('frozen-rulers.png')});
});

test('a second finger cancels selection movement without changing the saved pattern', async ({page, browserName}) => {
  test.skip(browserName !== 'chromium', 'Touch injection requires Chromium CDP');
  test.skip(!(await page.evaluate(() => navigator.maxTouchPoints > 0)), 'Touchscreen gesture test');
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  const original = [{x: 1, y: 1, colorCode: 'H7'}, {x: 2, y: 2, colorCode: '#123456'}];
  await loadPattern(page, 8, 8, original); await page.locator('.zoom-value').click(); await clickTool(page, '选区');
  const bounds = await page.getByTestId('board').boundingBox(); if (!bounds) throw new Error('Canvas not rendered');
  const point = (x: number, y: number, id = 0) => ({x: bounds.x + bounds.width / 2 - 80 + x * 20 + 10, y: bounds.y + bounds.height / 2 - 80 + y * 20 + 10, id});
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point(1, 1)]});
  await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [point(2, 2)]});
  await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect(page.getByTestId('selection-size')).toContainText('选区 2 × 2');
  await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point(1, 1)]});
  await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [point(3, 2)]});
  await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point(3, 2), point(6, 5, 1)]});
  await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await touch.detach();
  expect(await savedCells(page)).toEqual(original);
  await expect(page.getByRole('button', {name: '撤回', exact: true, includeHidden: true})).toBeDisabled();
});

test('eraser sizes open from the tool, remember the choice and preserve toolbar layout', async ({page}, testInfo) => {
  await page.goto('/'); const board = page.getByTestId('board'); await expect(board).toBeVisible();
  const dock = page.getByRole('navigation', {name: '绘图工具'}), eraser = dock.getByRole('button', {name: '橡皮擦', exact: true});
  expect(await dock.locator('.dock-tools > button, .dock-eraser > button, .dock-brush > button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))))
    .toEqual(['移动', '画笔', '橡皮擦', '画布取色', '选区', '外部取色', '画布设置']);
  const before = await board.boundingBox(), dockBefore = await dock.boundingBox();
  await eraser.click(); const sizes = dock.getByRole('group', {name: '橡皮擦尺寸', exact: true});
  await expect(eraser).toHaveAttribute('aria-expanded', 'true');
  await expect(sizes.getByRole('button', {name: '橡皮擦尺寸 1 × 1', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.workspace-topline select')).toHaveCount(0);
  expect(await board.boundingBox()).toEqual(before); expect(await dock.boundingBox()).toEqual(dockBefore);
  const viewport = page.viewportSize()!, popup = (await sizes.boundingBox())!;
  expect(popup.x).toBeGreaterThanOrEqual(0); expect(popup.x + popup.width).toBeLessThanOrEqual(viewport.width);
  expect(popup.y).toBeGreaterThanOrEqual(0); expect(popup.y + popup.height).toBeLessThanOrEqual(dockBefore!.y);
  await page.screenshot({path: testInfo.outputPath('eraser-sizes.png')});
  const choice = sizes.getByRole('button', {name: '橡皮擦尺寸 4 × 4', exact: true});
  if (testInfo.project.use.hasTouch) await choice.tap(); else await choice.click();
  await expect(sizes).toHaveCount(0); await expect(eraser.locator('small')).toHaveText('4');
  await eraser.click(); await expect(sizes.getByRole('button', {name: '橡皮擦尺寸 4 × 4', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.workspace-footer').click({position: {x: 2, y: 2}}); await expect(sizes).toHaveCount(0);
  await eraser.click(); await page.keyboard.press('Escape'); await expect(sizes).toHaveCount(0); await expect(eraser).toBeFocused();
  await eraser.click(); await clickTool(page, '移动'); await expect(sizes).toHaveCount(0);
  expect(await board.boundingBox()).toEqual(before);
  await eraser.click(); await clickTool(page, '拼豆模式'); await expect(sizes).toHaveCount(0); await expect(eraser).toBeDisabled();
});

test('bottom dock and centered header actions preserve full canvas width', async ({page}, testInfo) => {
  await page.goto('/'); const board = page.getByTestId('board'); await expect(board).toBeVisible();
  const before = await board.boundingBox(); if (!before) throw new Error('Canvas not rendered');
  const viewport = await page.evaluate(() => ({width: window.innerWidth, height: window.innerHeight}));
  expect(before.width).toBeGreaterThanOrEqual(viewport.width - 2);
  const dock = page.getByRole('navigation', {name: '绘图工具'});
  const dockBox = (await dock.boundingBox())!;
  expect(dockBox.y).toBeGreaterThanOrEqual(before.y + before.height);
  expect(dockBox.y + dockBox.height).toBeCloseTo(viewport.height, 0);
  for (const name of ['画笔', '橡皮擦', '画布取色', '移动', '选区', '外部取色', '画布设置']) {
    const button = dock.getByRole('button', {name, exact: true}); await expect(button).toBeVisible();
    const b = (await button.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
  }
  await expect(page.getByRole('button', {name: '打开色板', exact: true})).toBeVisible();
  const actions = page.getByRole('group', {name: '作品操作'});
  const actionsBox = (await actions.boundingBox())!;
  expect(actionsBox.x + actionsBox.width / 2).toBeCloseTo(viewport.width / 2, 0);
  expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(before.y);
  await openActions(page);
  for (const name of ['撤回', '反撤回', '保存', '导出']) await expect(actions.getByRole('button', {name, exact: true})).toBeVisible();
  await dock.getByRole('button', {name: '选区', exact: true}).click();
  await expect(dock.getByRole('button', {name: '选区', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({path: testInfo.outputPath('bottom-dock.png')});
  const toggle = page.getByRole('button', {name: '打开色板', exact: true}); await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.palette-panel')).toBeVisible();
  expect((await board.boundingBox())!.width).toBe(before.width);
  expect((await board.boundingBox())!.height).toBe(before.height);
  const paletteBox = (await page.locator('.palette-panel').boundingBox())!;
  expect(paletteBox.y + paletteBox.height).toBeLessThanOrEqual(dockBox.y + 1);
  await expect(page.getByRole('button', {name: '颜色 A01', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '颜色 A01', exact: true}).click();
  await page.screenshot({path: testInfo.outputPath('bottom-palette.png')}); await hidePalette(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.palette-panel')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (testInfo.project.name === 'desktop') {
    for (const size of [{width: 320, height: 780}, {width: 844, height: 390}]) {
      await page.setViewportSize(size);
      for (const button of await dock.getByRole('button').all()) {
        const b = (await button.boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(size.width);
      }
      const a = (await actions.boundingBox())!;
      expect(a.x).toBeGreaterThanOrEqual(0); expect(a.x + a.width).toBeLessThanOrEqual(size.width);
      expect(a.x + a.width / 2).toBeCloseTo(size.width / 2, 0);
      expect((await board.boundingBox())!.height).toBeGreaterThan(80);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});
