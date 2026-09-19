/**
 * workflow-requirement-mismatch-context.test
 *
 * Covers the planner-facing side of the SYSTEM-detected requirement/plan
 * mismatch: the rendered section must clearly mark itself as a machine
 * detection (never impersonating a human `revise-plan` request, task 909),
 * and the staleness rule mirrors workflow-plan-revision-context.test.ts's.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const transitionFindFirst = mock(() =>
  Promise.resolve<{ createdAt: Date; metadata: string | null } | null>(null),
);
const fileFindFirst = mock(() => Promise.resolve<{ updatedAt: Date } | null>(null));

mock.module('../../config/database', () => ({
  prisma: {
    workflowTransition: { findFirst: transitionFindFirst },
    workflowFile: { findFirst: fileFindFirst },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const {
  renderRequirementMismatchContext,
  getPendingRequirementMismatch,
  buildRequirementMismatchContext,
} = await import('./workflow-requirement-mismatch-context');
const { REQUIREMENT_MISMATCH_CAUSE } = await import('./verify-requirement-plan-mismatch');

const AT = (iso: string) => new Date(iso);

describe('renderRequirementMismatchContext', () => {
  test('carries the flagged criterion AND the current plan, marked as a machine detection', () => {
    const out = renderRequirementMismatchContext(
      '.supervisor/measurements/task906-red.patch のとおりに適用される',
      '# 実装計画\n## チェックリスト',
      'ja',
    );
    expect(out).toContain('.supervisor/measurements/task906-red.patch');
    expect(out).toContain('# 実装計画');
    // 人間の指示ではないことを明示する — task 909 の核心制約。
    expect(out).toContain('システムによる自動検出');
    expect(out).not.toContain('人間からの依頼');
  });

  test('returns nothing for a blank criterion', () => {
    expect(renderRequirementMismatchContext('   ', '# 実装計画', 'ja')).toBe('');
  });

  test('truncates an oversized plan instead of unbounded prompt growth', () => {
    const huge = 'x'.repeat(30000);
    const out = renderRequirementMismatchContext('.supervisor/x.patch', huge, 'ja');
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toContain('長さ上限により省略');
  });

  test('english variant also marks itself as system-detected, not a human instruction', () => {
    const out = renderRequirementMismatchContext('.supervisor/x.patch', '# Plan', 'en');
    expect(out).toContain('SYSTEM-detected');
    expect(out).not.toContain('a human — highest priority');
  });
});

describe('getPendingRequirementMismatch', () => {
  beforeEach(() => {
    transitionFindFirst.mockReset().mockResolvedValue(null);
    fileFindFirst.mockReset().mockResolvedValue(null);
  });

  test('reads the REQUIREMENT_MISMATCH_CAUSE transition, not plan_revision_requested', async () => {
    transitionFindFirst.mockResolvedValue({
      createdAt: AT('2026-09-09T03:00:00Z'),
      metadata: JSON.stringify({ criterion: '.supervisor/x.patch' }),
    });
    fileFindFirst.mockResolvedValue({ updatedAt: AT('2026-09-09T02:00:00Z') });

    expect(await getPendingRequirementMismatch(909)).toBe('.supervisor/x.patch');
    expect(transitionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { taskId: 909, cause: REQUIREMENT_MISMATCH_CAUSE } }),
    );
  });

  test('returns null once a plan saved AFTER the mismatch has addressed it', async () => {
    transitionFindFirst.mockResolvedValue({
      createdAt: AT('2026-09-09T03:00:00Z'),
      metadata: JSON.stringify({ criterion: '.supervisor/x.patch' }),
    });
    fileFindFirst.mockResolvedValue({ updatedAt: AT('2026-09-09T03:30:00Z') });

    expect(await getPendingRequirementMismatch(909)).toBeNull();
  });

  test('returns null when no mismatch was ever detected', async () => {
    expect(await getPendingRequirementMismatch(909)).toBeNull();
  });

  test('survives malformed metadata instead of throwing into the planner', async () => {
    transitionFindFirst.mockResolvedValue({
      createdAt: AT('2026-09-09T03:00:00Z'),
      metadata: 'not json',
    });
    expect(await getPendingRequirementMismatch(909)).toBeNull();
  });
});

describe('buildRequirementMismatchContext', () => {
  beforeEach(() => {
    transitionFindFirst.mockReset().mockResolvedValue(null);
    fileFindFirst.mockReset().mockResolvedValue(null);
  });

  test('injects nothing when there is no plan yet', async () => {
    transitionFindFirst.mockResolvedValue({
      createdAt: AT('2026-09-09T03:00:00Z'),
      metadata: JSON.stringify({ criterion: '.supervisor/x.patch' }),
    });
    expect(await buildRequirementMismatchContext(909, null, 'ja')).toBe('');
  });

  test('renders the section when a mismatch is pending', async () => {
    transitionFindFirst.mockResolvedValue({
      createdAt: AT('2026-09-09T03:00:00Z'),
      metadata: JSON.stringify({ criterion: '.supervisor/x.patch を実装する' }),
    });
    fileFindFirst.mockResolvedValue({ updatedAt: AT('2026-09-09T02:00:00Z') });

    const out = await buildRequirementMismatchContext(909, '# 実装計画', 'ja');
    expect(out).toContain('.supervisor/x.patch を実装する');
    expect(out).toContain('# 実装計画');
  });
});
