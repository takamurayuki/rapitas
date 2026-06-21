/**
 * no-raw-prisma-insensitive.test.mjs
 *
 * Unit tests for the no-raw-prisma-insensitive ESLint rule using RuleTester.
 */

import { RuleTester } from 'eslint';
import rule from './no-raw-prisma-insensitive.mjs';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

tester.run('no-raw-prisma-insensitive', rule, {
  valid: [
    // ① getInsensitiveMode() spread — correct usage
    {
      code: `const where = { contains: search, ...getInsensitiveMode() };`,
    },
    // ② mode with a value other than 'insensitive' — not a Prisma insensitive filter
    {
      code: `const filter = { mode: 'default' };`,
    },
    // ③ mode with a variable reference — dynamic value, cannot statically detect
    {
      code: `const filter = { mode: someVar };`,
    },
    // ④ property named something other than mode
    {
      code: `const opts = { strategy: 'insensitive' };`,
    },
    // ⑤ 'sensitive' is fine
    {
      code: `const filter = { mode: 'sensitive' };`,
    },
    // ⑥ computed property key that happens to equal 'mode' at runtime — not statically detectable
    {
      code: `const key = 'mode'; const filter = { [key]: 'insensitive' };`,
    },
  ],

  invalid: [
    // ① Plain object literal with raw mode: 'insensitive'
    {
      code: `const where = { contains: search, mode: 'insensitive' };`,
      errors: [{ messageId: 'rawInsensitive' }],
    },
    // ② Ternary building the object with mode inline
    {
      code: `const filter = isPostgres ? { mode: 'insensitive' } : {};`,
      errors: [{ messageId: 'rawInsensitive' }],
    },
    // ③ Inside a local helper function — still a violation
    {
      code: `function makeFilter(val) { return { equals: val, mode: 'insensitive' }; }`,
      errors: [{ messageId: 'rawInsensitive' }],
    },
    // ④ String-keyed property ('mode' as Literal key)
    {
      code: `const filter = { 'mode': 'insensitive' };`,
      errors: [{ messageId: 'rawInsensitive' }],
    },
    // ⑤ Arrow function returning inline insensitive object
    {
      code: `const makeFilter = (v) => ({ equals: v, mode: 'insensitive' });`,
      errors: [{ messageId: 'rawInsensitive' }],
    },
  ],
});

console.log('no-raw-prisma-insensitive: all tests passed');
