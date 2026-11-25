/**
 * follow-up-findings.test
 *
 * Task 1547: a fail that rests only on impact=follow_up findings passes and the
 * findings become concerns; a blocking finding, a blocker, or a finding whose
 * impact the seats disagree on keeps stopping completion. The last describe
 * block is the "can this gate fail" check of docs/lessons/gates-that-do-not-measure.md.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DiffReviewResult } from './adversarial-diff-review-verdict';
import { formatFindingReason, parseFindings, type ReviewFinding } from './review-findings';
import { compareReviewers, composeTwoSeatResult, type SeatedJuror } from './two-seat-review';

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

const { splitFollowUp, fileFollowUpFindings } = await import('./follow-up-findings');

const finding = (over: Partial<ReviewFinding>): ReviewFinding => ({
  severity: 'major',
  summary: '否定の取りこぼし',
  criterion: '受入基準1',
  evidence: 'a.ts:1',
  gating: true,
  ...over,
});
const failWith = (findings: ReviewFinding[]): DiffReviewResult => ({
  verdict: 'fail',
  severity: 70,
  reasons: [...new Set(findings.filter((f) => f.gating).map(formatFindingReason))],
  judged: true,
  findings,
});
const followUp = finding({ impact: 'follow_up', kind: 'input_coverage', examples: ['過去形'] });

function seat(id: 'reviewer-1' | 'reviewer-2', findings: ReviewFinding[]): SeatedJuror {
  const fail = findings.some((f) => f.gating);
  return {
    seatId: id,
    role: 'reviewer',
    tier: 'standard',
    provider: 'claude',
    model: id === 'reviewer-1' ? 'claude-opus' : 'claude-sonnet',
    verdict: fail ? 'fail' : 'pass',
    severity: fail ? 70 : 0,
    reasons: [],
    findings,
  };
}

beforeEach(() => {
  submitted.length = 0;
});

describe('splitFollowUp — passes when only follow_up findings decide', () => {
  test('a fail with only follow_up findings becomes pass and the finding is no longer gating', () => {
    const { result, followUp: moved } = splitFollowUp(failWith([followUp]));
    expect(result.verdict).toBe('pass');
    expect(result.severity).toBe(0);
    expect(result.reasons).toEqual([]);
    expect(result.findings![0]).toMatchObject({ gating: false, deferred: 'follow_up' });
    expect(moved).toHaveLength(1);
    expect(result.followUp).toEqual({
      count: 1,
      reasons: [formatFindingReason(followUp)],
      verdictChanged: true,
    });
  });

  test('a pass, a hold and an unknown are left alone', () => {
    for (const verdict of ['pass', 'hold', 'unknown'] as const) {
      const r = { ...failWith([followUp]), verdict };
      expect(splitFollowUp(r).result).toBe(r);
    }
  });

  test('a fail with reasons but no findings is left alone', () => {
    const r: DiffReviewResult = { ...failWith([]), reasons: ['[major] x（根拠: a:1）'] };
    expect(splitFollowUp(r).result.verdict).toBe('fail');
  });
});

describe('splitFollowUp — blocking findings still stop completion', () => {
  test('one blocking finding keeps the fail; its reason stays, the follow_up one leaves', () => {
    const blocking = finding({ summary: 'データを消す', criterion: '受入基準2' });
    const { result, followUp: moved } = splitFollowUp(failWith([followUp, blocking]));
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual([formatFindingReason(blocking)]);
    expect(result.findings!.find((f) => f.summary === 'データを消す')!.gating).toBe(true);
    expect(moved).toHaveLength(1);
    expect(result.followUp?.verdictChanged).toBe(false);
  });

  test('a missing impact is blocking', () => {
    const { result } = splitFollowUp(failWith([finding({})]));
    expect(result.verdict).toBe('fail');
    expect(result.findings![0].gating).toBe(true);
  });

  test('a blocker marked follow_up is blocking', () => {
    const { result } = splitFollowUp(
      failWith([finding({ severity: 'blocker', impact: 'follow_up' })]),
    );
    expect(result.verdict).toBe('fail');
  });

  test('a follow_up finding that shares its reason with a blocking one keeps that reason', () => {
    const blocking = { ...followUp, impact: 'blocking' as const, seatId: 'reviewer-2' };
    const { result } = splitFollowUp(failWith([{ ...followUp, seatId: 'reviewer-1' }, blocking]));
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual([formatFindingReason(blocking)]);
  });

  test('seats split on impact (A follow_up, B blocking) → agreed fail that stays fail', () => {
    const a = seat('reviewer-1', [{ ...followUp }]);
    const b = seat('reviewer-2', [{ ...followUp, impact: 'blocking' }]);
    const review = composeTwoSeatResult({
      reviewers: [a, b],
      comparison: compareReviewers([a, b]),
    });
    expect(review.verdict).toBe('fail');
    const { result } = splitFollowUp(review);
    expect(result.verdict).toBe('fail');
    expect(result.findings!.find((f) => f.seatId === 'reviewer-2')!.gating).toBe(true);
  });

  test('a refuted blocking finding does not count, an upheld follow_up one passes', () => {
    const refuted = finding({ summary: '誤報', verification: 'refuted' });
    const upheld = { ...followUp, verification: 'holds' as const };
    const { result } = splitFollowUp({ ...failWith([upheld]), findings: [refuted, upheld] });
    expect(result.verdict).toBe('pass');
  });

  test('an undetermined follow_up finding is never relaxed', () => {
    const r = {
      ...failWith([followUp]),
      findings: [{ ...followUp, verification: 'undetermined' as const }],
    };
    expect(splitFollowUp(r).result.verdict).toBe('fail');
  });
});

describe('fileFollowUpFindings', () => {
  test('files each follow_up finding as a concern with the examples in the detail', async () => {
    await fileFollowUpFindings([followUp], { taskId: 1547, themeId: 18 }, []);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      themeId: 18,
      originTaskId: 1547,
      source: 'adversarial_review_follow_up',
      severity: 'medium',
      type: 'bug',
    });
    expect(String(submitted[0].dedupKey)).toMatch(/^follow-up:1547:受入基準1:[0-9a-f]{12}$/);
    expect(String(submitted[0].detail)).toContain('過去形');
  });

  test('the same finding twice gets the same dedupKey', async () => {
    await fileFollowUpFindings([followUp], { taskId: 1547, themeId: null }, []);
    await fileFollowUpFindings(
      [{ ...followUp, seatId: 'reviewer-2' }],
      { taskId: 1547, themeId: null },
      [],
    );
    expect(submitted[0].dedupKey).toBe(submitted[1].dedupKey);
    expect(submitted[0].themeId).toBeUndefined();
  });

  test('skips a finding with the same criterion and kind as a remaining blocking one', async () => {
    const blocking = finding({ kind: 'input_coverage', summary: '別の書き方' });
    await fileFollowUpFindings([followUp], { taskId: 1547, themeId: 18 }, [blocking]);
    expect(submitted).toHaveLength(0);
  });

  test('nothing to file → no call', async () => {
    await fileFollowUpFindings([], { taskId: 1547, themeId: 18 }, []);
    expect(submitted).toHaveLength(0);
  });
});

describe('gate can fail: findings parsed from a reply, end to end through splitFollowUp', () => {
  const reply = (over: Record<string, unknown>) =>
    parseFindings([{ severity: 'major', summary: 's', criterion: '1', evidence: 'a:1', ...over }])!;

  test('impact 欠落は blocking', () => {
    expect(splitFollowUp(failWith(reply({}))).result.verdict).toBe('fail');
  });

  test('blocker+follow_up は blocking', () => {
    expect(
      splitFollowUp(failWith(reply({ severity: 'blocker', impact: 'follow_up' }))).result.verdict,
    ).toBe('fail');
  });

  test('片席 blocking なら fail', () => {
    const [fu] = reply({ impact: 'follow_up' });
    const [bl] = reply({});
    const a = seat('reviewer-1', [fu]);
    const b = seat('reviewer-2', [bl]);
    const review = composeTwoSeatResult({
      reviewers: [a, b],
      comparison: compareReviewers([a, b]),
    });
    expect(splitFollowUp(review).result.verdict).toBe('fail');
  });
});
