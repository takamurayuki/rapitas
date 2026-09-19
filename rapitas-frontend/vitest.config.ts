import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vitest's default worker pool scales up to every logical core. The
// implementer/verifier TDD protocol runs `pnpm test`/`vitest` directly (see
// workflow-role-prompts.ts) on every frontend-touching task, competing with
// the backend, WebView2, and whatever else is running on the same machine at
// the same time (observed 2026-09-19: reported as "Node.js runtime CPU
// spikes"). Deliberately a FIXED absolute cap, not `cpus().length`-derived —
// a formula like `cores - 1` still scales the load up on a bigger box and
// says nothing about what else that box is doing right now, which is the
// actual constraint here. Mirrors the same fixed-cap pattern already used
// for RAPITAS_AUX_AI_CLI_CONCURRENCY (2) and RAPITAS_PR_FILES_CACHE_CONCURRENCY
// (4). This bounds PEAK concurrency only — it does not skip or scope which
// tests run, and Vitest sizes its pool once at startup (no built-in way to
// throttle further mid-run in response to real-time load). Override with
// RAPITAS_VITEST_MAX_WORKERS (e.g. for a CI runner where nothing else competes).
const maxWorkers = Number(process.env.RAPITAS_VITEST_MAX_WORKERS) || 2;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    maxWorkers,
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
