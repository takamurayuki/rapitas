/**
 * blocked-retry-dispatch.races.test
 *
 * Proves resetBlockedTaskForRetry loses cleanly to a competing writer (task 1563): a CAS
 * that matches nothing, or an operator exclusion after the fresh read, writes and records
 * nothing. The stage decisions themselves are in blocked-retry-dispatch.resume.test.ts.
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

mock.module('../../config/database', () => ({ prisma: fakePrisma }));

const { resetBlockedTaskForRetry } = await import('./blocked-retry-dispatch');

// biome-ignore lint: test double
const db = fakePrisma as never;

// Task 1563: state read → write races of the blocked auto-retry.
describe('resetBlockedTaskForRetry races (task 1563)', () => {
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

  describe('races (state read → write)', () => {
    test('段階維持の CAS 負け（0件）は何も記録しない', async () => {
      blockedUpdateCount = 0;
      const outcome = await run('in_progress', { dirExists: true });
      expect(outcome).toBe('not_needed');
      expect(transitions).toHaveLength(0);
    });

    test('draft への書き込みが CAS 負けなら記録しない', async () => {
      blockedUpdateCount = 0;
      const outcome = await run('research_done', {});
      expect(outcome).toBe('not_needed');
      expect(transitions).toHaveLength(0);
    });

    test('マージ待ちの CAS 負けなら遷移を記録しない', async () => {
      blockedUpdateCount = 0;
      const outcome = await run('verify_done', { hasPr: true, prState: 'open' });
      expect(outcome).toBe('not_needed');
      expect(taskRow.status).toBe('blocked');
      expect(transitions).toHaveLength(0);
    });

    test('完了の書き込みが負けたら（complete=false）遷移を記録せず not_needed', async () => {
      completeOk = false;
      const outcome = await run('verify_done', { hasPr: true, prState: 'merged' });
      expect(outcome).toBe('not_needed');
      expect(completes).toEqual([1563]);
      expect(taskRow.status).toBe('blocked');
      expect(transitions).toHaveLength(0);
    });

    test('対象外に設定済み（再読取時点）なら何も書かない', async () => {
      excluded = true;
      for (const [stage, facts] of [
        ['in_progress', { dirExists: true }],
        ['research_done', {}],
        ['verify_done', { hasPr: true, prState: 'open' }],
      ] as const) {
        transitions = [];
        const outcome = await run(stage, facts);
        expect(outcome).toBe('not_needed');
        expect(taskRow.status).toBe('blocked');
        expect(transitions).toHaveLength(0);
      }
    });

    test.each([
      ['in_progress', { dirExists: true }],
      ['research_done', {}],
      ['verify_done', { hasPr: true, prState: 'open' }],
    ] as const)(
      '再読取の直後にオペレーターが対象外にしても %s の書き込みは通らない（CAS に除外条件）',
      async (stage, facts) => {
        excludeAfterRead = true;
        const outcome = await run(stage, facts);
        expect(outcome).toBe('not_needed');
        expect(taskRow.status).toBe('blocked');
        expect(transitions).toHaveLength(0);
      },
    );

    test('書き込みの CAS 条件に status=blocked と autoRunExcluded=false を含める', async () => {
      await run('in_progress', { dirExists: true });
      expect(lastUpdateWhere).toMatchObject({ status: 'blocked', autoRunExcluded: false });
      lastUpdateWhere = null;
      await run('research_done', {});
      expect(lastUpdateWhere).toMatchObject({ status: 'blocked', autoRunExcluded: false });
      lastUpdateWhere = null;
      await run('verify_done', { hasPr: true, prState: 'open' });
      // The shared hold's CAS: status in ['blocked'] plus the exclusion condition.
      expect(lastUpdateWhere).toMatchObject({
        status: { in: ['blocked'] },
        autoRunExcluded: false,
        workflowStatus: 'verify_done',
      });
    });

    test('stageSource が metadata に残る', async () => {
      await run('in_progress', { dirExists: true, stageSource: 'blocked_transition' });
      expect(retryRow()?.metadata).toMatchObject({ stageSource: 'blocked_transition' });
    });

    test('段階が決められず作業が残る（stage=null）なら blocked のまま何も書かない', async () => {
      const outcome = await run('in_progress', { stage: null, dirExists: true });
      expect(outcome).toBe('not_needed');
      expect(taskRow.status).toBe('blocked');
      expect(transitions).toHaveLength(0);
      expect(String(cycleEvents[0]?.fields.msg)).toContain('left_blocked_stage_unknown');
    });
  });

  describe('metadata and cycle log', () => {
    test('未プッシュコミット件数が metadata に残る（worktree は触らない）', async () => {
      await run('in_progress', { dirExists: true, unpushedCommits: 3 });
      expect(retryRow()?.metadata).toMatchObject({ unpushedCommits: 3 });
    });

    test('サイクルログに再開した段階と理由を残す', async () => {
      await run('in_progress', { dirExists: true });
      expect(cycleEvents).toHaveLength(1);
      expect(cycleEvents[0].evt).toBe('task.revived');
      expect(cycleEvents[0].fields).toMatchObject({
        task: 1563,
        to: 'in_progress',
        cause: 'blocked_auto_retry',
      });
      expect(String(cycleEvents[0].fields.msg)).toContain('stage_kept_with_work');
    });

    test('再投入が失敗しても段階維持の todo は残り、metadata に dispatch=error が入る', async () => {
      themeRows[7] = { status: 'running', enabled: true, currentTaskId: null, order: 'priority' };
      const outcome = await run('in_progress', { dirExists: true }, async () => {
        throw new Error('boom');
      });
      expect(outcome).toBe('error');
      expect(taskRow).toEqual({ status: 'todo', workflowStatus: 'in_progress' });
      expect(retryRow()?.metadata).toMatchObject({ dispatch: 'error' });
    });
  });
});
