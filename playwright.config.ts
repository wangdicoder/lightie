import { defineConfig, devices } from '@playwright/test';

const PORT = 5179;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    deviceScaleFactor: 1,
  },
  webServer: {
    command: `pnpm exec vite --config playground/vite.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/harness.html`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], deviceScaleFactor: 1 } },
  ],
});
