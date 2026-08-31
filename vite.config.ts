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
    // `404.html` is a build input rather than a static copy so it references the
    // same hashed assets as `index.html`. Static hosts serve it for a path they
    // have no file for, which is every `/team/{id}` deep link, and the shell then
    // routes on the address it was loaded with.
    rollupOptions: {
      input: { index: 'index.html', notFound: '404.html' },
    },
  },
});
