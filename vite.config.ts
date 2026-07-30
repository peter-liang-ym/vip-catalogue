import { defineConfig } from 'vite';

// Preact JSX is transformed by esbuild's automatic runtime, so no framework
// plugin is needed. `public/` is the default static asset directory, which is
// also where the ingestion job publishes `dataset.json` and cached images.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  build: {
    target: 'es2022',
  },
});
