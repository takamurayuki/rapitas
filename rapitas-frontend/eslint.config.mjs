import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import { stagedSeverity } from '../eslint-shared.mjs';
import noIconCollision from '../rapitas-backend/eslint-rules/no-icon-collision.mjs';

const localPlugin = { rules: { 'no-icon-collision': noIconCollision } };

// a11y ratchet: every jsx-a11y recommended rule at 'warn' so the accessibility
// gap is visible on each lint run without breaking CI; promote individual rules
// to 'error' as their violation count reaches zero (same staged pattern as
// no-console below). The plugin instance itself is registered by
// eslint-config-next/core-web-vitals — only the rule severities are set here.
const a11yWarnRules = Object.fromEntries(
  Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [rule, 'warn']),
);

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
      ...a11yWarnRules,
      // NOTE: label-has-for is deprecated upstream in favor of
      // label-has-associated-control (also active above) — running both
      // double-reports every unlabeled control.
      'jsx-a11y/label-has-for': 'off',
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
  {
    // global-error.tsx replaces the root layout (including its providers) when
    // the layout itself throws, so it cannot safely depend on app providers/stores
    // the shared logger transitively pulls in. console.error is the intentional
    // last-resort here.
    files: ['src/app/global-error.tsx'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // logger.ts is the createLogger() implementation itself — its console.*
    // calls are the actual sink every other module's logger calls funnel into.
    files: ['src/lib/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]);

export default eslintConfig;
