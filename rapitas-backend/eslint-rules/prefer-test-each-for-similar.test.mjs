/**
 * prefer-test-each-for-similar.test.mjs
 *
 * Unit tests for the prefer-test-each-for-similar ESLint rule using RuleTester.
 */

import { RuleTester } from 'eslint';
import rule from './prefer-test-each-for-similar.mjs';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

tester.run('prefer-test-each-for-similar', rule, {
  valid: [
    // ① 2件以下 — しきい値未満
    {
      code: `it('two expects', () => {
  expect(fn('a')).toBe(true);
  expect(fn('b')).toBe(true);
});`,
    },
    // ② 異なる関数 — FN が揃っていないため各カウントは 1
    {
      code: `it('different fns', () => {
  expect(fnA('a')).toBe(true);
  expect(fnB('b')).toBe(true);
  expect(fnC('c')).toBe(true);
});`,
    },
    // ③ 既に test.each — callee が CallExpression (it.each(...)) で Identifier ではない
    {
      code: `test.each(['a', 'b', 'c'])('desc: %s', (input) => {
  expect(fn(input)).toBe(true);
});`,
    },
    // ④ expect 以外の文が混在 — VariableDeclaration で早期リターン
    {
      code: `it('mixed', () => {
  const x = 1;
  expect(fn('a')).toBe(true);
  expect(fn('b')).toBe(true);
  expect(fn('c')).toBe(true);
});`,
    },
    // ⑤ expect のみ 1 件 — statements.length < 3 で早期リターン
    {
      code: `it('one expect', () => {
  expect(fn('a')).toBe(true);
});`,
    },
    // ⑥ it.each — callee が MemberExpression で Identifier ではない
    {
      code: `it.each(['a', 'b', 'c'])('desc: %s', (input) => {
  expect(fn(input)).toBe(true);
});`,
    },
    // ⑦ expect の argument が CallExpression でない (リテラル直接) — innerCall チェックで早期リターン
    {
      code: `it('literal args', () => {
  expect(1).toBe(1);
  expect(2).toBe(2);
  expect(3).toBe(3);
});`,
    },
  ],

  invalid: [
    // ① 3件同一関数 (test) — 最小しきい値
    {
      code: `test('invalid prefix', () => {
  expect(isValid('a')).toBe(false);
  expect(isValid('b')).toBe(false);
  expect(isValid('c')).toBe(false);
});`,
      errors: [{ messageId: 'preferEach' }],
    },
    // ② 6件 (it) — しきい値を大きく超える
    {
      code: `it('many expects', () => {
  expect(check(null)).toBe(false);
  expect(check(undefined)).toBe(false);
  expect(check('')).toBe(false);
  expect(check('invalid')).toBe(false);
  expect(check(42)).toBe(false);
  expect(check({})).toBe(false);
});`,
      errors: [{ messageId: 'preferEach' }],
    },
    // ③ test キーワードでも 5 件検出
    {
      code: `test('special chars', () => {
  expect(isValidBranchName('a~b')).toBe(false);
  expect(isValidBranchName('a^b')).toBe(false);
  expect(isValidBranchName('a:b')).toBe(false);
  expect(isValidBranchName('a?b')).toBe(false);
  expect(isValidBranchName('a*b')).toBe(false);
});`,
      errors: [{ messageId: 'preferEach' }],
    },
  ],
});

console.log('prefer-test-each-for-similar: all tests passed');
