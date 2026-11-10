/**
 * review-history ユニットテスト
 *
 * タイムラインの `verification_measured`（実測）と `adversarial_review`（陪審）を
 * 表示用に正規化する。findings 以前の古いイベント（reasons のみ）も壊さず読む。
 */
import { deriveJuryReviewHistory, deriveMeasuredHistory } from '../review-history';

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
