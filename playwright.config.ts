import { defineConfig } from '@playwright/test';

// Playwright covers only what jsdom cannot judge: real back/forward navigation,
// reflow at viewport widths, and timing. Its specs are named `*.e2e.ts` so they
// never collide with the Vitest suites in the same directory.
const baseURL = 'http://localhost:5173';

export default defineConfig({
  testDir: 'test',
  testMatch: '**/*.e2e.ts',
  use: { baseURL },
  webServer: {
    command: 'bun run dev',
    url: baseURL,
    reuseExistingServer: true,
  },
});
