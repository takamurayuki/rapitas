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
    // ① it.each / test.each already used — already consolidated, not flagged
    {
      code: `
        describe('isWorkflowStatus', () => {
          it.each(['draft', 'done', 'failed'])('returns true for %s', (s) => {})
        })
      `,
    },
    // ② Only 2 it calls with same prefix — below default minCount=3
    {
      code: `
        describe('myFn', () => {
          it('returns false for null', () => {})
          it('returns false for undefined', () => {})
        })
      `,
    },
    // ③ Common prefix is shorter than default minPrefixLength=8 chars ("val: " = 5 chars)
    {
      code: `
        describe('myFn', () => {
          it('val: 1', () => {})
          it('val: 2', () => {})
          it('val: 3', () => {})
        })
      `,
    },
    // ④ Similar prefix split across different describe blocks — analyzed independently
    //    Group A has 2, Group B has 1 → neither meets minCount=3
    {
      code: `
        describe('group A', () => {
          it('returns false for null', () => {})
          it('returns false for undefined', () => {})
        })
        describe('group B', () => {
          it('returns false for empty', () => {})
        })
      `,
    },
    // ⑤ it.skip / it.todo — MemberExpression callee, excluded from collection
    {
      code: `
        describe('myFn', () => {
          it.skip('returns false for null', () => {})
          it.skip('returns false for undefined', () => {})
          it.skip('returns false for empty string', () => {})
        })
      `,
    },
    // ⑥ No meaningful common prefix — all descriptions differ from the start
    {
      code: `
        describe('myFn', () => {
          it('accepts valid input', () => {})
          it('rejects null input', () => {})
          it('handles edge case', () => {})
        })
      `,
    },
  ],

  invalid: [
    // ① "returns false for X" × 3 — reports only the first node with count=3
    {
      code: `
        describe('isWorkflowStatus', () => {
          it('returns false for null', () => {})
          it('returns false for undefined', () => {})
          it('returns false for empty string', () => {})
        })
      `,
      errors: [
        {
          messageId: 'preferTestEach',
          data: { count: '3', prefix: 'returns false for ' },
        },
      ],
    },
    // ② Two independent groups in the same describe — each reported separately (no merging)
    {
      code: `
        describe('classifyGitHubError', () => {
          it('rate_limit: first case', () => {})
          it('rate_limit: second case', () => {})
          it('rate_limit: third case', () => {})
          it('transient: first case', () => {})
          it('transient: second case', () => {})
          it('transient: third case', () => {})
        })
      `,
      errors: [
        {
          messageId: 'preferTestEach',
          data: { count: '3', prefix: 'rate_limit: ' },
        },
        {
          messageId: 'preferTestEach',
          data: { count: '3', prefix: 'transient: ' },
        },
      ],
    },
    // ③ Nested describe — inner tests detected; outer frame has only 1 it (no report)
    {
      code: `
        describe('outer', () => {
          it('unrelated test one', () => {})
          describe('inner', () => {
            it('returns true for valid input', () => {})
            it('returns true for ok input', () => {})
            it('returns true for fine input', () => {})
          })
        })
      `,
      errors: [
        {
          messageId: 'preferTestEach',
          data: { count: '3', prefix: 'returns true for ' },
        },
      ],
    },
    // boundary ① — minCount:2 triggers on pairs
    {
      code: `
        describe('myFn', () => {
          it('returns false for null', () => {})
          it('returns false for undefined', () => {})
        })
      `,
      options: [{ minCount: 2 }],
      errors: [
        {
          messageId: 'preferTestEach',
          data: { count: '2', prefix: 'returns false for ' },
        },
      ],
    },
    // boundary ② — minPrefixLength:5 triggers on short prefix ("val: " = 5 chars)
    {
      code: `
        describe('myFn', () => {
          it('val: 1', () => {})
          it('val: 2', () => {})
          it('val: 3', () => {})
        })
      `,
      options: [{ minPrefixLength: 5 }],
      errors: [
        {
          messageId: 'preferTestEach',
          data: { count: '3', prefix: 'val: ' },
        },
      ],
    },
  ],
});

console.log('prefer-test-each-for-similar: all tests passed');
