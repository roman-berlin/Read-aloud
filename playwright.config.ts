import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || '8090';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'bun serve.ts',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    env: { PORT },
  },
});
