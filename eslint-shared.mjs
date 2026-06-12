/**
 * eslint-shared.mjs
 *
 * Shared ESLint severity definitions for the rapitas monorepo.
 * Single source of truth for the staged-severity pattern,
 * mirroring the tsconfig.base.json precedent at repo root.
 * Not responsible for project-specific rule sets (plugins, parser, React, etc.).
 */

/**
 * Returns ESLint rule severity overrides for a named code stage.
 *
 * Three tiers enforce progressively relaxed constraints:
 *   prod    – production source; strictest gate
 *   scripts – build/tooling scripts; console allowed as warning
 *   tests   – test files; console and `any` both unrestricted
 *
 * @param {'prod'|'scripts'|'tests'} stage - The code stage.
 * @returns {Record<string, string | [string, ...unknown[]]>} ESLint rule entries ready to spread.
 * @throws {Error} If an unknown stage string is passed.
 */
export function stagedSeverity(stage) {
  switch (stage) {
    case 'prod':
      return {
        'no-console': 'error',
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': [
          'warn',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      };
    case 'scripts':
      return {
        // NOTE: Scripts may log freely, but warnings surface accidental debug output.
        'no-console': 'warn',
      };
    case 'tests':
      return {
        'no-console': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      };
    default:
      throw new Error(
        `[eslint-shared] Unknown stage: "${stage}". Valid stages: prod, scripts, tests.`
      );
  }
}
