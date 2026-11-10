/**
 * two-seat-review テスト
 *
 * The jury form decided by the owner (2026-11-10): two blind reviewers; when
 * they agree that settles it; only a disagreement brings in the verifier seat,
 * which checks the disputed findings' grounds instead of voting; an
 * undecidable serious dispute goes to a human.
 */
import { describe, test, expect } from 'bun:test';
import {
  compareReviewers,
  settleDispute,
  composeTwoSeatResult,
  type SeatedJuror,
} from './two-seat-review';
import type { ReviewFinding } from './review-findings';

const blocker = (summary: string): ReviewFinding => ({
  severity: 'blocker',
  summary,
  evidence: 'src/a.ts:10',
  repro: 'call a() with null',
  gating: true,
});
const minor = (summary: string): ReviewFinding => ({ severity: 'minor', summary, gating: false });

function seat(
  seatId: 'reviewer-1' | 'reviewer-2',
  verdict: 'pass' | 'fail' | 'unknown',
  findings: ReviewFinding[] = [],
  model = seatId === 'reviewer-1' ? 'claude-opus' : 'claude-sonnet',
): SeatedJuror {
  return {
    seatId,
    role: 'reviewer',
    tier: seatId === 'reviewer-1' ? 'premium' : 'standard',
    provider: 'claude',
    model,
    verdict,
    severity: verdict === 'fail' ? 90 : 0,
    reasons: [],
    findings,
    ...(verdict === 'unknown' ? { unknownReason: 'timeout' as const } : {}),
  };
}

describe('compareReviewers', () => {
  test('両方合格 → 一致で合格、指摘は統合して席つきで記録', () => {
    const c = compareReviewers([
      seat('reviewer-1', 'pass', [minor('命名')]),
      seat('reviewer-2', 'pass', [minor('コメント')]),
    ]);
    expect(c.kind).toBe('agreed');
    if (c.kind !== 'agreed') return;
    expect(c.verdict).toBe('pass');
    expect(c.findings.map((f) => [f.seatId, f.summary])).toEqual([
      ['reviewer-1', '命名'],
      ['reviewer-2', 'コメント'],
    ]);
  });

  test('両方不合格 → 一致で不合格（検証席は呼ばない）', () => {
    const c = compareReviewers([
      seat('reviewer-1', 'fail', [blocker('null 未処理')]),
      seat('reviewer-2', 'fail', [blocker('境界値')]),
    ]);
    expect(c.kind).toBe('agreed');
    if (c.kind === 'agreed') expect(c.verdict).toBe('fail');
  });

  test('食い違い → 検証席へ。争点は不合格側の判定を決めた指摘だけ', () => {
    const c = compareReviewers([
      seat('reviewer-1', 'fail', [blocker('null 未処理'), minor('命名')]),
      seat('reviewer-2', 'pass', [minor('コメント')]),
    ]);
    expect(c.kind).toBe('needs_verification');
    if (c.kind !== 'needs_verification') return;
    expect(c.basis).toBe('split');
    expect(c.disputed.map((f) => f.summary)).toEqual(['null 未処理']);
    expect(c.disputed[0].seatId).toBe('reviewer-1');
  });

  test('両席とも判定なし → 不成立', () => {
    expect(
      compareReviewers([seat('reviewer-1', 'unknown'), seat('reviewer-2', 'unknown')]).kind,
    ).toBe('unavailable');
  });

  test('片方だけ判定 → 独立した2人目がいない。合格ならそのまま、不合格なら検証席', () => {
    const p = compareReviewers([seat('reviewer-1', 'pass'), seat('reviewer-2', 'unknown')]);
    expect(p.kind).toBe('pass_single');
    if (p.kind === 'pass_single') expect(p.basis).toBe('single_reviewer');

    const f = compareReviewers([
      seat('reviewer-1', 'unknown'),
      seat('reviewer-2', 'fail', [blocker('x')]),
    ]);
    expect(f.kind).toBe('needs_verification');
    if (f.kind === 'needs_verification') expect(f.basis).toBe('single_reviewer');
  });

  test('同じモデルが2席に座ると独立した票として数えない（両方不合格でも一致にしない）', () => {
    const c = compareReviewers([
      seat('reviewer-1', 'fail', [blocker('a')], 'claude-sonnet'),
      seat('reviewer-2', 'fail', [blocker('b')], 'claude-sonnet'),
    ]);
    expect(c.kind).toBe('needs_verification');
    if (c.kind === 'needs_verification') {
      expect(c.basis).toBe('same_model');
      expect(c.disputed.map((f) => f.summary)).toEqual(['a', 'b']);
    }
  });
});

// G2 abc review item 3: independence is judged on the model the call actually
// ran on, not on the id that was requested.
describe('compareReviewers — 独立性は解決後のモデルで比べる', () => {
  test('opus と claude-opus-4-6（CLI ではどちらも --model opus）は同じモデル', () => {
    const c = compareReviewers([
      { ...seat('reviewer-1', 'fail', [blocker('a')], 'opus'), resolvedModel: 'opus' },
      { ...seat('reviewer-2', 'fail', [blocker('b')], 'claude-opus-4-6'), resolvedModel: 'opus' },
    ]);
    expect(c.kind).toBe('needs_verification');
    if (c.kind === 'needs_verification') expect(c.basis).toBe('same_model');
  });

  test('両席が実際の modelName を返したらそれで比べる（要求名が違っても同一なら独立でない）', () => {
    const withName = (j: SeatedJuror, modelName: string): SeatedJuror => ({
      ...j,
      usage: { tokensUsed: 0, modelName, startedAt: new Date(), durationMs: 1 },
    });
    const c = compareReviewers([
      withName(seat('reviewer-1', 'fail', [blocker('a')], 'claude-opus'), 'claude-opus-4-6'),
      withName(seat('reviewer-2', 'fail', [blocker('b')], 'claude-sonnet'), 'Claude-Opus-4-6'),
    ]);
    expect(c.kind).toBe('needs_verification');
  });

  test('解決後のモデルが違えば独立（両方不合格で一致）', () => {
    const c = compareReviewers([
      { ...seat('reviewer-1', 'fail', [blocker('a')]), resolvedModel: 'opus' },
      { ...seat('reviewer-2', 'fail', [blocker('b')]), resolvedModel: 'sonnet' },
    ]);
    expect(c).toMatchObject({ kind: 'agreed', verdict: 'fail' });
  });
});

describe('settleDispute', () => {
  const disputed = [
    { ...blocker('A'), seatId: 'reviewer-1' },
    { ...blocker('B'), seatId: 'reviewer-1' },
  ];

  test('根拠が成り立つ指摘が残れば不合格', () => {
    const s = settleDispute(disputed, [
      { index: 1, status: 'holds', note: 'a.ts:10 で null が通る' },
      { index: 2, status: 'refuted' },
    ]);
    expect(s.verdict).toBe('fail');
    expect(s.upheld.map((f) => f.summary)).toEqual(['A']);
    expect(s.upheld[0].verification).toBe('holds');
    expect(s.upheld[0].verificationNote).toBe('a.ts:10 で null が通る');
  });

  test('すべて成り立たない → 合格。落とした指摘も記録に残る', () => {
    const s = settleDispute(disputed, [
      { index: 1, status: 'refuted' },
      { index: 2, status: 'refuted' },
    ]);
    expect(s.verdict).toBe('pass');
    expect(s.checked.map((f) => f.verification)).toEqual(['refuted', 'refuted']);
  });

  test('判定できない重要な争点が残れば人間へ（保留）', () => {
    const s = settleDispute(disputed, [
      { index: 1, status: 'refuted' },
      { index: 2, status: 'undetermined' },
    ]);
    expect(s.verdict).toBe('hold');
    expect(s.undetermined.map((f) => f.summary)).toEqual(['B']);
  });

  test('検証席が答えない・答え漏れ → 判定できない扱いで人間へ', () => {
    expect(settleDispute(disputed, null).verdict).toBe('hold');
    expect(settleDispute(disputed, [{ index: 1, status: 'refuted' }]).verdict).toBe('hold');
  });
});

describe('composeTwoSeatResult', () => {
  test('一致の不合格は指摘を差し戻し理由にし、席の記録を残す', () => {
    const r1 = seat('reviewer-1', 'fail', [blocker('null 未処理')]);
    const r2 = seat('reviewer-2', 'fail', [blocker('境界値')]);
    const res = composeTwoSeatResult({
      reviewers: [r1, r2],
      comparison: compareReviewers([r1, r2]),
    });
    expect(res.verdict).toBe('fail');
    expect(res.form).toBe('two_seat');
    expect(res.reasons.length).toBe(2);
    expect(res.seats?.map((s) => [s.seatId, s.role, s.verdict])).toEqual([
      ['reviewer-1', 'reviewer', 'fail'],
      ['reviewer-2', 'reviewer', 'fail'],
    ]);
    expect(res.awaitingHuman).toBeUndefined();
  });

  test('検証で判定できない争点 → verdict hold と人間待ちの理由', () => {
    const r1 = seat('reviewer-1', 'fail', [blocker('null 未処理')]);
    const r2 = seat('reviewer-2', 'pass');
    const comparison = compareReviewers([r1, r2]);
    const verifier: SeatedJuror = {
      seatId: 'verifier',
      role: 'verifier',
      tier: 'premium',
      provider: 'claude',
      model: 'claude-opus',
      verdict: 'unknown',
      severity: 0,
      reasons: [],
    };
    const res = composeTwoSeatResult({
      reviewers: [r1, r2],
      comparison,
      verification: { seat: verifier, checks: [{ index: 1, status: 'undetermined' }] },
    });
    expect(res.verdict).toBe('hold');
    expect(res.awaitingHuman?.reason).toBe('unresolved_dispute');
    expect(res.seats?.find((s) => s.seatId === 'verifier')?.role).toBe('verifier');
    expect(res.findings?.find((f) => f.summary === 'null 未処理')?.verification).toBe(
      'undetermined',
    );
    expect(res.dispute).toEqual({
      basis: 'split',
      verifierAnswered: true,
      upheld: 0,
      refuted: 0,
      undetermined: 1,
    });
  });

  test('検証で成り立たないと判定された指摘は落とし、合格（記録には残す）', () => {
    const r1 = seat('reviewer-1', 'fail', [blocker('null 未処理')]);
    const r2 = seat('reviewer-2', 'pass');
    const res = composeTwoSeatResult({
      reviewers: [r1, r2],
      comparison: compareReviewers([r1, r2]),
      verification: {
        seat: { ...r1, seatId: 'verifier', role: 'verifier', verdict: 'pass', findings: [] },
        checks: [{ index: 1, status: 'refuted', note: '呼び出し元で null は来ない' }],
      },
    });
    expect(res.verdict).toBe('pass');
    expect(res.reasons).toEqual([]);
    const f = res.findings?.find((x) => x.summary === 'null 未処理');
    expect(f?.verification).toBe('refuted');
    expect(f?.verificationNote).toBe('呼び出し元で null は来ない');
  });

  test('検証で成り立つ指摘 → 不合格、差し戻し理由はその指摘だけ', () => {
    const r1 = seat('reviewer-1', 'fail', [blocker('null 未処理'), blocker('境界値')]);
    const r2 = seat('reviewer-2', 'pass');
    const res = composeTwoSeatResult({
      reviewers: [r1, r2],
      comparison: compareReviewers([r1, r2]),
      verification: {
        seat: { ...r1, seatId: 'verifier', role: 'verifier', findings: [] },
        checks: [
          { index: 1, status: 'holds' },
          { index: 2, status: 'refuted' },
        ],
      },
    });
    expect(res.verdict).toBe('fail');
    expect(res.reasons).toHaveLength(1);
    expect(res.reasons[0]).toContain('null 未処理');
  });
});
