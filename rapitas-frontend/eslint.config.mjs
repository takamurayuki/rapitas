import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// NOTE: Staged rules default to "warn" (dev-friendly). When RAPITAS_LINT_STRICT=1,
// they escalate to "error" so the automated verification gate enforces them as hard
// failures before any merge. Set automatically by automated-verifier; do not set
// manually unless you want permanent strict mode locally.
const stagedSeverity = process.env.RAPITAS_LINT_STRICT === '1' ? 'error' : 'warn';

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
    rules: {
      // Enforce explicit typing over `any`
      '@typescript-eslint/no-explicit-any': stagedSeverity,
      // Prefer consistent type-only imports
      '@typescript-eslint/consistent-type-imports': [
        stagedSeverity,
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Catch unused variables (allow underscore prefix)
      '@typescript-eslint/no-unused-vars': [
        stagedSeverity,
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
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
]);

export default eslintConfig;
