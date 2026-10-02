/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/, so the build uses a relative base.
export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
