import {expect, test, type Page} from '@playwright/test';
import {openActions} from './helpers';

async function assertVisibleEditor(page: Page, height: number) {
  const header = (await page.locator('.app-header').boundingBox())!;
  const dock = (await page.getByRole('navigation', {name: '绘图工具'}).boundingBox())!;
  expect(header.y).toBeGreaterThanOrEqual(0);
  expect(dock.y + dock.height).toBeCloseTo(height, 0);
  expect((await page.getByTestId('board').boundingBox())!.height).toBeGreaterThan(80);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
}

test('legacy viewport keeps both toolbars visible with Safari chrome and rotation', async ({page}, testInfo) => {
  await page.setViewportSize({width: 768, height: 900});
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {height: 900, width: 768, scale: 1});
    Object.defineProperty(window, 'visualViewport', {value: viewport, configurable: true});
  });
  await page.route('**/*.css', async route => {
    const response = await route.fetch();
    // Safari 14 ignores dvh, while vh can include the browser's hidden chrome.
    const css = (await response.text()).replace(/100dvh/g, '100legacydvh').replace(/100vh/g, '1024px');
    await route.fulfill({response, body: css});
  });
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await assertVisibleEditor(page, 900);
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, {height: 700}); window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.app-shell')).toHaveCSS('height', '700px');
  await assertVisibleEditor(page, 700);
  await page.getByRole('button', {name: '打开色板', exact: true}).click();
  const palette = (await page.locator('.palette-panel').boundingBox())!;
  expect(palette.y).toBeGreaterThanOrEqual(0); expect(palette.y + palette.height).toBeLessThanOrEqual(700);
  await page.screenshot({path: testInfo.outputPath('legacy-tablet-palette.png')});
  await page.getByRole('button', {name: '收起色板', exact: true}).first().click();
  await page.setViewportSize({width: 1024, height: 650});
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, {height: 650, width: 1024}); window.dispatchEvent(new Event('orientationchange'));
  });
  await expect(page.locator('.app-shell')).toHaveCSS('height', '650px');
  await assertVisibleEditor(page, 650);
  await page.screenshot({path: testInfo.outputPath('legacy-tablet-landscape.png')});
});

test('legacy browser without structuredClone can draw, save and recover', async ({page}) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'structuredClone', {value: undefined, configurable: true}); });
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await page.getByTestId('board').click();
  await expect(page.locator('.save-status')).toHaveText(/已自动保存/, {timeout: 5000});
  await page.reload(); await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('.bead-count')).toHaveText('1 颗拼豆');
});

test('legacy browser without native dialog can save, cancel and restore focus', async ({page}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {value: undefined, configurable: true});
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {value: undefined, configurable: true});
  });
  await page.goto('/'); await expect(page.getByTestId('board')).toBeVisible();
  await openActions(page);
  const save = page.getByRole('button', {name: '保存', exact: true}); await save.focus(); await save.press('Enter');
  const modal = page.getByRole('dialog', {name: '保存作品'}); await expect(modal).toBeVisible({timeout: 5000});
  await expect(modal).toHaveAttribute('aria-modal', 'true');
  await page.screenshot({path: testInfo.outputPath('legacy-save-dialog.png')});
  await page.keyboard.press('Shift+Tab');
  expect(await modal.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0); await expect(page.getByRole('button', {name: '画布操作', exact: true})).toBeFocused();
  await openActions(page); await save.click(); await page.locator('.modal-overlay').click({position: {x: 2, y: 2}});
  await expect(modal).toHaveCount(0);
  await page.getByRole('button', {name: '外部取色', exact: true}).click();
  await expect(page.getByRole('dialog', {name: '外部取色'})).toBeVisible();
  await page.getByLabel('选择取色图片', {exact: true}).dispatchEvent('cancel');
  await expect(page.getByRole('dialog', {name: '外部取色'})).toBeVisible();
  await page.getByRole('button', {name: '关闭', exact: true}).click();
  await expect(page.getByTestId('board')).toBeVisible();
});
