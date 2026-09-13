/**
 * stale-pr-reaper.test.ts
 *
 * Unit tests for the exhausted+CONFLICTING/DIRTY auto-PR reaper (task #931).
 * prisma, gh, and the concern/transition side effects are all stubbed —
 * no real gh call or network access occurs.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const submitConcernMock = mock(async () => ({ id: 1, outcome: 'created' as const }));
const recordTransitionMock = mock(async () => {});

mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: submitConcernMock,
}));
mock.module('./transition-recorder', () => ({
  recordTransition: recordTransitionMock,
}));

const prTable = {
  updateMany: mock(async () => ({ count: 1 })),
  findMany: mock(async () => []),
};
const taskTable = {
  findUnique: mock(
    async () => null as { id: number; themeId: number | null; description: string | null } | null,
  ),
  update: mock(async () => ({})),
};
const themeTable = {
  findUnique: mock(
    async () => ({ workingDirectory: '/repo' }) as { workingDirectory: string | null } | null,
  ),
};
const transitionTable = {
  findMany: mock(async () => []),
};

mock.module('../../config/database', () => ({
  prisma: {
    gitHubPullRequest: prTable,
    task: taskTable,
    theme: themeTable,
    workflowTransition: transitionTable,
  },
}));

const { reapStaleAutoPrs, findStaleCandidates } = await import('./stale-pr-reaper');

const NOW = Date.parse('2026-09-14T00:00:00Z');
const EXHAUSTED_10D_AGO = new Date(NOW - 10 * 86_400_000);
const EXHAUSTED_1D_AGO = new Date(NOW - 1 * 86_400_000);

function baseSetup(overrides?: {
  exhaustedAt?: Date;
  storedHeadSha?: string | null;
  descriptionHasMarker?: boolean;
}) {
  const exhaustedAt = overrides?.exhaustedAt ?? EXHAUSTED_10D_AGO;
  const storedHeadSha =
    overrides?.storedHeadSha === undefined ? 'sha-old' : overrides.storedHeadSha;

  prTable.findMany.mockResolvedValue([
    { id: 1, integrationId: 42, prNumber: 632, linkedTaskId: 559 },
  ] as never);
  transitionTable.findMany.mockResolvedValue([
    {
      taskId: 559,
      createdAt: exhaustedAt,
      metadata:
        storedHeadSha == null ? JSON.stringify({}) : JSON.stringify({ headSha: storedHeadSha }),
    },
  ] as never);
  taskTable.findUnique.mockResolvedValue({
    id: 559,
    themeId: 3,
    description: overrides?.descriptionHasMarker
      ? '[stale-pr-reaper] PR #632 既存注記'
      : '既存の説明',
  } as never);
  themeTable.findUnique.mockResolvedValue({ workingDirectory: '/repo' } as never);
}

describe('stale-pr-reaper', () => {
  beforeEach(() => {
    prTable.updateMany.mockClear();
    prTable.findMany.mockClear();
    taskTable.findUnique.mockClear();
    taskTable.update.mockClear();
    themeTable.findUnique.mockClear();
    transitionTable.findMany.mockClear();
    submitConcernMock.mockClear();
    recordTransitionMock.mockClear();
  });

  it('closes an exhausted PR that is DIRTY, ≥7 days old, and head-matched', async () => {
    baseSetup();
    const execGh = mock(async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return JSON.stringify({ headRefOid: 'sha-old', mergeStateStatus: 'DIRTY' });
      }
      return '';
    });
    const result = await reapStaleAutoPrs({ execGh, now: () => NOW });
    expect(result).toEqual({ evaluated: 1, closed: 1 });
    expect(execGh).toHaveBeenCalledWith(
      ['pr', 'close', '632', '--comment', expect.any(String)],
      '/repo',
    );
    expect(prTable.updateMany).toHaveBeenCalledWith({
      where: { id: 1, state: 'open' },
      data: { state: 'closed', updatedAt: expect.any(Date) },
    });
    const updateCall = taskTable.update.mock.calls[0]?.[0] as {
      data: { description: string };
    };
    expect(updateCall.data.description).toContain('[stale-pr-reaper] PR #632');
    expect(submitConcernMock).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'stale-pr:42:632' }),
    );
  });

  it('closes when mergeable=CONFLICTING even if mergeStateStatus is not DIRTY', async () => {
    baseSetup();
    const execGh = mock(async (args: string[]) => {
      if (args[1] === 'view') {
        return JSON.stringify({
          headRefOid: 'sha-old',
          mergeStateStatus: 'BLOCKED',
          mergeable: 'CONFLICTING',
        });
      }
      return '';
    });
    const result = await reapStaleAutoPrs({ execGh, now: () => NOW });
    expect(result.closed).toBe(1);
  });

  it('does not close before RAPITAS_STALE_PR_DAYS has elapsed', async () => {
    baseSetup({ exhaustedAt: EXHAUSTED_1D_AGO });
    const execGh = mock(async () =>
      JSON.stringify({ headRefOid: 'sha-old', mergeStateStatus: 'DIRTY' }),
    );
    const result = await reapStaleAutoPrs({ execGh, now: () => NOW });
    expect(result).toEqual({ evaluated: 1, closed: 0 });
    expect(execGh).not.toHaveBeenCalled();
  });

  it('does not close when neither DIRTY nor CONFLICTING', async () => {
    baseSetup();
    const execGh = mock(async () =>
      JSON.stringify({ headRefOid: 'sha-old', mergeStateStatus: 'CLEAN' }),
    );
    const result = await reapStaleAutoPrs({ execGh, now: () => NOW });
    expect(result.closed).toBe(0);
  });

  it('does not close when the head SHA moved since the exhausted mark', async () => {
    baseSetup();
    const execGh = mock(async () =>
      JSON.stringify({ headRefOid: 'sha-new', mergeStateStatus: 'DIRTY' }),
    );
    const result = await reapStaleAutoPrs({ execGh, now: () => NOW });
    expect(result.closed).toBe(0);
  });

  it('gh pr close failure → fail-open: no DB update, no concern filed', async () => {
    baseSetup();
    const execGh = mock(async (args: string[]) => {
      if (args[1] === 'view')
        return JSON.stringify({ headRefOid: 'sha-old', mergeStateStatus: 'DIRTY' });
      throw new Error('gh network error');
    });
    const result = await reapStaleAutoPrs({ execGh, now: () => NOW });
    expect(result.closed).toBe(0);
    expect(prTable.updateMany).not.toHaveBeenCalled();
    expect(taskTable.update).not.toHaveBeenCalled();
    expect(submitConcernMock).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  it('caps evaluation to MAX_STALE_PR_PER_TICK (3) when more candidates exist', async () => {
    prTable.findMany.mockResolvedValue(
      [1, 2, 3, 4].map((n) => ({
        id: n,
        integrationId: 1,
        prNumber: 100 + n,
        linkedTaskId: n,
      })) as never,
    );
    transitionTable.findMany.mockResolvedValue(
      [1, 2, 3, 4].map((n) => ({
        taskId: n,
        createdAt: new Date(NOW - (10 + n) * 86_400_000),
        metadata: JSON.stringify({ headSha: 'sha-old' }),
      })) as never,
    );
    const candidates = await findStaleCandidates();
    expect(candidates.length).toBe(3);
  });

  it('defaults to 7 days: 8 days old closes, 6 days old does not (env unset in this test run)', async () => {
    expect(process.env.RAPITAS_STALE_PR_DAYS).toBeUndefined();
    baseSetup({ exhaustedAt: new Date(NOW - 8 * 86_400_000) });
    const execGhClose = mock(async () =>
      JSON.stringify({ headRefOid: 'sha-old', mergeStateStatus: 'DIRTY' }),
    );
    expect((await reapStaleAutoPrs({ execGh: execGhClose, now: () => NOW })).closed).toBe(1);

    baseSetup({ exhaustedAt: new Date(NOW - 6 * 86_400_000) });
    const execGhNoClose = mock(async () =>
      JSON.stringify({ headRefOid: 'sha-old', mergeStateStatus: 'DIRTY' }),
    );
    expect((await reapStaleAutoPrs({ execGh: execGhNoClose, now: () => NOW })).closed).toBe(0);
  });

  it('DB error in findStaleCandidates → reapStaleAutoPrs returns zero counts (fail-open)', async () => {
    prTable.findMany.mockRejectedValueOnce(new Error('db down') as never);
    const execGh = mock(async () => '');
    const result = await reapStaleAutoPrs({ execGh, now: () => NOW });
    expect(result).toEqual({ evaluated: 0, closed: 0 });
  });
});
