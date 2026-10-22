import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pwa', timeout: 90000, workers: 1, reporter: 'list',
  outputDir: '/tmp/coffee-pwa-results',
  use: { channel: 'chrome', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, trace: 'retain-on-failure' }
});
