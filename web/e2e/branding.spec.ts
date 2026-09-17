import {expect, test} from '@playwright/test';

test('new photo logo and name are used in the editor and installation metadata', async ({page}, testInfo) => {
  const name = '老派拼豆之必要';
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page).toHaveTitle(name);
  await expect(page.locator('.brand')).toContainText(name);
  const logo = page.locator('.brand img');
  await expect(logo).toHaveAttribute('src', '/icons/laopai-192.png');
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(192);
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', name);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/laopai-180.png');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/icons/laopai-32.png');

  if (await page.locator('.brand span').isVisible()) {
    const brand = (await page.locator('.brand').boundingBox())!;
    const actions = (await page.locator('.header-actions').boundingBox())!;
    expect(brand.x + brand.width).toBeLessThanOrEqual(actions.x);
  }

  // Development mode omits the generated PWA manifest.
  const manifestLink = page.locator('link[rel="manifest"]');
  if (await manifestLink.count()) {
    const response = await page.request.get((await manifestLink.getAttribute('href'))!);
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.name).toBe(name);
    expect(manifest.short_name).toBe(name);
    expect(manifest.icons).toEqual([
      {src: '/icons/laopai-192.png', sizes: '192x192', type: 'image/png'},
      {src: '/icons/laopai-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable'},
    ]);
  }
  await page.screenshot({path: testInfo.outputPath('new-branding.png')});
});
