/**
 * no-unscoped-pr-number-lookup.test.mjs
 *
 * Unit tests for the no-unscoped-pr-number-lookup ESLint rule.
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
import rule from './no-unscoped-pr-number-lookup.mjs';

// ---------------------------------------------------------------------------
// Linter helper
// ---------------------------------------------------------------------------

/**
 * Runs the rule against `code` and returns the array of lint messages.
 *
 * @param {string} code
 * @param {object} [extraLanguageOptions]
 * @returns {import('eslint').Linter.LintMessage[]}
 */
function runRule(code, extraLanguageOptions = {}) {
  const linter = new Linter();
  return linter.verify(code, {
    plugins: {
      local: { rules: { 'no-unscoped-pr-number-lookup': rule } },
    },
    rules: { 'local/no-unscoped-pr-number-lookup': 'error' },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ...extraLanguageOptions,
    },
  });
}

// ---------------------------------------------------------------------------
// Invalid cases — should produce exactly one unscopedPrNumber message
// ---------------------------------------------------------------------------

describe('no-unscoped-pr-number-lookup — invalid', () => {
  it('① findFirst with lone prNumber shorthand', () => {
    const msgs = runRule(
      `prisma.gitHubPullRequest.findFirst({ where: { prNumber } });`,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('unscopedPrNumber');
  });

  it('② findFirst with prNumber + non-scope siblings (state) — still unscoped', () => {
    const msgs = runRule(
      `prisma.gitHubPullRequest.findFirst({ where: { prNumber: 7, state: 'open' } });`,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('unscopedPrNumber');
  });

  it('③ findMany with lone prNumber', () => {
    const msgs = runRule(
      `prisma.gitHubPullRequest.findMany({ where: { prNumber } });`,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('unscopedPrNumber');
  });

  it('④ updateMany with lone prNumber — method names are not enumerated', () => {
    const msgs = runRule(
      `prisma.gitHubPullRequest.updateMany({ where: { prNumber }, data: {} });`,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('unscopedPrNumber');
  });

  it('⑤ tx.gitHubPullRequest — tail property name matches any client object', () => {
    const msgs = runRule(
      `tx.gitHubPullRequest.findFirst({ where: { prNumber } });`,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('unscopedPrNumber');
  });

  it('⑥ nested OR: [{ prNumber }] — subtree traversal catches nested lone use', () => {
    const msgs = runRule(
      `prisma.gitHubPullRequest.findFirst({ where: { OR: [{ prNumber }] } });`,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('unscopedPrNumber');
  });
});

// ---------------------------------------------------------------------------
// Valid cases — should produce zero lint messages
// ---------------------------------------------------------------------------

describe('no-unscoped-pr-number-lookup — valid', () => {
  it('① integrationId sibling in the same where object', () => {
    const msgs = runRule(
      `prisma.gitHubPullRequest.findFirst({ where: { integrationId, prNumber, state: 'open' } });`,
    );
    expect(msgs).toHaveLength(0);
  });

  it('② composite key integrationId_prNumber — both keys share the inner object', () => {
    const msgs = runRule(
      `prisma.gitHubPullRequest.findFirst({ where: { integrationId_prNumber: { integrationId, prNumber } } });`,
    );
    expect(msgs).toHaveLength(0);
  });

  it('③ spread sibling — fail-open, scope may come from the spread', () => {
    const msgs = runRule(
      `prisma.gitHubPullRequest.findFirst({ where: { ...scope, prNumber } });`,
    );
    expect(msgs).toHaveLength(0);
  });

  it('④ prNumber only inside select — where is inspected, select is not', () => {
    const msgs = runRule(
      `prisma.gitHubPullRequest.findFirst({ select: { prNumber: true }, where: { linkedTaskId } });`,
    );
    expect(msgs).toHaveLength(0);
  });

  it('⑤ log payload — not a gitHubPullRequest query call', () => {
    const msgs = runRule(`log.warn({ prNumber: c.prNumber });`);
    expect(msgs).toHaveLength(0);
  });

  it('⑥ other model delegate (task) — only gitHubPullRequest is inspected', () => {
    const msgs = runRule(
      `prisma.task.findFirst({ where: { githubPrId } });`,
    );
    expect(msgs).toHaveLength(0);
  });

  it('⑦ where passed as variable reference — statically opaque, fail-open', () => {
    const msgs = runRule(
      `const where = q; prisma.gitHubPullRequest.findFirst({ where });`,
    );
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TypeScript syntax — requires @typescript-eslint/parser
// ---------------------------------------------------------------------------

// NOTE: A separate languageOptions object is needed because @typescript-eslint/parser
// must be applied only to TypeScript-syntax cases; the JS cases above remain on the
// default espree parser (same approach as no-raw-prisma-insensitive.test.mjs).
import tsParser from '@typescript-eslint/parser';

describe('no-unscoped-pr-number-lookup — TypeScript syntax', () => {
  it('①TS prNumber: n as number — key-name detection is unaffected by TSAsExpression values', () => {
    const msgs = runRule(
      `prisma.gitHubPullRequest.findFirst({ where: { prNumber: n as number } });`,
      { parser: tsParser },
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('unscopedPrNumber');
  });
});
