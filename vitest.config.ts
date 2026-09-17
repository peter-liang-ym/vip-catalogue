import { defineConfig } from 'vitest/config';

// Vitest is the test runner and is executed under the Bun runtime
// (`bun run test`, i.e. `bun --bun run vitest run`), never through `bun test`.
// Do not use `bunx --bun vitest run`: on Windows, bunx misparses the worker
// execArgv Vitest passes to forked children and no tests execute.
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
    // The default 5s is not enough for the jsdom suites on a loaded machine: the
    // first test in a file pays the environment, Preact, and Testing Library
    // warm-up, and a `getByRole` query behind it then times out with nothing
    // actually wrong. Every assertion here is synchronous, so a larger ceiling
    // costs nothing on a passing run and only affects which failures are real.
    testTimeout: 20_000,
    include: [
      'test/**/*.test.ts',
      'test/**/*.test.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
  },
});
