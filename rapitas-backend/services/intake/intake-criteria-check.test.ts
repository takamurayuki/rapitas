/**
 * intake-criteria-check.test
 *
 * The rule layer before a development task starts (#1561): evidence-backed
 * mistakes are rewritten and recorded, nothing else is touched, and a
 * refused write never stops the start.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

type Row = Record<string, unknown>;
let row: Row | null = null;
const taskUpdate = mock(async (_a: unknown) => ({}));
mock.module('../../config', () => ({
  prisma: { task: { findUnique: async () => row, update: taskUpdate } },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const recordTransition = mock(async (_p: Record<string, unknown>) => undefined);
mock.module('../workflow/transition-recorder', () => ({ recordTransition }));
let writeResult: Record<string, unknown> = { ok: true, revision: 'rev-after' };
const writeTaskCriteria = mock(
  async (_db: unknown, _input: Record<string, unknown>) => writeResult,
);
mock.module('../task/task-criteria-write', () => ({ writeTaskCriteria }));

const { applyCriteriaRuleFixes, CRITERIA_AUTO_FIXED_CAUSE } =
  await import('./intake-criteria-check');

const task = (over: Row = {}): Row => ({
  id: 7,
  title: 'ログに理由を残す',
  description: '背景',
  workflowStatus: 'draft',
  acceptanceCriteria: '["dev-pull.test.cjs に足したテストが通る"]',
  theme: { isDevelopment: true },
  ...over,
});

beforeEach(() => {
  row = task();
  writeResult = { ok: true, revision: 'rev-after' };
  taskUpdate.mockClear();
  recordTransition.mockClear();
  writeTaskCriteria.mockClear();
});

describe('the rule layer before start', () => {
  it('moves an unreachable criterion to the handoff, and records the fix', async () => {
    row = task({ acceptanceCriteria: '["dev-pull.test.cjs が通る","CI が通る"]' });
    expect(await applyCriteriaRuleFixes(7)).toEqual(['unreachable']);
    const next = writeTaskCriteria.mock.calls[0][1].next as { acceptanceCriteria: string[] };
    expect(next.acceptanceCriteria[0]).toBe('dev-pull.test.cjs が通る');
    expect(next.acceptanceCriteria).not.toContain('CI が通る');
    const desc = (taskUpdate.mock.calls[0][0] as { data: { description: string } }).data
      .description;
    expect(desc).toContain('申し送り');
    expect(recordTransition.mock.calls[0][0].cause).toBe(CRITERIA_AUTO_FIXED_CAUSE);
  });

  it('touches nothing in a sound spec', async () => {
    expect(await applyCriteriaRuleFixes(7)).toEqual([]);
    expect(writeTaskCriteria).not.toHaveBeenCalled();
  });

  it('leaves a personal task alone', async () => {
    row = task({ acceptanceCriteria: '["CI が通る"]', theme: { isDevelopment: false } });
    expect(await applyCriteriaRuleFixes(7)).toEqual([]);
  });

  it('keeps the criteria as written when the write is refused', async () => {
    row = task({ acceptanceCriteria: '["CI が通る"]' });
    writeResult = { ok: false, reason: 'review_in_progress' };
    expect(await applyCriteriaRuleFixes(7)).toEqual([]);
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });
});
