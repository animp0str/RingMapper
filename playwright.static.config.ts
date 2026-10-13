import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: ['web-workspace.spec.ts', 'website-refinements.spec.ts', 'archives-example.spec.ts'], timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4175', headless: true, viewport: { width: 1440, height: 1100 }, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', screenshot: 'only-on-failure' },
  webServer: { command: 'python -m http.server 4175 --bind 127.0.0.1 --directory dist', url: 'http://127.0.0.1:4175', reuseExistingServer: false, timeout: 30000 }
});
