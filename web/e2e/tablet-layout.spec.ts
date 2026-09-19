import {expect, test, type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {clickTool, dismissSuccess, openActions} from './helpers';

async function documentFile(page: Page) {
  await clickTool(page, '保存'); const event = page.waitForEvent('download');
  await page.getByRole('button', {name: '保存到本地', exact: false}).click();
  const location = await (await event).path(); if (!location) throw new Error('Missing downloaded pattern');
  await dismissSuccess(page, '保存成功');
  return JSON.parse(await readFile(location, 'utf8'));
}

test('compact header menus and full-width palette fit touch screens', async ({page}, testInfo) => {
  await page.goto('/'); const board = page.getByTestId('board'); await expect(board).toBeVisible();
  const viewport = page.viewportSize()!, header = (await page.locator('.app-header').boundingBox())!;
  expect(header.height).toBeLessThanOrEqual(76);
  await expect(page.locator('.workspace-topline, .canvas-actions, .selected-color')).toHaveCount(0);
  const footer = page.locator('.workspace-footer');
  const count = (await footer.locator('.bead-count').boundingBox())!, recent = (await footer.locator('.recent-colors').boundingBox())!;
  const color = (await footer.getByRole('button', {name: '打开色板', exact: true}).boundingBox())!;
  expect(recent.x).toBeGreaterThanOrEqual(count.x + count.width); expect(recent.x + recent.width).toBeLessThanOrEqual(color.x);
  await expect(page.getByRole('navigation', {name: '绘图工具'}).locator('.zoom-controls')).toBeVisible();
  expect((await board.boundingBox())!.width).toBeGreaterThanOrEqual(viewport.width - 1);
  const original = await board.boundingBox(); await openActions(page);
  const menu = page.getByRole('group', {name: '画布操作菜单', exact: true});
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  for (const name of ['绘图模式', '拼豆模式', '撤回', '反撤回', '查看用色统计', '水平镜像', '垂直镜像', '清空画布', '保存', '导出'])
    await expect(menu.getByRole('button', {name, exact: true})).toBeVisible();
  expect(await board.boundingBox()).toEqual(original);
  await page.screenshot({path: testInfo.outputPath('top-actions.png')});
  await page.keyboard.press('Escape'); await page.getByRole('button', {name: '打开色板', exact: true}).click();
  const palette = page.locator('.palette-panel'), toolbar = palette.locator('.palette-toolbar'), grid = palette.locator('.color-grid');
  expect((await grid.boundingBox())!.width).toBeGreaterThanOrEqual((await toolbar.boundingBox())!.width - 1);
  await expect(grid.getByRole('button')).toHaveCount(291);
  if (viewport.width >= 761) {
    const controls = [toolbar.locator('.palette-tabs'), toolbar.locator('.search-box'), toolbar.locator('.family-filter')];
    const rows = await Promise.all(controls.map(async control => { const b = (await control.boundingBox())!; return b.y + b.height / 2; }));
    expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(1);
  }
  expect(await toolbar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('wide-palette.png')});
});

test('brush contains fill and eraser contains touch-friendly sizes', async ({page}) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  const dock = page.getByRole('navigation', {name: '绘图工具'});
  expect(await dock.locator('.dock-tools > button, .dock-eraser > button, .dock-brush > button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))))
    .toEqual(['移动', '画笔', '橡皮擦', '画布取色', '选区', '外部取色', '画布设置']);
  await clickTool(page, '画笔'); const modes = page.getByRole('group', {name: '画笔方式', exact: true});
  await expect(modes.getByRole('button', {name: '单格画笔', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await clickTool(page, '填色'); await expect(page.getByTestId('board')).toHaveClass(/tool-fill/);
  await page.getByTestId('board').click(); await expect(page.locator('.bead-count')).toHaveText('1,024 颗拼豆');
  await clickTool(page, '撤回'); await expect(page.locator('.bead-count')).toHaveText('0 颗拼豆');
  await clickTool(page, '单格画笔'); await page.getByTestId('board').click(); await expect(page.locator('.bead-count')).toHaveText('1 颗拼豆');
  await clickTool(page, '橡皮擦'); await clickTool(page, '橡皮擦尺寸 2 × 2');
  await page.getByTestId('board').click(); await expect(page.locator('.bead-count')).toHaveText('0 颗拼豆');
});

test('dimension steppers and centered resize preserve history, crop confirmation and local recovery', async ({page}, testInfo) => {
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible(); await clickTool(page, '新建画布');
  await page.getByRole('button', {name: '16 × 16', exact: true}).click();
  const plus = page.getByRole('button', {name: '增加宽度', exact: true});
  if (testInfo.project.use.hasTouch) await plus.tap(); else await plus.click();
  await clickTool(page, '减少高度'); await expect(page.getByLabel('宽度（格）', {exact: true})).toHaveValue('17');
  await expect(page.getByLabel('高度（格）', {exact: true})).toHaveValue('15');
  await page.getByLabel('宽度（格）', {exact: true}).fill('1'); await expect(page.getByRole('button', {name: '减少宽度', exact: true})).toBeDisabled();
  await page.getByLabel('宽度（格）', {exact: true}).fill('200'); await expect(plus).toBeDisabled();
  await page.getByLabel('宽度（格）', {exact: true}).fill('4'); await page.getByLabel('高度（格）', {exact: true}).fill('4');
  await clickTool(page, '创建画布');
  const original = [{x: 0, y: 0, colorCode: 'H7'}, {x: 2, y: 2, colorCode: '#123456'}];
  await clickTool(page, '我的作品'); await clickTool(page, '本地打开');
  await page.getByLabel('打开作品文件', {exact: true}).setInputFiles({name: 'resize.pindou', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({fileType: 'pindou', schemaVersion: 1, name: '扩展测试', updatedAt: new Date().toISOString(), snapshot: {schemaVersion: 1, width: 4, height: 4, cells: original}}))});
  await expect(page.getByRole('button', {name: '扩展测试', exact: true})).toBeVisible();
  await clickTool(page, '画布设置'); await clickTool(page, '调整画布尺寸');
  await page.getByLabel('宽度（格）', {exact: true}).fill('8'); await page.getByLabel('高度（格）', {exact: true}).fill('6');
  await page.screenshot({path: testInfo.outputPath('resize-steppers.png')}); await clickTool(page, '应用尺寸');
  const expanded = (await documentFile(page)).snapshot;
  expect(expanded).toEqual({schemaVersion: 1, width: 8, height: 6, cells: [{x: 2, y: 1, colorCode: 'H7'}, {x: 4, y: 3, colorCode: '#123456'}]});
  await clickTool(page, '画布设置'); await clickTool(page, '调整画布尺寸');
  await page.getByLabel('宽度（格）', {exact: true}).fill('2'); await page.getByLabel('高度（格）', {exact: true}).fill('2');
  page.once('dialog', dialog => dialog.dismiss()); await clickTool(page, '应用尺寸');
  await expect(page.getByRole('dialog', {name: '调整画布尺寸', exact: true})).toBeVisible();
  page.once('dialog', dialog => dialog.accept()); await clickTool(page, '应用尺寸');
  expect((await documentFile(page)).snapshot).toEqual({schemaVersion: 1, width: 2, height: 2, cells: [{x: 1, y: 1, colorCode: '#123456'}]});
  await clickTool(page, '撤回'); expect((await documentFile(page)).snapshot).toEqual(expanded);
  await clickTool(page, '撤回'); expect((await documentFile(page)).snapshot).toEqual({schemaVersion: 1, width: 4, height: 4, cells: original});
  await clickTool(page, '反撤回'); await expect(page.locator('.save-status')).toHaveText(/已自动保存/);
  await page.reload(); await expect(page.getByTestId('board')).toBeVisible(); expect((await documentFile(page)).snapshot).toEqual(expanded);
});
