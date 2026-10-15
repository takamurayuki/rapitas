import { describe, test, expect } from 'bun:test';
import { assessComplexity } from './complexity-assessor';

describe('assessComplexity', () => {
  test('starts at medium (score 50) for a neutral task with no modifiers', () => {
    // description length must be in [100, 1000] and contextLength <= 5000 to
    // avoid any length-based modifier; role must not be implementer/planner
    // (auto_verifier is the neutral, local-LLM-ineligible role used here).
    const result = assessComplexity(
      { title: 'Do a normal task', description: 'y'.repeat(150) },
      'auto_verifier',
    );
    expect(result.score).toBe(50);
    expect(result.level).toBe('medium');
    expect(result.reasons).toEqual([]);
  });

  test('raises score and adds a reason for high-complexity keywords', () => {
    const result = assessComplexity(
      { title: 'Add authentication and security migration', description: null },
      'auto_verifier',
    );
    expect(result.score).toBeGreaterThan(50);
    expect(result.reasons.some((r) => r.includes('High-complexity keywords'))).toBe(true);
  });

  test('lowers score and adds a reason for low-complexity keywords', () => {
    const result = assessComplexity(
      {
        title: 'Fix a typo and rename a variable',
        description: 'x'.repeat(200), // avoid also triggering the short-description modifier
      },
      'auto_verifier',
    );
    expect(result.score).toBeLessThan(50);
    expect(result.reasons.some((r) => r.includes('Low-complexity keywords'))).toBe(true);
  });

  test('matches Japanese high-complexity keywords too', () => {
    const result = assessComplexity(
      { title: 'セキュリティ認証の実装', description: null },
      'auto_verifier',
    );
    expect(result.reasons.some((r) => r.includes('High-complexity keywords'))).toBe(true);
  });

  test('adds a reason for a long description (>1000 chars)', () => {
    const result = assessComplexity(
      { title: 'Task', description: 'x'.repeat(1001) },
      'auto_verifier',
    );
    expect(result.reasons.some((r) => r.includes('Long description'))).toBe(true);
  });

  test('adds a reason for a short description (<100 chars)', () => {
    const result = assessComplexity({ title: 'Task', description: 'short' }, 'auto_verifier');
    expect(result.reasons.some((r) => r.includes('Short description'))).toBe(true);
  });

  test('adds a reason for large context (>5000 chars)', () => {
    const result = assessComplexity(
      { title: 'Task', description: 'x'.repeat(200) },
      'auto_verifier',
      5001,
    );
    expect(result.reasons.some((r) => r.includes('Large context'))).toBe(true);
  });

  test('implementer role always adds +30 and a reason', () => {
    const result = assessComplexity({ title: 'Task', description: 'x'.repeat(200) }, 'implementer');
    expect(result.reasons.some((r) => r.includes('requires strong reasoning'))).toBe(true);
  });

  test('planner role always adds +30 and a reason', () => {
    const result = assessComplexity({ title: 'Task', description: 'x'.repeat(200) }, 'planner');
    expect(result.reasons.some((r) => r.includes('requires strong reasoning'))).toBe(true);
  });

  test('clamps score to 100 when many high-complexity signals stack', () => {
    const result = assessComplexity(
      {
        title:
          'migration database schema security authentication authorization performance optimization architecture',
        description: 'x'.repeat(1001),
      },
      'implementer',
      6000,
    );
    expect(result.score).toBe(100);
    expect(result.level).toBe('high');
  });

  test('clamps score to 0 when many low-complexity signals stack', () => {
    const result = assessComplexity(
      { title: 'typo rename comment documentation style format label color', description: '' },
      'auto_verifier',
    );
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
  });

  test('canUseLocalLLM is true for low complexity + an eligible role (researcher)', () => {
    const result = assessComplexity(
      { title: 'typo rename comment documentation', description: '' },
      'researcher',
    );
    expect(result.level).toBe('low');
    expect(result.canUseLocalLLM).toBe(true);
  });

  test('canUseLocalLLM is true for low complexity + verifier', () => {
    const result = assessComplexity(
      { title: 'typo rename comment documentation', description: '' },
      'verifier',
    );
    expect(result.canUseLocalLLM).toBe(true);
  });

  test('canUseLocalLLM is false for low complexity but an ineligible role', () => {
    const result = assessComplexity(
      { title: 'typo rename comment documentation', description: '' },
      'auto_verifier',
    );
    expect(result.level).toBe('low');
    expect(result.canUseLocalLLM).toBe(false);
  });

  test('canUseLocalLLM is false when level is not low, even for an eligible role', () => {
    const result = assessComplexity(
      { title: 'A perfectly ordinary task title for testing', description: null },
      'researcher',
    );
    expect(result.level).not.toBe('low');
    expect(result.canUseLocalLLM).toBe(false);
  });

  test('defaults contextLength to 0 when omitted', () => {
    const result = assessComplexity(
      { title: 'Task', description: 'x'.repeat(200) },
      'auto_verifier',
    );
    expect(result.reasons.some((r) => r.includes('Large context'))).toBe(false);
  });

  test('treats a null description as an empty string for text matching', () => {
    const result = assessComplexity({ title: 'security', description: null }, 'auto_verifier');
    expect(result.reasons.some((r) => r.includes('High-complexity keywords'))).toBe(true);
  });
});
