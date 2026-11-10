/**
 * review-history ユニットテスト
 *
 * タイムラインの `verification_measured`（実測）と `adversarial_review`（陪審）を
 * 表示用に正規化する。findings 以前の古いイベント（reasons のみ）も壊さず読む。
 */
import {
  deriveJuryReviewHistory,
  deriveMeasuredHistory,
  deriveReviewHoldResolutions,
} from '../review-history';

describe('deriveJuryReviewHistory', () => {
  it('normalises findings, puts verdict-deciding ones first, and counts who judged', () => {
    const [entry] = deriveJuryReviewHistory([
      {
        id: 5,
        eventType: 'adversarial_review',
        createdAt: '2026-11-10T01:00:00Z',
        payload: {
          verdict: 'fail',
          severity: 70,
          jurors: [{ verdict: 'fail' }, { verdict: 'pass' }, { verdict: 'unknown' }],
          findings: [
            { severity: 'minor', summary: 'nit', evidence: 'a.ts:2', juror: 'opus' },
            {
              severity: 'major',
              summary: 'bug',
              evidence: 'a.ts:1',
              criterion: '受入基準2',
              repro: 'run x',
              gating: true,
            },
            { severity: 'blocker', summary: 'guess', needsCheck: true },
            { severity: 'major' },
          ],
        },
      },
    ]);
    expect(entry.verdict).toBe('fail');
    // The gating major leads; the unevidenced "blocker" (要確認) follows it.
    expect(entry.findings.map((f) => f.severity)).toEqual(['major', 'blocker', 'minor']);
    expect(entry.findings[1]).toMatchObject({ needsCheck: true, evidence: null });
    expect(entry.findings[0]).toMatchObject({
      gating: true,
      criterion: '受入基準2',
      repro: 'run x',
    });
    expect(entry.jurorCount).toBe(3);
    expect(entry.judgedCount).toBe(2);
  });

  it('reads pre-findings events through their jurors’ reasons', () => {
    const [entry] = deriveJuryReviewHistory([
      {
        id: 1,
        eventType: 'adversarial_review',
        payload: { verdict: 'fail', jurors: [{ verdict: 'fail', reasons: ['r1', 'r1', 'r2'] }] },
      },
    ]);
    expect(entry.findings).toEqual([]);
    expect(entry.legacyReasons).toEqual(['r1', 'r2']);
  });

  it('keeps a pass with an empty findings array as "no findings", not legacy', () => {
    const [entry] = deriveJuryReviewHistory([
      {
        id: 1,
        eventType: 'adversarial_review',
        payload: { verdict: 'pass', findings: [], jurors: [] },
      },
    ]);
    expect(entry.verdict).toBe('pass');
    expect(entry.legacyReasons).toEqual([]);
  });

  it('ignores other event types and sorts oldest first', () => {
    const rows = deriveJuryReviewHistory([
      {
        id: 2,
        eventType: 'adversarial_review',
        createdAt: '2026-11-10T02:00:00Z',
        payload: { verdict: 'pass' },
      },
      { id: 9, eventType: 'task_outcome', payload: {} },
      {
        id: 1,
        eventType: 'adversarial_review',
        createdAt: '2026-11-10T01:00:00Z',
        payload: { verdict: 'fail' },
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['jury-1', 'jury-2']);
  });
});

describe('deriveMeasuredHistory', () => {
  it('maps each check to ok / ng / skipped / unverifiable', () => {
    const [entry] = deriveMeasuredHistory([
      {
        id: 3,
        eventType: 'verification_measured',
        payload: {
          result: {
            ok: false,
            checks: [
              { name: 'lint', ran: true, ok: true, errorCount: 0 },
              { name: 'test', ran: true, ok: false, errorCount: 2 },
              { name: 'runtime', ran: false, ok: true, errorCount: 0 },
              { name: 'typecheck', ran: true, ok: false, errorCount: 0, unverifiable: true },
            ],
          },
        },
      },
    ]);
    expect(entry.outcome).toBe('fail');
    expect(entry.checks.map((c) => c.status)).toEqual(['ok', 'ng', 'skipped', 'unverifiable']);
    expect(entry.checks[1].errorCount).toBe(2);
  });

  it('reports an unverifiable run as such, and skips malformed payloads', () => {
    const rows = deriveMeasuredHistory([
      {
        id: 1,
        eventType: 'verification_measured',
        payload: { result: { ok: false, unverifiable: true, checks: [] } },
      },
      { id: 2, eventType: 'verification_measured', payload: { result: {} } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('unverifiable');
  });
});

describe('deriveJuryReviewHistory — two-reviewer form', () => {
  const twoSeat = (over: Record<string, unknown> = {}) => ({
    id: 9,
    eventType: 'adversarial_review',
    createdAt: '2026-11-10T03:00:00Z',
    payload: {
      form: 'two_seat',
      verdict: 'hold',
      severity: 90,
      jurors: [
        { seatId: 'reviewer-1', role: 'reviewer', verdict: 'fail', model: 'opus' },
        { seatId: 'reviewer-2', role: 'reviewer', verdict: 'pass', model: 'sonnet' },
        { seatId: 'verifier', role: 'verifier', verdict: 'pass', model: 'opus' },
      ],
      seats: [
        { seatId: 'reviewer-1', role: 'reviewer', verdict: 'fail', model: 'opus' },
        { seatId: 'reviewer-2', role: 'reviewer', verdict: 'pass', model: 'sonnet' },
        { seatId: 'verifier', role: 'verifier', verdict: 'pass', model: 'opus' },
      ],
      findings: [
        {
          severity: 'blocker',
          summary: 'null 未処理',
          evidence: 'a.ts:1',
          gating: true,
          seatId: 'reviewer-1',
          verification: 'undetermined',
          verificationNote: '呼び出し元が差分外',
        },
        { severity: 'minor', summary: '命名', seatId: 'reviewer-2' },
      ],
      dispute: { basis: 'split', verifierAnswered: true, upheld: 0, refuted: 0, undetermined: 1 },
      awaitingHuman: { reason: 'unresolved_dispute', detail: '検証席が判定できませんでした' },
      ...over,
    },
  });

  it('reads seats by role, the verifier check per finding, and the human wait', () => {
    const [entry] = deriveJuryReviewHistory([twoSeat()]);
    expect(entry.form).toBe('two_seat');
    expect(entry.verdict).toBe('hold');
    expect(entry.seats.map((s) => [s.seatId, s.role, s.verdict])).toEqual([
      ['reviewer-1', 'reviewer', 'fail'],
      ['reviewer-2', 'reviewer', 'pass'],
      ['verifier', 'verifier', 'pass'],
    ]);
    expect(entry.findings[0]).toMatchObject({
      seatId: 'reviewer-1',
      verification: 'undetermined',
      verificationNote: '呼び出し元が差分外',
    });
    expect(entry.findings[1].verification).toBeNull();
    expect(entry.awaitingHuman).toEqual({
      reason: 'unresolved_dispute',
      detail: '検証席が判定できませんでした',
    });
    // Seats asked (reviewers), not the verifier, are the "who judged" count.
    expect(entry.jurorCount).toBe(2);
    expect(entry.judgedCount).toBe(2);
  });

  it('a refuted finding is kept on the record but marked as dropped', () => {
    const [entry] = deriveJuryReviewHistory([
      twoSeat({
        verdict: 'pass',
        awaitingHuman: undefined,
        findings: [
          {
            severity: 'blocker',
            summary: 'x',
            evidence: 'a.ts:1',
            gating: true,
            seatId: 'reviewer-1',
            verification: 'refuted',
          },
        ],
      }),
    ]);
    expect(entry.verdict).toBe('pass');
    expect(entry.awaitingHuman).toBeNull();
    expect(entry.findings[0].verification).toBe('refuted');
  });

  it('older three-seat events still read as legacy with no seats', () => {
    const [entry] = deriveJuryReviewHistory([
      {
        id: 1,
        eventType: 'adversarial_review',
        payload: { verdict: 'pass', jurors: [{ verdict: 'pass' }] },
      },
    ]);
    expect(entry.form).toBe('legacy');
    expect(entry.seats).toEqual([]);
    expect(entry.awaitingHuman).toBeNull();
  });
});

describe('deriveReviewHoldResolutions', () => {
  it('reads who resolved a hold and how, oldest first', () => {
    const rows = deriveReviewHoldResolutions([
      {
        id: 2,
        eventType: 'review_hold_resolved',
        createdAt: '2026-11-10T05:00:00Z',
        payload: { action: 'override', resolvedBy: 'ユーザー操作', note: '確認済み' },
      },
      {
        id: 1,
        eventType: 'review_hold_resolved',
        createdAt: '2026-11-10T04:00:00Z',
        payload: { action: 'accept', resolvedBy: 'ユーザー操作' },
      },
      { id: 3, eventType: 'adversarial_review', payload: {} },
    ]);
    expect(rows.map((r) => [r.action, r.note])).toEqual([
      ['accept', null],
      ['override', '確認済み'],
    ]);
  });
});
