import {expect, test} from '@playwright/test';
import path from 'node:path';

test('home, works and editor form one responsive workflow', async ({page}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '首页'}).first()).toBeVisible();
  await expect(page.getByRole('heading', {name: '开始新的创作'})).toBeVisible();
  await expect(page.getByText('工作台就绪', {exact: true})).toHaveCount(0);
  await expect(page.getByText('工坊常备拼豆色盘', {exact: true})).toHaveCount(0);
  await expect(page.getByText('从零构想像素图形，进入现有拼豆编辑器。', {exact: true})).toHaveCount(0);
  await expect(page.getByText('从照片或插画提取色块，生成可继续编辑的拼豆作品。', {exact: true})).toHaveCount(0);
  await expect(page.getByText('选择工坊起点，进入专注文档空间', {exact: true})).toHaveCount(0);
  await expect(page.locator('.board-spec, .palette-note, .palette-strip')).toHaveCount(0);
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
  const workCard = page.locator('.work-card').filter({hasText: '未命名拼豆图'}).first(), manageWork = workCard.getByRole('button', {name: '管理作品 未命名拼豆图'});
  await expect(workCard.locator('.work-arrow')).toHaveCount(0);
  await expect(manageWork).toBeVisible();
  const cardBox = await workCard.boundingBox(), manageBox = await manageWork.boundingBox();
  expect(cardBox && manageBox && cardBox.x + cardBox.width - manageBox.x - manageBox.width <= 1).toBe(true);
  expect(cardBox && manageBox && cardBox.y + cardBox.height - manageBox.y - manageBox.height <= 1).toBe(true);
  await page.screenshot({path: testInfo.outputPath('shell-works-with-work.png'), fullPage: true});
  await manageWork.click();
  await expect(workCard.getByRole('button', {name: '重命名'})).toBeVisible();
  await expect(workCard.getByRole('button', {name: '删除'})).toBeVisible();
  await page.screenshot({path: testInfo.outputPath('shell-works-menu.png'), fullPage: true});
  await page.getByRole('button', {name: '关闭作品菜单'}).click();
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '首页'}).first().click();
  await expect(page.getByRole('heading', {name: '最近编辑项目'})).toBeVisible();
  await expect(page.getByText('未命名拼豆图', {exact: true})).toBeVisible();
  await expect(page.getByText('WORKSPACE_ID // LOCAL', {exact: true})).toHaveCount(0);
  await expect(page.getByText(/经典方盘/)).toHaveCount(0);
  await expect(page.getByText(/所有编辑都会自动保存在本机/)).toHaveCount(0);
  await expect(page.getByText('继续完成这张拼豆图。', {exact: false})).toHaveCount(0);
  await expect(page.locator('.continue-tags i')).toBeVisible();
  if (testInfo.project.name !== 'phone-small') {
    const saved = await page.locator('.continue-tags').boundingBox(), action = await page.locator('.continue-action').boundingBox();
    expect(saved && action && Math.abs(saved.x + saved.width - action.x - action.width) <= 1).toBe(true);
    const blankTitle = await page.locator('.blank-card h2').boundingBox(), imageTitle = await page.locator('.image-card h2').boundingBox();
    expect(blankTitle && imageTitle && Math.abs(blankTitle.y - imageTitle.y) <= 1).toBe(true);
    expect((await page.locator('.blank-card .size-picker button').first().boundingBox())?.height).toBeGreaterThanOrEqual(52);
  }
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
  await expect(page.getByRole('button', {name: '显示参考图', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '显示参考图', exact: true}).click();
  await expect(page.getByRole('region', {name: '参考图窗口', exact: true})).toBeVisible();
  await expect(page.locator('.bead-count')).not.toHaveText('0 颗拼豆');
  await expect(page.getByRole('button', {name: '返回首页'})).toBeVisible();
});
