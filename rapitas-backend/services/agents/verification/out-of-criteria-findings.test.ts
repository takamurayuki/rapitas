/**
 * out-of-criteria-findings.test
 *
 * 2026-11-21: trendline task 1519 was bounced three times by evidenced major
 * findings about running several dev-all instances at once, a case none of
 * its acceptance criteria covered, and blocked as non-converging. Each finding
 * was real; none was what the task was asked to do.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DiffReviewResult } from './adversarial-diff-review-verdict';
import type { ReviewFinding } from './review-findings';
import { formatFindingReason } from './review-findings';

const submitted: Array<Record<string, unknown>> = [];
mock.module('../../memory/concern-backlog-service', () => ({
  submitConcern: async (input: Record<string, unknown>) => {
    submitted.push(input);
    return { id: submitted.length, outcome: 'created' };
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { splitOutOfCriteria, fileOutOfCriteriaFindings } =
  await import('./out-of-criteria-findings');

const finding = (over: Partial<ReviewFinding>): ReviewFinding => ({
  severity: 'major',
  summary: 'something is wrong',
  evidence: 'scripts/dev-all.mjs:40',
  gating: true,
  ...over,
});

const failWith = (findings: ReviewFinding[]): DiffReviewResult => ({
  verdict: 'fail',
  severity: 70,
  reasons: findings.filter((f) => f.gating).map(formatFindingReason),
  judged: true,
  findings,
});

beforeEach(() => {
  submitted.length = 0;
});

describe('splitOutOfCriteria', () => {
  const race = finding({ summary: '複数の dev-all を起動すると PID ファイルを消す' });

  test('a major finding outside every criterion no longer fails the review', () => {
    const { result, outOfCriteria } = splitOutOfCriteria(failWith([race]), 5);
    expect(result.verdict).toBe('pass');
    expect(result.reasons).toEqual([]);
    expect(outOfCriteria).toEqual([race]);
  });

  test('a finding on a named criterion still fails it', () => {
    const inScope = finding({ criterion: '受入基準2', summary: 'taskkill に別の PID が渡る' });
    const { result, outOfCriteria } = splitOutOfCriteria(failWith([inScope, race]), 5);
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual([formatFindingReason(inScope)]);
    expect(outOfCriteria).toEqual([race]);
  });

  test('a criterion given as the summary prefix counts as named', () => {
    const prefixed = finding({ summary: '受入基準2: taskkill に別の PID が渡る' });
    expect(splitOutOfCriteria(failWith([prefixed]), 5).result.verdict).toBe('fail');
  });

  test('a criterion number past the list counts as outside it', () => {
    const past = finding({ criterion: '受入基準9' });
    expect(splitOutOfCriteria(failWith([past]), 5).result.verdict).toBe('pass');
  });

  test('a blocker outside the criteria still fails, so data loss is never deferred', () => {
    const blocker = finding({ severity: 'blocker', summary: 'deletes the database' });
    const { result, outOfCriteria } = splitOutOfCriteria(failWith([blocker]), 5);
    expect(result.verdict).toBe('fail');
    expect(outOfCriteria).toEqual([]);
  });

  test('a task without criteria keeps the old verdict', () => {
    const { result, outOfCriteria } = splitOutOfCriteria(failWith([race]), 0);
    expect(result.verdict).toBe('fail');
    expect(outOfCriteria).toEqual([]);
  });

  test('a pass or hold is left alone', () => {
    const pass: DiffReviewResult = { verdict: 'pass', severity: 0, reasons: [], judged: true };
    expect(splitOutOfCriteria(pass, 5).result).toBe(pass);
    const hold = { ...failWith([race]), verdict: 'hold' as const };
    expect(splitOutOfCriteria(hold, 5).result).toBe(hold);
  });
});

describe('fileOutOfCriteriaFindings', () => {
  test('files each finding as a concern on the task theme', async () => {
    const f = finding({ summary: '複数の dev-all を起動すると PID ファイルを消す' });
    await fileOutOfCriteriaFindings([f], { taskId: 1519, themeId: 18 });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      themeId: 18,
      originTaskId: 1519,
      severity: 'high',
      source: 'adversarial_review_out_of_criteria',
      location: 'scripts/dev-all.mjs:40',
    });
    expect(String(submitted[0].title)).toContain('複数の dev-all');
    expect(String(submitted[0].detail)).toContain('#1519');
  });

  test('files nothing when there is nothing out of scope', async () => {
    await fileOutOfCriteriaFindings([], { taskId: 1, themeId: 1 });
    expect(submitted).toHaveLength(0);
  });
});
