/**
 * jury-repair-reason.test
 *
 * Task 1547: the bounce reason handed to the implementer carries the kind of
 * each decisive finding and its same-kind counterexamples, says to fix the
 * whole kind, and — when the same criterion and kind failed the two previous
 * jury bounces too — asks for a change of method. Without examples or a
 * repeat the reason is byte-identical to the old one-liner.
 */
import { describe, expect, test } from 'bun:test';
import type { ReviewFinding } from '../agents/verification/review-findings';
import {
  JURY_REPAIR_APPENDIX_MARKER,
  buildJuryRepairReason,
  METHOD_REVIEW_PREFIX,
  detectRepeatedFindingKind,
  hasMethodReviewDirective,
  stripJuryRepairAppendix,
} from './jury-repair-reason';
import { loadPriorJuryFindingRounds } from './jury-repair-history';

const f = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  severity: 'major',
  summary: '否定の取りこぼし',
  criterion: '受入基準1',
  evidence: 'a.ts:1',
  gating: true,
  kind: 'input_coverage',
  ...over,
});
const EXAMPLES = [
  '過去形: 矛盾していなかった',
  '丁寧形: 矛盾はありませんでした',
  '英語: not self-contradicting',
];
const METHOD = '方式の見直し';

describe('buildJuryRepairReason — examples (受入基準1)', () => {
  test('lists the kind and every example and forbids fixing only one', () => {
    const reason = buildJuryRepairReason(
      {
        reasons: ['受入基準1: [major] 否定の取りこぼし（根拠: a.ts:1）'],
        findings: [f({ examples: EXAMPLES })],
      },
      [],
    );
    expect(reason.startsWith('差分レビュー不合格: 受入基準1: [major] 否定の取りこぼし')).toBe(true);
    expect(reason).toContain(JURY_REPAIR_APPENDIX_MARKER);
    expect(reason).toContain('[input_coverage]');
    for (const e of EXAMPLES) expect(reason).toContain(e);
    expect(reason).toContain(
      'この種類全体を直し、反例の表をテストにすること。1件だけ直すのは不可。',
    );
    expect(reason).not.toContain(METHOD);
  });

  test('without examples or a repeat the reason is the old one-liner', () => {
    expect(buildJuryRepairReason({ reasons: ['a', 'b'], findings: [f()] }, [])).toBe(
      '差分レビュー不合格: a / b',
    );
    expect(buildJuryRepairReason({ reasons: [], findings: undefined }, [])).toBe(
      '差分レビュー不合格: 受入基準を満たしていません',
    );
  });

  test('examples of a non-decisive finding are not listed', () => {
    const deferred = f({ gating: false, deferred: 'follow_up', examples: EXAMPLES });
    const refuted = f({ verification: 'refuted', examples: EXAMPLES });
    expect(buildJuryRepairReason({ reasons: ['x'], findings: [deferred, refuted] }, [])).toBe(
      '差分レビュー不合格: x',
    );
  });

  test('the appendix is bounded', () => {
    const long = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(200));
    const findings = Array.from({ length: 8 }, (_, i) => f({ summary: `s${i}`, examples: long }));
    const reason = buildJuryRepairReason({ reasons: ['x'], findings }, []);
    expect(reason.length - '差分レビュー不合格: x'.length).toBeLessThanOrEqual(3000);
    expect(reason).toContain('1件だけ直すのは不可');
  });
});

describe('detectRepeatedFindingKind / method review (受入基準2)', () => {
  const prior = [[f()], [f()]];

  test('two previous bounces with the same criterion and kind → the third asks for a method review', () => {
    const reason = buildJuryRepairReason({ reasons: ['x'], findings: [f()] }, prior);
    expect(reason).toContain(
      '方式の見直し: 受入基準1 で同じ種類（input_coverage）の指摘が3回続いています。',
    );
    expect(reason).toContain('規則で判定する方式');
    expect(detectRepeatedFindingKind([f()], prior)).toEqual({
      criterion: '受入基準1',
      kind: 'input_coverage',
    });
  });

  test('only one previous bounce → no method review', () => {
    expect(buildJuryRepairReason({ reasons: ['x'], findings: [f()] }, [[f()]])).not.toContain(
      METHOD,
    );
  });

  test('another criterion or another kind breaks the run', () => {
    expect(detectRepeatedFindingKind([f()], [[f()], [f({ criterion: '受入基準2' })]])).toBeNull();
    expect(detectRepeatedFindingKind([f()], [[f({ kind: 'logic_error' })], [f()]])).toBeNull();
    expect(detectRepeatedFindingKind([f({ kind: 'security' })], prior)).toBeNull();
  });

  test('a non-jury bounce (null) in between breaks the run', () => {
    expect(detectRepeatedFindingKind([f()], [null, [f()]])).toBeNull();
    expect(detectRepeatedFindingKind([f()], [[f()], null])).toBeNull();
  });

  test('other matches any kind, and no criterion only matches no criterion', () => {
    expect(
      detectRepeatedFindingKind([f()], [[f({ kind: 'other' })], [f({ kind: undefined })]]),
    ).not.toBeNull();
    const none = f({ criterion: undefined });
    expect(detectRepeatedFindingKind([none], [[none], [none]])?.criterion).toBe('(基準なし)');
    expect(detectRepeatedFindingKind([none], [[f()], [none]])).toBeNull();
  });

  test('a prior finding deferred as follow_up or refuted does not count', () => {
    const deferred = f({ gating: false, deferred: 'follow_up' });
    expect(detectRepeatedFindingKind([f()], [[deferred], [f()]])).toBeNull();
    expect(detectRepeatedFindingKind([f()], [[f({ verification: 'refuted' })], [f()]])).toBeNull();
  });
});

describe('stripJuryRepairAppendix', () => {
  test('returns the headline only', () => {
    const reason = buildJuryRepairReason(
      { reasons: ['x'], findings: [f({ examples: EXAMPLES })] },
      [],
    );
    expect(stripJuryRepairAppendix(reason)).toBe('差分レビュー不合格: x');
    expect(stripJuryRepairAppendix('差分レビュー不合格: x')).toBe('差分レビュー不合格: x');
  });
});

describe('loadPriorJuryFindingRounds', () => {
  const row = (reason: string, findings?: unknown) => ({
    metadata: JSON.stringify({ reason, ...(findings ? { findings } : {}) }),
  });
  const db = (rows: Array<{ metadata: string | null }>) => ({
    workflowTransition: { findMany: async () => rows },
  });
  const noWindow = async () => null;

  test('returns the newest two jury rounds and null for a non-jury bounce', async () => {
    const rounds = await loadPriorJuryFindingRounds(1, {
      db: db([
        row('差分レビュー不合格: a', [f()]),
        row('型エラー'),
        row('差分レビュー不合格: c', [f()]),
      ]),
      windowStart: noWindow,
    });
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toHaveLength(1);
    expect(rounds[1]).toBeNull();
  });

  test('no history, malformed metadata, and a DB error all read safely', async () => {
    expect(await loadPriorJuryFindingRounds(1, { db: db([]), windowStart: noWindow })).toEqual([]);
    expect(
      await loadPriorJuryFindingRounds(1, { db: db([{ metadata: '{' }]), windowStart: noWindow }),
    ).toEqual([null]);
    const broken = {
      workflowTransition: { findMany: async () => Promise.reject(new Error('db')) },
    };
    expect(await loadPriorJuryFindingRounds(1, { db: broken, windowStart: noWindow })).toEqual([]);
  });
});

describe('loadPriorJuryFindingRounds — CI bounces break the run (R3)', () => {
  type Row = { cause: string; createdAt: Date; metadata: string };
  const at = (min: number) => new Date(Date.UTC(2026, 10, 25, 9, min));
  const jury = (min: number): Row => ({
    cause: 'verify_repair',
    createdAt: at(min),
    metadata: JSON.stringify({ reason: '差分レビュー不合格: 受入基準1: x', findings: [f()] }),
  });
  const ci = (min: number): Row => ({
    cause: 'ci_repair',
    createdAt: at(min),
    metadata: JSON.stringify({ reason: 'CI failed: Lint Code' }),
  });
  // A fake that EVALUATES the query (cause, createdAt.gt, newest first, take),
  // so a query that leaves ci_repair out returns two jury rounds.
  const evaluating = (rows: Row[]) => ({
    workflowTransition: {
      findMany: async (args: {
        where: Record<string, unknown>;
        orderBy: { createdAt: 'desc' };
        take: number;
      }) => {
        const cause = args.where.cause as string | { in: string[] };
        const allowed = typeof cause === 'string' ? [cause] : cause.in;
        const gt = (args.where.createdAt as { gt?: Date } | undefined)?.gt;
        return rows
          .filter((r) => allowed.includes(r.cause) && (!gt || r.createdAt > gt))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, args.take);
      },
    },
  });

  test('newest first: jury → ci_repair → jury does not repeat', async () => {
    const rounds = await loadPriorJuryFindingRounds(1, {
      db: evaluating([jury(1), ci(2), jury(3)]),
      windowStart: async () => null,
    });
    expect(rounds).toHaveLength(2);
    expect(rounds[1]).toBeNull();
    expect(detectRepeatedFindingKind([f()], rounds)).toBeNull();
  });

  test('two jury bounces without a CI bounce in between still repeat', async () => {
    const rounds = await loadPriorJuryFindingRounds(1, {
      db: evaluating([ci(0), jury(1), jury(3)]),
      windowStart: async () => null,
    });
    expect(detectRepeatedFindingKind([f()], rounds)).not.toBeNull();
  });

  test('rows before the repair window are not read', async () => {
    const rounds = await loadPriorJuryFindingRounds(1, {
      db: evaluating([jury(1), jury(3)]),
      windowStart: async () => at(2),
    });
    expect(rounds).toHaveLength(1);
  });

  test('the CI cause matches ci-self-repair', async () => {
    const { CI_REPAIR_CAUSE } = await import('./jury-repair-history');
    const ci = await import('./ci-self-repair');
    expect(CI_REPAIR_CAUSE).toBe(ci.CI_REPAIR_CAUSE);
  });
});

describe('hasMethodReviewDirective (R2)', () => {
  const repeated = buildJuryRepairReason({ reasons: ['x'], findings: [f()] }, [[f()], [f()]]);

  test('true when the appendix carries the method review', () => {
    expect(repeated).toContain(METHOD_REVIEW_PREFIX);
    expect(hasMethodReviewDirective(repeated)).toBe(true);
  });

  test('false when the words are only in the headline or there is no appendix', () => {
    expect(hasMethodReviewDirective(`差分レビュー不合格: ${METHOD_REVIEW_PREFIX}x`)).toBe(false);
    const withExamplesOnly = buildJuryRepairReason(
      { reasons: [`${METHOD_REVIEW_PREFIX}x`], findings: [f({ examples: EXAMPLES })] },
      [],
    );
    expect(hasMethodReviewDirective(withExamplesOnly)).toBe(false);
    expect(hasMethodReviewDirective('')).toBe(false);
  });
});
