/**
 * eslint.config.mjs (repo root)
 *
 * Flat config for root-level tooling files (scripts/**, shared configs) only.
 * Not responsible for package linting — rapitas-frontend / rapitas-backend own
 * their full plugin-based configs; this file exists so ESLint invoked from the
 * repo root (verification gate, editors) has a resolvable config instead of
 * crashing with "couldn't find eslint.config".
 */
import { stagedSeverity } from './eslint-shared.mjs';

export default [
  {
    // Packages and generated trees are linted by their own configs, never from root.
    ignores: [
      'rapitas-frontend/**',
      'rapitas-backend/**',
      'rapitas-desktop/**',
      'node_modules/**',
      '.worktrees/**',
    ],
  },
  {
    // Root plugin deps are not installed, so only core rules are available here.
    files: ['scripts/**/*.{js,cjs,mjs}', '*.{js,cjs,mjs}'],
    rules: {
      ...stagedSeverity('scripts'),
    },
  },
];
