/**
 * blocked-retry-dispatch.guards.test
 *
 * Proves resetBlockedTaskForRetry never revives a stopped, cancelled or hold-derived block
 * (task 1563): the stop guard runs before every work-preserving branch (stage kept, merge
 * wait, completion), and only allow-listed blocked causes may be resumed.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

type TaskRow = { status: string; workflowStatus: string | null };
let taskRow: TaskRow = { status: 'blocked', workflowStatus: null };
let lastUpdateWhere: Record<string, unknown> | null = null;
const cycleEvents: Array<{ evt: string; fields: Record<string, unknown> }> = [];
type Recorded = { fromStatus: string | null; toStatus: string; cause: string };
let transitions: Recorded[] = [];
mock.module('./transition-recorder', () => ({
  recordTransition: async (t: Recorded) => {
    transitions.push(t);
  },
}));

const realCycle = await import('../observability/cycle-event-logger');
mock.module('../observability/cycle-event-logger', () => ({
  ...realCycle,
  logCycleEvent: (evt: string, fields: Record<string, unknown>) => {
    cycleEvents.push({ evt, fields });
  },
}));

const fakePrisma = {
  task: {
    findUnique: async () => ({ status: taskRow.status, autoRunExcluded: false }),
    update: async (args: { where?: Record<string, unknown>; data: Partial<TaskRow> }) => {
      lastUpdateWhere = args.where ?? null;
      Object.assign(taskRow, { ...args.data, updatedAt: undefined });
      return taskRow;
    },
    updateMany: async (args: { where?: Record<string, unknown>; data: Partial<TaskRow> }) => {
      lastUpdateWhere = args.where ?? null;
      Object.assign(taskRow, { ...args.data, updatedAt: undefined });
      return { count: 1 };
    },
  },
  workflowTransition: {
    findFirst: async () => ({ id: 1 }),
    update: async () => ({}),
  },
  userSettings: { findFirst: () => Promise.resolve({ autoRunMaxConcurrency: 4 }) },
  themeAutoRun: { findFirst: () => Promise.resolve(null), count: () => Promise.resolve(0) },
};

mock.module('../../config/database', () => ({ prisma: fakePrisma }));

const { resetBlockedTaskForRetry } = await import('./blocked-retry-dispatch');
const { RESUMABLE_BLOCK_CAUSES } = await import('./blocked-retry-resume-stage');

// biome-ignore lint: test double
const db = fakePrisma as never;

describe('resetBlockedTaskForRetry stop guard and cause allow-list (task 1563)', () => {
  let completes: number[] = [];
  let canReviveOk = true;
  let canReviveCalls = 0;

  type Facts = {
    dirExists?: boolean;
    hasPr?: boolean;
    prState?: string | null;
    blockedCause?: string | null;
  };
  const run = (stage: string, facts: Facts = {}) => {
    taskRow = { status: 'blocked', workflowStatus: stage };
    return resetBlockedTaskForRetry(db, { id: 1563, themeId: 7, workflowStatus: stage }, 1, {
      select: async () => {},
      facts: async () => ({
        stage,
        dirExists: false,
        hasPr: false,
        prState: null,
        unpushedCommits: null,
        blockedCause: 'auto_run_hang_backstop',
        ...facts,
      }),
      canRevive: async () => {
        canReviveCalls++;
        return canReviveOk;
      },
      complete: async (id: number) => {
        completes.push(id);
        taskRow = { status: 'done', workflowStatus: 'completed' };
        return true;
      },
    } as never);
  };

  beforeEach(() => {
    transitions = [];
    completes = [];
    canReviveOk = true;
    canReviveCalls = 0;
    cycleEvents.length = 0;
    lastUpdateWhere = null;
  });

  const expectLeftBlocked = (outcome: unknown) => {
    expect(outcome).toBe('not_needed');
    expect(taskRow.status).toBe('blocked');
    expect(transitions).toHaveLength(0);
    expect(completes).toHaveLength(0);
    expect(lastUpdateWhere).toBeNull();
  };

  describe('stop guard (canReviveBlockedPrRetry) before every work-preserving branch', () => {
    test('1: verify_done + open PR、テーマ停止/取消 → blocked のままマージ待ちに戻さない', async () => {
      canReviveOk = false;
      expectLeftBlocked(await run('verify_done', { hasPr: true, prState: 'open' }));
      expect(String(cycleEvents[0].fields.msg)).toContain('left_blocked_stop_guard');
    });

    test('3: verify_done + PR merged、テーマ停止/取消 → 完了にしない', async () => {
      canReviveOk = false;
      expectLeftBlocked(await run('verify_done', { hasPr: true, prState: 'merged' }));
    });

    test.each(['plan_created', 'plan_approved', 'in_progress'])(
      '2: %s + worktree、テーマ停止/取消 → 段階を戻さない',
      async (stage) => {
        canReviveOk = false;
        expectLeftBlocked(await run(stage, { dirExists: true }));
      },
    );

    test('4: 停止ガードが false（読取失敗の fail closed を含む）なら 1 回だけ確認して blocked のまま', async () => {
      canReviveOk = false;
      expectLeftBlocked(await run('in_progress', { dirExists: true }));
      expect(canReviveCalls).toBe(1);
    });
  });

  describe('blocked cause allow-list', () => {
    test.each([
      'verify_no_convergence',
      'verify_pr_not_created',
      'verification_unverifiable_hold',
      'auto_run_stop_revert',
      'auto_run_excluded',
      'merge_exhausted_operator_handoff',
      'plan_invalid_replan_exhausted',
      'security_hold',
      'adversarial_review_failed',
      'some_future_unknown_cause',
    ])('5-7: 不許可・未知の cause %s は blocked のまま', async (cause) => {
      for (const [stage, facts] of [
        ['in_progress', { dirExists: true }],
        ['verify_done', { hasPr: true, prState: 'open' }],
        ['verify_done', { hasPr: true, prState: 'merged' }],
      ] as const) {
        transitions = [];
        lastUpdateWhere = null;
        expectLeftBlocked(await run(stage, { ...facts, blockedCause: cause }));
      }
    });

    test('8: blocked に入った遷移の cause を読めない（null）なら blocked のまま', async () => {
      expectLeftBlocked(await run('in_progress', { dirExists: true, blockedCause: null }));
    });

    test('9: 許可 cause は定数を全件回して、段階維持・マージ待ち・完了が通る', async () => {
      expect(RESUMABLE_BLOCK_CAUSES.length).toBeGreaterThanOrEqual(2);
      for (const cause of RESUMABLE_BLOCK_CAUSES) {
        await run('in_progress', { dirExists: true, blockedCause: cause });
        expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'in_progress' });
        await run('verify_done', { hasPr: true, prState: 'open', blockedCause: cause });
        expect(taskRow).toEqual({ status: 'in-progress', workflowStatus: 'verify_done' });
        await run('verify_done', { hasPr: true, prState: 'merged', blockedCause: cause });
        expect(taskRow.status).toBe('done');
      }
    });

    test('確認済みの許可 cause を含み、運用者への引き渡し cause は含まない', () => {
      expect(RESUMABLE_BLOCK_CAUSES).toContain('auto_run_hang_backstop');
      expect(RESUMABLE_BLOCK_CAUSES).toContain('orphan_requeue_exhausted');
      expect(RESUMABLE_BLOCK_CAUSES).not.toContain('merge_exhausted_operator_handoff');
    });
  });

  describe('draft 復帰にも停止確認と cause 許可を適用する', () => {
    test.each(['draft', 'research_done', 'in_progress', 'verify_done'])(
      '作業なしの %s でも停止済みなら blocked を保つ',
      async (stage) => {
        canReviveOk = false;
        expectLeftBlocked(await run(stage));
        expect(canReviveCalls).toBe(1);
      },
    );
    test.each(['verify_no_convergence', 'security_hold', 'some_future_unknown_cause', null, ''])(
      'draft 復帰でも cause %s が不許可なら blocked を保つ',
      async (blockedCause) => {
        expectLeftBlocked(await run('research_done', { blockedCause }));
        expect(canReviveCalls).toBe(1);
      },
    );
    test('停止ガードを事実収集より先に確認する', async () => {
      const facts = mock(async () => {
        throw new Error('停止後は読み取らない');
      });
      taskRow = { status: 'blocked', workflowStatus: 'research_done' };
      expectLeftBlocked(
        await resetBlockedTaskForRetry(
          db,
          { id: 1563, themeId: 7, workflowStatus: 'research_done' },
          1,
          { facts, canRevive: async () => false },
        ),
      );
      expect(facts).not.toHaveBeenCalled();
    });
    test('許可 cause の調査段階は停止確認後に draft へ戻る', async () => {
      await run('research_done');
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'draft' });
      expect(canReviveCalls).toBe(1);
    });
  });
});
