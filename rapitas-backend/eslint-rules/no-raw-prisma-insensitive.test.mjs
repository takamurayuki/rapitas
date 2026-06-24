/**
 * no-raw-prisma-insensitive.test.mjs
 *
 * Unit tests for the no-raw-prisma-insensitive ESLint rule.
 * Each valid/invalid case is wrapped in a bun:test `it()` so that results
 * are individually visible in `bun test` output.
 *
 * Strategy: use ESLint `Linter.verify()` directly inside each `it()`.
 * `RuleTester.run()` internally calls `describe()` which bun:test forbids
 * inside `it()` callbacks; `Linter.verify()` is framework-agnostic and
 * returns a plain message array instead.
 */

import { describe, expect, it } from 'bun:test';
import { Linter } from 'eslint';
import rule from './no-raw-prisma-insensitive.mjs';

// ---------------------------------------------------------------------------
// Linter factory helpers
// ---------------------------------------------------------------------------

/**
 * Creates a configured Linter instance with the rule under test registered.
 *
 * @param {object} [extraLanguageOptions] - additional languageOptions (e.g. parser)
 * @returns {import('eslint').Linter}
 */
function makeLinter(extraLanguageOptions = {}) {
  return new Linter();
}

/**
 * Runs the rule against `code` and returns the array of lint messages.
 *
 * @param {string} code
 * @param {object} [extraLanguageOptions]
 * @returns {import('eslint').Linter.LintMessage[]}
 */
function runRule(code, extraLanguageOptions = {}) {
  const linter = makeLinter();
  return linter.verify(code, {
    plugins: {
      local: { rules: { 'no-raw-prisma-insensitive': rule } },
    },
    rules: { 'local/no-raw-prisma-insensitive': 'error' },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ...extraLanguageOptions,
    },
  });
}

// ---------------------------------------------------------------------------
// Valid cases — should produce zero lint messages
// ---------------------------------------------------------------------------

describe('no-raw-prisma-insensitive — valid', () => {
  it('① getInsensitiveMode() spread — correct usage', () => {
    const msgs = runRule(`const where = { contains: search, ...getInsensitiveMode() };`);
    expect(msgs).toHaveLength(0);
  });

  it("② mode with a value other than 'insensitive' — not a Prisma insensitive filter", () => {
    const msgs = runRule(`const filter = { mode: 'default' };`);
    expect(msgs).toHaveLength(0);
  });

  it('③ mode with a variable reference — dynamic value, cannot statically detect', () => {
    const msgs = runRule(`const filter = { mode: someVar };`);
    expect(msgs).toHaveLength(0);
  });

  it('④ property named something other than mode', () => {
    const msgs = runRule(`const opts = { strategy: 'insensitive' };`);
    expect(msgs).toHaveLength(0);
  });

  it("⑤ 'sensitive' is fine", () => {
    const msgs = runRule(`const filter = { mode: 'sensitive' };`);
    expect(msgs).toHaveLength(0);
  });

  it("⑥ computed property key that happens to equal 'mode' at runtime — not statically detectable", () => {
    const msgs = runRule(`const key = 'mode'; const filter = { [key]: 'insensitive' };`);
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid cases — should produce exactly one message with rawInsensitive
// ---------------------------------------------------------------------------

describe('no-raw-prisma-insensitive — invalid', () => {
  it("① Plain object literal with raw mode: 'insensitive'", () => {
    const msgs = runRule(`const where = { contains: search, mode: 'insensitive' };`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('rawInsensitive');
  });

  it('② Ternary building the object with mode inline', () => {
    const msgs = runRule(`const filter = isPostgres ? { mode: 'insensitive' } : {};`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('rawInsensitive');
  });

  it('③ Inside a local helper function — still a violation', () => {
    const msgs = runRule(
      `function makeFilter(val) { return { equals: val, mode: 'insensitive' }; }`,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('rawInsensitive');
  });

  it("④ String-keyed property ('mode' as Literal key)", () => {
    const msgs = runRule(`const filter = { 'mode': 'insensitive' };`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('rawInsensitive');
  });

  it('⑤ Arrow function returning inline insensitive object', () => {
    const msgs = runRule(`const makeFilter = (v) => ({ equals: v, mode: 'insensitive' });`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('rawInsensitive');
  });
});

// ---------------------------------------------------------------------------
// TypeScript `as const` — requires @typescript-eslint/parser
// Exercises the TSAsExpression code path in no-raw-prisma-insensitive.mjs:62-68
// ---------------------------------------------------------------------------

// NOTE: A separate languageOptions object is needed because @typescript-eslint/parser
// must be applied only to TypeScript-syntax cases; the existing JS cases remain
// on the default espree parser for correctness and backward compatibility.
import tsParser from '@typescript-eslint/parser';

describe('no-raw-prisma-insensitive — TypeScript (as const)', () => {
  it("⑥TS { mode: 'insensitive' as const } — TSAsExpression path flagged as invalid", () => {
    const msgs = runRule(`const filter = { mode: 'insensitive' as const };`, {
      parser: tsParser,
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('rawInsensitive');
  });
});
