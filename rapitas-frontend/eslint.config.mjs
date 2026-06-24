import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { stagedSeverity } from '../eslint-shared.mjs';
import noIconCollision from '../rapitas-backend/eslint-rules/no-icon-collision.mjs';

const localPlugin = { rules: { 'no-icon-collision': noIconCollision } };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Ignore scripts directory
    'scripts/**',
    // Ignore Tauri build directory
    '.next-tauri/**',
  ]),
  {
    // Match both relative paths (from rapitas-frontend/) and absolute paths (from root)
    files: ['src/**/*.{ts,tsx}', '**/rapitas-frontend/src/**/*.{ts,tsx}'],
    plugins: { local: localPlugin },
    rules: {
      ...stagedSeverity('prod'),
      // NOTE: warn (not error) — existing violations (Lightbulb ~10 files) are known;
      // raise to 'error' after auditing and replacing each violation (separate task).
      'local/no-icon-collision': 'warn',
      // NOTE: Frontend no-console starts at 'warn'; backend uses 'error'.
      // Raise to 'error' after auditing existing violations.
      'no-console': 'warn',
      // Prefer consistent type-only imports
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // React Compiler lint rules are too noisy for the existing codebase.
      // Keep the baseline lint gate hard, then re-enable these rules
      // incrementally once the affected components have been refactored.
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
    },
  },
  {
    // Test files — relax no-console and no-explicit-any
    files: [
      'src/**/__tests__/**/*.{ts,tsx}',
      '**/rapitas-frontend/src/**/__tests__/**/*.{ts,tsx}',
    ],
    rules: {
      ...stagedSeverity('tests'),
    },
  },
]);

export default eslintConfig;
