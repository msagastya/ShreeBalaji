import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4182',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 4182',
    url: 'http://127.0.0.1:4182',
    reuseExistingServer: true,
    timeout: 10000,
  },
});
