import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  expect: { timeout: 15000 },
  fullyParallel: true,
  workers: 3,
  reporter: 'list',
  outputDir: '/tmp/coffee-playwright-results',
  use: { baseURL: 'http://127.0.0.1:5175', channel: 'chrome', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    env: { VITE_NEON_AUTH_URL: 'https://auth.example.invalid/neondb/auth', VITE_NEON_DATA_API_URL: 'https://data.example.invalid/rest/v1' }
  }
});
