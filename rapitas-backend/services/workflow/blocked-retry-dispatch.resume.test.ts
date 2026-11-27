/**
 * blocked-retry-dispatch.resume.test
 *
 * Proves resetBlockedTaskForRetry resumes a blocked task from the stage it blocked in
 * (task 1563): the five table cases, metadata, CAS / operator-exclusion races, and the
 * merge-wait write the auto-merge watcher picks up. ensureRetryDispatch itself is in
 * blocked-retry-dispatch.test.ts.
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

type ThemeRow = { status: string; enabled: boolean; currentTaskId: number | null; order: string };
let themeRows: Record<number, ThemeRow | null> = {};

// One in-memory task row and transition log shared by every test.
type TaskRow = { status: string; workflowStatus: string | null };
let taskRow: TaskRow = { status: 'blocked', workflowStatus: null };
let blockedUpdateCount = 1;
let excluded = false;
/** Set when the operator excludes the task AFTER the fresh read (between read and write). */
let excludeAfterRead = false;
let lastUpdateWhere: Record<string, unknown> | null = null;
const cycleEvents: Array<{ evt: string; fields: Record<string, unknown> }> = [];
type Recorded = {
  fromStatus: string | null;
  toStatus: string;
  cause: string;
  metadata?: Record<string, unknown>;
};
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

/** A write whose where carries autoRunExcluded:false matches nothing once the task is excluded. */
function casMatches(where: Record<string, unknown> | undefined): boolean {
  if (blockedUpdateCount === 0) return false;
  if (where && where.autoRunExcluded === false && (excluded || excludeAfterRead)) return false;
  if (where && 'workflowStatus' in where && where.workflowStatus !== taskRow.workflowStatus) {
    return false;
  }
  return true;
}

const fakePrisma = {
  task: {
    findUnique: async () => {
      const row = { status: taskRow.status, autoRunExcluded: excluded };
      if (excludeAfterRead) excluded = true; // the operator acts right after this read
      return row;
    },
    update: async (args: { where?: Record<string, unknown>; data: Partial<TaskRow> }) => {
      lastUpdateWhere = args.where ?? null;
      // Prisma's update throws when the (CAS) where matches nothing.
      if (!casMatches(args.where)) throw new Error('no record');
      Object.assign(taskRow, { ...args.data, updatedAt: undefined });
      return taskRow;
    },
    updateMany: async (args: { where?: Record<string, unknown>; data: Partial<TaskRow> }) => {
      lastUpdateWhere = args.where ?? null;
      if (!casMatches(args.where)) return { count: 0 };
      Object.assign(taskRow, { ...args.data, updatedAt: undefined });
      return { count: 1 };
    },
  },
  workflowTransition: {
    findFirst: async () => ({ id: 1 }),
    update: async (args: { data: { metadata: string } }) => {
      const last = [...transitions].reverse().find((t) => t.cause === 'blocked_auto_retry');
      if (last) last.metadata = JSON.parse(args.data.metadata);
      return {};
    },
  },
  userSettings: { findFirst: () => Promise.resolve({ autoRunMaxConcurrency: 4 }) },
  themeAutoRun: {
    findFirst: (args: { where: { themeId: number } }) =>
      Promise.resolve(themeRows[args.where.themeId] ?? null),
    count: () => Promise.resolve(0),
  },
};

// Task 1568: the shared hold writes the task and the running queue item in one transaction.
Object.assign(fakePrisma, {
  $transaction: async (fn: (tx: unknown) => unknown): Promise<unknown> =>
    fn({ ...fakePrisma, workflowQueueItem: { updateMany: async () => ({ count: 0 }) } }),
});
mock.module('../../config/database', () => ({ prisma: fakePrisma }));

const { resetBlockedTaskForRetry } = await import('./blocked-retry-dispatch');

// biome-ignore lint: test double
const db = fakePrisma as never;

// Task 1563: a blocked auto-retry resumes from the stage it blocked in.
describe('resetBlockedTaskForRetry resume stage (task 1563)', () => {
  const noSelect = async () => {};
  let completes: number[] = [];
  let completeOk = true;

  type Facts = {
    stage?: string | null;
    stageSource?: 'blocked_transition' | 'history' | 'workflow_status' | 'unknown';
    dirExists?: boolean;
    hasPr?: boolean;
    prState?: string | null;
    unpushedCommits?: number | null;
    blockedCause?: string | null;
  };
  /** Run a retry for a row whose DB workflowStatus is `rowStatus` (the facts' stage defaults to it). */
  const run = (rowStatus: string | null, facts: Facts = {}, select: unknown = noSelect) => {
    taskRow = { status: 'blocked', workflowStatus: rowStatus };
    return resetBlockedTaskForRetry(db, { id: 1563, themeId: 7, workflowStatus: rowStatus }, 1, {
      select,
      facts: async () => ({
        stage: rowStatus,
        dirExists: false,
        hasPr: false,
        prState: null,
        unpushedCommits: null,
        blockedCause: 'auto_run_hang_backstop',
        ...facts,
      }),
      canRevive: async () => true,
      complete: async (id: number) => {
        completes.push(id);
        if (!completeOk) return false;
        taskRow = { status: 'done', workflowStatus: 'completed' };
        return true;
      },
    } as never);
  };
  const retryRow = () => transitions.find((t) => t.cause === 'blocked_auto_retry');

  beforeEach(() => {
    themeRows = {};
    transitions = [];
    completes = [];
    completeOk = true;
    blockedUpdateCount = 1;
    excluded = false;
    excludeAfterRead = false;
    cycleEvents.length = 0;
    lastUpdateWhere = null;
  });

  describe('the five table cases', () => {
    test('plan_approved + worktree → plan_approved から再開（draft にしない）', async () => {
      await run('plan_approved', { dirExists: true });
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'plan_approved' });
      expect(retryRow()?.toStatus).toBe('plan_approved');
      expect(retryRow()?.metadata).toMatchObject({
        resumeStage: 'plan_approved',
        resumeReason: 'stage_kept_with_work',
      });
    });

    test('in_progress + worktree → in_progress から再開', async () => {
      await run('in_progress', { dirExists: true });
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'in_progress' });
      expect(retryRow()?.toStatus).toBe('in_progress');
      expect(retryRow()?.metadata).toMatchObject({
        resumeStage: 'in_progress',
        resumeReason: 'stage_kept_with_work',
      });
    });

    test('verify_done + open PR → マージ待ち（in-progress + verify_done）に戻し、見張りの cause を記録', async () => {
      await run('verify_done', { hasPr: true, prState: 'open' });
      expect(taskRow).toEqual({ status: 'in-progress', workflowStatus: 'verify_done' });
      // 見張りは cause で絞って読む。hold と同じ形の遷移の後に blocked_auto_retry を記録する
      expect(transitions.map((t) => t.cause)).toEqual([
        'verify_awaiting_required_merge',
        'blocked_auto_retry',
      ]);
      expect(retryRow()?.metadata).toMatchObject({
        resumeStage: 'verify_done',
        resumeReason: 'merge_wait_open_pr',
      });
    });

    test('verify_done + PR が merged → 完了になる（draft にしない）', async () => {
      await run('verify_done', { hasPr: true, prState: 'merged' });
      expect(completes).toEqual([1563]);
      expect(taskRow.status).toBe('done');
      expect(retryRow()?.metadata).toMatchObject({
        resumeStage: 'completed',
        resumeReason: 'completed_merged_pr',
      });
    });

    test('research_done + 作業の中身なし → 今までどおり draft', async () => {
      await run('research_done', {});
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'draft' });
      expect(retryRow()?.toStatus).toBe('draft');
      expect(retryRow()?.metadata).toMatchObject({
        resumeStage: 'draft',
        resumeReason: 'draft_research_stage',
      });
    });
  });

  describe('draft only for an investigation stage or nothing to lose', () => {
    test('plan_created + worktree → plan_created を保つ（計画をやり直さない）', async () => {
      await run('plan_created', { dirExists: true });
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'plan_created' });
    });

    test('in_progress だが worktree も PR も無い → draft', async () => {
      await run('in_progress', {});
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'draft' });
      expect(retryRow()?.metadata).toMatchObject({ resumeReason: 'draft_no_work' });
    });

    test('verify_done + PR の記録なし + worktree あり → in_progress を保つ（draft にしない）', async () => {
      await run('verify_done', { dirExists: true });
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'in_progress' });
      expect(retryRow()?.metadata).toMatchObject({
        resumeStage: 'in_progress',
        resumeReason: 'stage_kept_verify_as_in_progress',
      });
    });

    test('verify_done + PR が closed + worktree あり → in_progress を保つ', async () => {
      await run('verify_done', { dirExists: true, hasPr: true, prState: 'closed' });
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'in_progress' });
    });

    test('verify_done + PR も worktree も無い → draft', async () => {
      await run('verify_done', {});
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'draft' });
      expect(retryRow()?.metadata).toMatchObject({ resumeReason: 'draft_pr_unconfirmed' });
    });
  });

  describe('leave (PR exists but state is closed / unknown, no worktree)', () => {
    test('blocked のまま何も書かず、サイクルログに理由を残す', async () => {
      const outcome = await run('verify_done', { hasPr: true, prState: 'closed' });
      expect(outcome).toBe('not_needed');
      expect(taskRow.status).toBe('blocked');
      expect(transitions).toHaveLength(0);
      expect(completes).toHaveLength(0);
      expect(cycleEvents).toHaveLength(1);
      expect(cycleEvents[0].evt).toBe('task.blocked');
      expect(cycleEvents[0].fields).toMatchObject({ task: 1563 });
      expect(String(cycleEvents[0].fields.msg)).toContain('left_blocked_pr_unconfirmed');
    });

    test('state 不明（hasPr のみ）でも同じ', async () => {
      const outcome = await run('verify_done', { hasPr: true, prState: null });
      expect(outcome).toBe('not_needed');
      expect(taskRow.status).toBe('blocked');
      expect(transitions).toHaveLength(0);
    });
  });

  describe('history-restored stage (task row workflowStatus is null)', () => {
    test('復元した段階を task 行へ保存する', async () => {
      await run(null, { stage: 'in_progress', dirExists: true });
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'in_progress' });
    });

    test('復元した verify_done でもマージ待ちの CAS は実 DB の値（null）に対して成立する', async () => {
      await run(null, { stage: 'verify_done', hasPr: true, prState: 'open' });
      expect(taskRow).toEqual({ status: 'in-progress', workflowStatus: 'verify_done' });
      expect(transitions.map((t) => t.cause)).toContain('verify_awaiting_required_merge');
    });
  });
});
