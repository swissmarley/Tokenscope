import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  },
  webServer: {
    command: 'npm run dev:web',
    port,
    reuseExistingServer: true,
    env: { PORT: String(port) },
  },
});
