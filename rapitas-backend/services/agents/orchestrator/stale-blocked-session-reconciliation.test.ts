/**
 * stale-blocked-session-reconciliation.test
 *
 * reconcileOrphanedBlockedSessions: verify-exhausted "limbo" sessions —
 * task.status='blocked', AgentSession left active/pending from before this
 * boot — must be finalized to 'interrupted' UNLESS a currently-tracked live
 * execution still backs them, and a failure must never propagate (best-effort
 * bookkeeping, not a hard dependency for startup).
 *
 * pruneStaleWorktreePointers: a recorded worktreePath that no longer points to
 * a real git worktree on disk must be nulled so a later resume/retry can't be
 * handed a phantom cwd (task 30 / task 233 regressions); a still-real worktree
 * must be left untouched.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

mock.module('../../../config', () => ({
  prisma: {},
  ensureDatabaseConnection: mock(async () => {}),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  getDbProvider: () => 'postgresql' as const,
  getInsensitiveMode: () => ({ mode: 'insensitive' as const }),
  getProjectRoot: () => '/repo',
}));

const { reconcileOrphanedBlockedSessions, pruneStaleWorktreePointers } =
  await import('./stale-blocked-session-reconciliation');

import type { ExecutionState, OrchestratorContext } from './types';

/**
 * Minimal OrchestratorContext for these tests — only prisma.agentSession and
 * activeExecutions/serverStartedAt are consulted by either function.
 */
function makeCtx(
  overrides: {
    findMany?: (args: unknown) => Promise<unknown[]>;
    update?: (args: unknown) => Promise<unknown>;
    activeExecutions?: Map<number, ExecutionState>;
  } = {},
): OrchestratorContext {
  return {
    prisma: {
      agentSession: {
        findMany: mock(overrides.findMany ?? (async () => [])),
        update: mock(overrides.update ?? (async () => ({}))),
      },
    } as unknown as OrchestratorContext['prisma'],
    activeExecutions: overrides.activeExecutions ?? new Map(),
    activeAgents: new Map(),
    isShuttingDown: false,
    serverStartedAt: new Date('2026-01-01T00:00:00Z'),
    emitEvent: () => {},
    startQuestionTimeout: () => {},
    cancelQuestionTimeout: () => {},
    getQuestionTimeoutInfo: () => null,
    tryAcquireContinuationLock: () => true,
    releaseContinuationLock: () => {},
    buildAgentConfigFromDb: mock(async () => ({ type: 'claude-code' as const, name: 'test' })),
  } as OrchestratorContext;
}

/** Minimal ExecutionState for populating ctx.activeExecutions in tests. */
function execState(executionId: number): ExecutionState {
  return {
    executionId,
    sessionId: 1,
    agentId: 'agent-1',
    taskId: 1,
    status: 'running',
    startedAt: new Date(),
    output: '',
  };
}

describe('reconcileOrphanedBlockedSessions', () => {
  test('no candidates → empty result, findMany queried once', async () => {
    const findMany = mock(async () => []);
    const ctx = makeCtx({ findMany });

    const result = await reconcileOrphanedBlockedSessions(ctx);

    expect(result.reconciledSessionIds).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  test('queries active/pending sessions predating this boot on a blocked task', async () => {
    const findMany = mock(async () => []);
    const ctx = makeCtx({ findMany });

    await reconcileOrphanedBlockedSessions(ctx);

    const args = findMany.mock.calls[0]?.[0] as {
      where: {
        status: { in: string[] };
        lastActivityAt: { lt: Date };
        config: { task: { status: string } };
      };
    };
    expect(args.where.status.in).toEqual(['active', 'pending']);
    expect(args.where.lastActivityAt.lt).toEqual(ctx.serverStartedAt);
    expect(args.where.config.task.status).toBe('blocked');
  });

  test('reconciles a candidate with no live execution to interrupted', async () => {
    const update = mock(async () => ({}));
    const ctx = makeCtx({
      findMany: async () => [{ id: 5, agentExecutions: [] }],
      update,
    });

    const result = await reconcileOrphanedBlockedSessions(ctx);

    expect(result.reconciledSessionIds).toEqual([5]);
    expect(update).toHaveBeenCalledTimes(1);
    const args = update.mock.calls[0]?.[0] as { where: { id: number }; data: { status: string } };
    expect(args.where.id).toBe(5);
    expect(args.data.status).toBe('interrupted');
  });

  test('skips a candidate whose execution is still tracked as live', async () => {
    const update = mock(async () => ({}));
    const ctx = makeCtx({
      findMany: async () => [{ id: 6, agentExecutions: [{ id: 42 }] }],
      update,
      activeExecutions: new Map([[1, execState(42)]]),
    });

    const result = await reconcileOrphanedBlockedSessions(ctx);

    expect(result.reconciledSessionIds).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });

  test('reconciles a candidate execution NOT tracked as live (crashed before finalizing)', async () => {
    const ctx = makeCtx({
      findMany: async () => [{ id: 7, agentExecutions: [{ id: 99 }] }],
      activeExecutions: new Map(), // nothing tracked live post-restart
    });

    const result = await reconcileOrphanedBlockedSessions(ctx);

    expect(result.reconciledSessionIds).toEqual([7]);
  });

  test('continues past a per-session update failure and still reconciles the rest', async () => {
    const update = mock(async (args: { where: { id: number } }) => {
      if (args.where.id === 8) throw new Error('db write failed');
      return {};
    });
    const ctx = makeCtx({
      findMany: async () => [
        { id: 8, agentExecutions: [] },
        { id: 9, agentExecutions: [] },
      ],
      update,
    });

    const result = await reconcileOrphanedBlockedSessions(ctx);

    expect(result.reconciledSessionIds).toEqual([9]);
    expect(update).toHaveBeenCalledTimes(2);
  });

  test('a findMany failure is swallowed and returns an empty result (never throws)', async () => {
    const ctx = makeCtx({
      findMany: async () => {
        throw new Error('db unreachable');
      },
    });

    await expect(reconcileOrphanedBlockedSessions(ctx)).resolves.toEqual({
      reconciledSessionIds: [],
    });
  });
});

describe('pruneStaleWorktreePointers', () => {
  const TMP_ROOT = resolve('.tmp-tests/stale-blocked-session-reconciliation');

  beforeEach(async () => {
    await rm(TMP_ROOT, { recursive: true, force: true });
    await mkdir(TMP_ROOT, { recursive: true });
  });

  afterEach(async () => {
    await rm(TMP_ROOT, { recursive: true, force: true });
  });

  test('returns 0 without querying when sessionIds is empty', async () => {
    const findMany = mock(async () => []);
    const ctx = makeCtx({ findMany });

    const pruned = await pruneStaleWorktreePointers(ctx, new Set());

    expect(pruned).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  test('leaves a still-real worktree (dir + .git) untouched', async () => {
    const realWorktree = join(TMP_ROOT, 'real-wt');
    await mkdir(join(realWorktree, '.git'), { recursive: true });
    const update = mock(async () => ({}));
    const ctx = makeCtx({
      findMany: async () => [{ id: 1, worktreePath: realWorktree }],
      update,
    });

    const pruned = await pruneStaleWorktreePointers(ctx, new Set([1]));

    expect(pruned).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  test('nulls a phantom worktree path (directory no longer exists on disk)', async () => {
    const phantomWorktree = join(TMP_ROOT, 'does-not-exist');
    const update = mock(async () => ({}));
    const ctx = makeCtx({
      findMany: async () => [{ id: 2, worktreePath: phantomWorktree }],
      update,
    });

    const pruned = await pruneStaleWorktreePointers(ctx, new Set([2]));

    expect(pruned).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    const args = update.mock.calls[0]?.[0] as {
      where: { id: number };
      data: { worktreePath: null };
    };
    expect(args.where.id).toBe(2);
    expect(args.data.worktreePath).toBeNull();
  });

  test('a directory that exists but has no .git is still treated as phantom', async () => {
    // Mirrors the task-288 partial-worktree case: mkdir succeeded, `git worktree
    // add` did not, leaving an empty dir that a bare existsSync would misjudge.
    const emptyDir = join(TMP_ROOT, 'empty-not-a-worktree');
    await mkdir(emptyDir, { recursive: true });
    const update = mock(async () => ({}));
    const ctx = makeCtx({
      findMany: async () => [{ id: 3, worktreePath: emptyDir }],
      update,
    });

    const pruned = await pruneStaleWorktreePointers(ctx, new Set([3]));

    expect(pruned).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('continues past a per-session update failure', async () => {
    const okPhantom = join(TMP_ROOT, 'phantom-ok');
    const failPhantom = join(TMP_ROOT, 'phantom-fail');
    const update = mock(async (args: { where: { id: number } }) => {
      if (args.where.id === 41) throw new Error('db write failed');
      return {};
    });
    const ctx = makeCtx({
      findMany: async () => [
        { id: 40, worktreePath: okPhantom },
        { id: 41, worktreePath: failPhantom },
      ],
      update,
    });

    const pruned = await pruneStaleWorktreePointers(ctx, new Set([40, 41]));

    expect(pruned).toBe(1);
    expect(update).toHaveBeenCalledTimes(2);
  });

  test('a findMany failure is swallowed and returns 0 (never throws)', async () => {
    const ctx = makeCtx({
      findMany: async () => {
        throw new Error('db unreachable');
      },
    });

    const pruned = await pruneStaleWorktreePointers(ctx, new Set([1]));

    expect(pruned).toBe(0);
  });
});
