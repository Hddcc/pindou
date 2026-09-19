import {expect, type Page} from '@playwright/test';

const actions = new Set(['撤回', '反撤回', '保存', '导出', '查看用色统计', '水平镜像', '垂直镜像', '清空画布', '绘图模式', '拼豆模式']);
export async function openActions(page: Page) {
  if (!(await page.getByRole('group', {name: '画布操作菜单', exact: true}).isVisible()))
    await page.getByRole('button', {name: '画布操作', exact: true}).click();
}
export async function clickTool(page: Page, name: string) {
  if (actions.has(name)) await openActions(page);
  if ((name === '填色' || name === '单格画笔') && !(await page.getByRole('button', {name, exact: true}).isVisible()))
    await page.getByRole('button', {name: '画笔', exact: true}).click();
  await page.getByRole('button', {name, exact: true}).click();
}
export async function dismissSuccess(page: Page, title: '保存成功' | '导出成功') {
  const dialog = page.getByRole('dialog', {name: title, exact: true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: '完成', exact: true}).click();
}
