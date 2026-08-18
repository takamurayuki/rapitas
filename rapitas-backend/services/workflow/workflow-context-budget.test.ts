/**
 * Tests for workflow-context-budget.
 *
 * Covers mode resolution (default `log`), clamp boundaries, mode passthrough,
 * and the structural guarantee that quality-gate material keys are never
 * clamped (absent from SECTION_BUDGETS).
 */
import { describe, expect, test } from 'bun:test';

import {
  resolveBudgetMode,
  clampSection,
  budgetSection,
  SECTION_BUDGETS,
} from './workflow-context-budget';

describe('resolveBudgetMode', () => {
  test.each([
    { env: undefined, expected: 'log' },
    { env: '', expected: 'log' },
    { env: 'bogus', expected: 'log' },
    { env: 'log', expected: 'log' },
    { env: 'off', expected: 'off' },
    { env: 'enforce', expected: 'enforce' },
  ])('env=$env resolves to $expected', ({ env, expected }) => {
    expect(resolveBudgetMode(env)).toBe(expected);
  });
});

describe('clampSection', () => {
  test('text at exactly maxChars is unchanged (no marker)', () => {
    const text = 'a'.repeat(100);
    const result = clampSection(text, 100);
    expect(result.text).toBe(text);
    expect(result.clamped).toBe(false);
    expect(result.originalChars).toBe(100);
    expect(result.keptChars).toBe(100);
  });

  test('text under maxChars is unchanged', () => {
    const result = clampSection('short', 100);
    expect(result.text).toBe('short');
    expect(result.clamped).toBe(false);
  });

  test('text over maxChars keeps the head and appends the truncation marker', () => {
    const text = 'a'.repeat(150);
    const result = clampSection(text, 100);
    expect(result.clamped).toBe(true);
    expect(result.originalChars).toBe(150);
    expect(result.keptChars).toBe(100);
    expect(result.text.startsWith('a'.repeat(100))).toBe(true);
    expect(result.text).toEndWith('…[truncated: 50 chars]');
  });

  test('empty string is unchanged', () => {
    const result = clampSection('', 100);
    expect(result.text).toBe('');
    expect(result.clamped).toBe(false);
    expect(result.originalChars).toBe(0);
  });

  test('custom marker replaces the default one', () => {
    const result = clampSection('a'.repeat(10), 5, '<CUT>');
    expect(result.text).toBe('aaaaa<CUT>');
  });
});

describe('budgetSection', () => {
  const longText = 'x'.repeat(20000);

  test('off mode is full passthrough even for budgeted keys', () => {
    expect(budgetSection('off', 'implementer.research', longText)).toBe(longText);
  });

  test('log mode (default) is full passthrough even for budgeted keys', () => {
    expect(budgetSection('log', 'implementer.research', longText)).toBe(longText);
  });

  test.each([
    { key: 'implementer.research', cap: 12000 },
    { key: 'implementer.verifyFeedback', cap: 8000 },
  ])('enforce clamps $key at $cap chars', ({ key, cap }) => {
    const out = budgetSection('enforce', key, longText);
    expect(out.length).toBeLessThan(longText.length);
    expect(out.startsWith('x'.repeat(cap))).toBe(true);
    expect(out).toContain(`…[truncated: ${longText.length - cap} chars]`);
  });

  test('enforce leaves text under the cap unchanged', () => {
    expect(budgetSection('enforce', 'implementer.research', 'short')).toBe('short');
  });

  test.each(['verifier.plan', 'verifier.diff', 'verifier.groundTruth', 'planner.research'])(
    'gate-material key %s passes through unchanged even in enforce mode',
    (key) => {
      expect(budgetSection('enforce', key, longText)).toBe(longText);
    },
  );

  test('SECTION_BUDGETS contains ONLY the two non-gate implementer keys', () => {
    // The structural guarantee of the plan: gate materials are exempt because
    // their keys are never listed. Lock the key set so additions are deliberate.
    expect(Object.keys(SECTION_BUDGETS).sort()).toEqual([
      'implementer.research',
      'implementer.verifyFeedback',
    ]);
  });
});
