import { defineConfig, devices } from '@playwright/test';

const apiPort = '4310';
const dashboard = 'http://127.0.0.1:3310';
const env = {
  MIGRATEPROOF_API_PORT: apiPort,
  NEXT_TELEMETRY_DISABLED: '1',
};

export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1080 },
    baseURL: dashboard,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: [
    { command: 'npm run api', url: `http://127.0.0.1:${apiPort}/health`, env, timeout: 30000 },
    { command: 'npm run start -- --port 3310', url: dashboard, env, timeout: 30000 },
  ],
});
