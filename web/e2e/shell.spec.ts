import {expect, test} from '@playwright/test';
import path from 'node:path';

test('home, works and editor form one responsive workflow', async ({page}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '首页'}).first()).toBeVisible();
  await expect(page.getByRole('heading', {name: '开始新的创作'})).toBeVisible();
  await page.screenshot({path: testInfo.outputPath('shell-home.png'), fullPage: true});

  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '作品'}).first().click();
  await expect(page.getByRole('heading', {name: /作品库/})).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({path: testInfo.outputPath('shell-works.png'), fullPage: true});

  await page.getByRole('button', {name: '新建空白画布'}).click();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByRole('button', {name: '返回作品'})).toBeVisible();
  await page.getByRole('button', {name: '返回作品'}).click();
  await expect(page.getByRole('heading', {name: /作品库/})).toBeVisible();
  await expect(page.getByText('未命名拼豆图', {exact: true})).toBeVisible();
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '首页'}).first().click();
  await expect(page.getByRole('heading', {name: '最近编辑项目'})).toBeVisible();
  await expect(page.getByText('未命名拼豆图', {exact: true})).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({path: testInfo.outputPath('shell-home-with-work.png'), fullPage: true});
});

test('mobile shell keeps navigation and actions inside the viewport', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-small');
  await page.goto('/');
  await expect(page.getByRole('heading', {name: '开始新的创作'})).toBeVisible();
  const nav = page.getByRole('navigation', {name: '主导航'});
  await expect(nav.getByRole('button', {name: '首页'}).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('shell-home-mobile.png'), fullPage: true});
  await nav.getByRole('button', {name: '作品'}).last().click();
  await expect(page.getByRole('heading', {name: /作品库/})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.waitForTimeout(200);
  await page.screenshot({path: testInfo.outputPath('shell-works-mobile.png'), fullPage: true});
});

test('opening login from the shell keeps the current page', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.goto('/');
  const currentUrl = page.url();

  await page.getByRole('button', {name: '登录'}).click();

  await expect(page).toHaveURL(currentUrl);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', {name: '关闭'}).click();

  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '作品'}).first().click();
  await page.getByRole('button', {name: /云端同步/}).click();
  const worksUrl = page.url();
  await page.locator('.shell-empty').getByRole('button', {name: '登录 / 注册'}).click();

  await expect(page).toHaveURL(worksUrl);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('image entry creates a regular editable work', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.goto('/');
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles(path.resolve('public/icons/laopai-32.png'));
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('.bead-count')).not.toHaveText('0 颗拼豆');
  await expect(page.getByRole('button', {name: '返回首页'})).toBeVisible();
});
