/**
 * decision-ledger/settle-knowledge.test
 *
 * Covers the recall verdict. Two rules carry the weight: an empty recall is a
 * measurable failure rather than something unjudgeable (86% of recalls returned
 * nothing, measured 2026-08-25), and a task merely succeeding never counts as
 * evidence the recall helped.
 */
import { describe, test, expect } from 'bun:test';
import { judgeRecall } from './settle-knowledge';

const DECLARED = (used: number[]) => ({ declared: true, used });

describe('judgeRecall', () => {
  test('a recall that found nothing is a failure, not an unknown', () => {
    const v = judgeRecall(0, [], DECLARED([]));
    expect(v.consistency).toBe('inconsistent');
    expect(v.note).toContain('空振り');
  });

  test('an empty recall is judged even with no declaration to read', () => {
    expect(judgeRecall(0, [], null).consistency).toBe('inconsistent');
  });

  test('a declared use of an injected entry is the only thing counted correct', () => {
    expect(judgeRecall(3, [7, 8, 9], DECLARED([8])).consistency).toBe('consistent');
  });

  test('injecting knowledge nobody used is a failed recall', () => {
    expect(judgeRecall(3, [7, 8, 9], DECLARED([])).consistency).toBe('inconsistent');
  });

  test('a use of some OTHER task entry does not credit this recall', () => {
    expect(judgeRecall(3, [7, 8, 9], DECLARED([42])).consistency).toBe('inconsistent');
  });

  test('without a declaration the recall stays unjudged rather than assumed good', () => {
    // The task may well have succeeded. Success while knowledge sat in context
    // is a correlation, and counting it would manufacture evidence for the very
    // thing being tested.
    const v = judgeRecall(3, [7, 8, 9], null);
    expect(v.consistency).toBe('skipped');
    expect(v.note).toContain('判定できない');
  });
});
