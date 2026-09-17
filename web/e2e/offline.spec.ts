import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';

test.use({baseURL: undefined});
const mime: Record<string, string> = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
async function productionServer() {
  const root = path.resolve('dist');
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const filename = path.resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(404); response.end(); return; }
    try {
      const data = await readFile(filename);
      response.writeHead(200, {'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store'});
      response.end(data);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test server address');
  let closed = false;
  return {url: `http://127.0.0.1:${address.port}/`, stop: async () => {
    if (closed) return; closed = true;
    const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await stopped;
  }};
}

test('cached production app reopens offline, recovers, edits and downloads locally', async ({page, context, browserName}) => {
  const server = await productionServer();
  try {
  await page.goto(server.url); await expect(page.getByTestId('board')).toBeVisible();
  await page.getByTestId('board').click();
  await expect(page.locator('.save-status')).toHaveText(/已自动保存/);
  await expect(page.getByText('离线可用', {exact: true})).toBeVisible({timeout: 15000});
  // A fresh worker takes control on the next navigation.
  await page.reload({waitUntil: 'domcontentloaded'}); await expect(page.getByTestId('board')).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await server.stop();
  if (browserName !== 'webkit') await context.setOffline(true);
  const reopened = await page.reload({waitUntil: 'domcontentloaded'});
  expect(reopened?.fromServiceWorker()).toBe(true);
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('.bead-count')).toHaveText('1 颗拼豆');
  await page.getByRole('button', {name: '适配画布', exact: true}).click();
  const board = (await page.getByTestId('board').boundingBox())!;
  await page.getByTestId('board').click({position: {x: board.width / 2 + 30, y: board.height / 2}});
  await expect(page.locator('.bead-count')).toHaveText('2 颗拼豆');
  await expect(page.locator('.save-status')).toHaveText(/已自动保存/);
  await page.getByRole('button', {name: '保存', exact: true}).click();
  const fileEvent = page.waitForEvent('download'); await page.getByRole('button', {name: '保存到本地', exact: false}).click();
  const filePath = await (await fileEvent).path(); expect(filePath).toBeTruthy();
  expect(JSON.parse(await readFile(filePath!, 'utf8')).snapshot.cells).toHaveLength(2);
  await page.getByRole('button', {name: '导出', exact: true}).click();
  const imageEvent = page.waitForEvent('download'); await page.getByRole('button', {name: '下载 PNG', exact: true}).click();
  expect((await imageEvent).suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole('button', {name: '关闭', exact: true}).click();
  const originalPage = page;
  page = await context.newPage(); await originalPage.close();
  const fresh = await page.goto(server.url, {waitUntil: 'domcontentloaded'});
  expect(fresh?.fromServiceWorker()).toBe(true);
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('.bead-count')).toHaveText('2 颗拼豆');
  } finally { await server.stop(); }
});
