import {defineConfig, devices} from '@playwright/test';
const channel = process.env.E2E_BROWSER_CHANNEL;
export default defineConfig({
  testDir: './e2e', timeout: 30000, fullyParallel: true,
  use: {baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', trace: 'retain-on-failure'},
  projects: [
    {name: 'desktop', use: {browserName: 'chromium', channel, viewport: {width: 1280, height: 800}}},
    {name: 'phone', use: {...devices['iPhone 13'], browserName: 'chromium', channel}},
    {name: 'tablet', use: {...devices['iPad (gen 7)'], browserName: 'chromium', channel}},
    {name: 'phone-small', use: {browserName: 'chromium', channel, viewport: {width: 360, height: 780}, isMobile: true, hasTouch: true}},
    {name: 'tablet-landscape', use: {browserName: 'chromium', channel, viewport: {width: 1024, height: 768}, hasTouch: true}},
    {name: 'tablet-webkit', use: {...devices['iPad (gen 7)'], browserName: 'webkit'}},
  ],
});
