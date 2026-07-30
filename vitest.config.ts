import { defineConfig } from 'vitest/config';

// Vitest is the test runner and is executed under the Bun runtime
// (`bunx --bun vitest run`), never through `bun test`.
//
// Conventions:
// - Unit tests:     `*.test.ts` / `*.test.tsx`
// - Property tests: `*.prop.test.ts` — `bun run test:props` filters on `prop.test`
// - Browser-only behavior lives in `*.e2e.ts` and is run by Playwright, not Vitest.
//
// The default environment is `node` because the ingestion suites need it. Client
// and component suites opt into jsdom per file with a docblock:
//   // @vitest-environment jsdom
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  test: {
    environment: 'node',
    include: [
      'test/**/*.test.ts',
      'test/**/*.test.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
  },
});
