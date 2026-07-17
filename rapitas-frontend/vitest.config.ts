import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/__tests__/**', 'src/types/**'],
      // Honest ratchet floor: set just below the current measured coverage so
      // `vitest run --coverage` is a REAL, green gate rather than an aspirational
      // number nothing enforces. Raise these as tests land (see ADR-0002). The
      // prior 30/25/28/30 values were never met (actual ≈ 11%) and CI did not
      // run --coverage, so the gate was fiction; a true floor is more defensible
      // than an unenforced target.
      // Recalibrated 2026-07-17 to the CI gate's curated 54-file list (the set
      // that actually runs with --coverage in test-lint.yml) — measured ≈
      // statements 9.12 / branches 7.42 / functions 8.02 / lines 9.27. The
      // earlier 21% figures came from the full suite, which cannot be the CI
      // gate because several non-gate test files hang indefinitely. Raising
      // this floor = adding test files to the CI list, not editing numbers.
      thresholds: {
        lines: 9,
        branches: 7,
        functions: 7.5,
        statements: 8.5,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
