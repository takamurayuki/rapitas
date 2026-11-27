/**
 * verification-job-store.test
 *
 * Unit tests for the TimelineEvent-backed job store: running/completed/
 * failed/interrupted (processInstanceId mismatch and stale-timeout) status
 * derivation, missing runId, and latest-job selection across multiple runs.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

interface StoredEvent {
  id: number;
  eventType: string;
  actorType?: string;
  correlationId?: string;
  payload: unknown;
  createdAt: Date;
}

let store: StoredEvent[] = [];
let nextId = 1;

const appendEventMock = mock(
  async (event: {
    eventType: string;
    actorType?: string;
    correlationId?: string;
    payload?: Record<string, unknown>;
  }) => {
    const created: StoredEvent = {
      id: nextId++,
      eventType: event.eventType,
      actorType: event.actorType,
      correlationId: event.correlationId,
      payload: event.payload ?? {},
      createdAt: new Date(),
    };
    store.push(created);
    return { id: created.id };
  },
);

const queryEventsMock = mock(async (options: { correlationId?: string; limit?: number }) => {
  const filtered = store
    .filter((e) => !options.correlationId || e.correlationId === options.correlationId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, options.limit ?? 50);
  return { events: filtered, total: filtered.length, limit: options.limit ?? 50, offset: 0 };
});

mock.module('../memory/timeline', () => ({
  appendEvent: appendEventMock,
  queryEvents: queryEventsMock,
}));

const {
  recordJobStart,
  recordJobFinish,
  getJobByRunId,
  getLatestJob,
  PROCESS_INSTANCE_ID,
  STALE_RUNNING_MS,
} = await import('./verification-job-store');

beforeEach(() => {
  store = [];
  nextId = 1;
  appendEventMock.mockClear();
  queryEventsMock.mockClear();
});

/** Push a raw start-event row, bypassing recordJobStart, to control fields the real function always fixes (processInstanceId, startedAt). */
function pushRawStart(
  taskId: number,
  runId: string,
  overrides: Partial<{ processInstanceId: string; startedAtMs: number }> = {},
) {
  store.push({
    id: nextId++,
    eventType: 'verification_job_started',
    correlationId: `verify-job-${taskId}`,
    payload: {
      runId,
      taskId,
      fingerprint: 'fp',
      processInstanceId: overrides.processInstanceId ?? PROCESS_INSTANCE_ID,
      executionCodeVersion: overrides.processInstanceId ?? PROCESS_INSTANCE_ID,
      startedAt: new Date(overrides.startedAtMs ?? Date.now()).toISOString(),
    },
    createdAt: new Date(overrides.startedAtMs ?? Date.now()),
  });
}

describe('getJobByRunId', () => {
  it('running: 開始イベントのみ・同一プロセス・stale未満', async () => {
    await recordJobStart(1, 'run-1', 'fp-1', {
      operation: 'POST /workflow/tasks/1/run-verification',
      worktreePath: '/tmp/worktree-1',
      revision: 'abc123',
    });
    const record = await getJobByRunId(1, 'run-1');
    expect(record).toMatchObject({ status: 'running', runId: 'run-1', taskId: 1 });
    expect(record?.startedAt).toBeTruthy();
  });

  it('interrupted: processInstanceId が現在のプロセスと不一致', async () => {
    pushRawStart(2, 'run-2', { processInstanceId: 'other-process-id' });
    const record = await getJobByRunId(2, 'run-2');
    expect(record).toMatchObject({ status: 'interrupted', runId: 'run-2' });
  });

  it('interrupted: 同一プロセスでも STALE_RUNNING_MS を超過', async () => {
    pushRawStart(3, 'run-3', { startedAtMs: Date.now() - STALE_RUNNING_MS - 1_000 });
    const record = await getJobByRunId(3, 'run-3');
    expect(record).toMatchObject({ status: 'interrupted', runId: 'run-3' });
  });

  it('completed: 開始＋完了イベントで checks/ok/unverifiable を含めて返す', async () => {
    await recordJobStart(4, 'run-4', 'fp-4', {
      operation: 'POST /workflow/tasks/4/run-verification',
      worktreePath: '/tmp/worktree-4',
      revision: 'def456',
    });
    await recordJobFinish(4, 'run-4', {
      status: 'completed',
      ok: true,
      unverifiable: false,
      checks: [{ name: 'lint', ran: true, ok: true, errorCount: 0, details: 'no issues' }],
      summary: 'all green',
      commands: [],
    });
    const record = await getJobByRunId(4, 'run-4');
    expect(record).toMatchObject({
      status: 'completed',
      ok: true,
      unverifiable: false,
      summary: 'all green',
      commands: [],
    });
    expect(record?.checks).toHaveLength(1);
    expect(record?.finishedAt).toBeTruthy();
  });

  it('completed: テスト検査の passedCount（0 を含む）が保存・読み出しで落ちない（task 1542）', async () => {
    for (const [taskId, runId, passedCount] of [
      [41, 'run-41', 42],
      [42, 'run-42', 0],
    ] as const) {
      await recordJobStart(taskId, runId, 'fp', {
        operation: `POST /workflow/tasks/${taskId}/run-verification`,
        worktreePath: '/tmp/worktree',
        revision: 'h',
      });
      await recordJobFinish(taskId, runId, {
        status: 'completed',
        ok: true,
        checks: [
          { name: 'test', ran: true, ok: true, errorCount: 0, passedCount, details: 'passed' },
        ],
      });
      const record = await getJobByRunId(taskId, runId);
      expect(record?.checks?.[0]).toMatchObject({ name: 'test', passedCount });
    }
  });

  it('別 runId の終了が先に保存されても、各 runId は自分の実測だけを返す（task 1542 の割り込み順序）', async () => {
    const context = { operation: 'POST', worktreePath: '/tmp/w', revision: 'rev-a' };
    await recordJobStart(50, 'run-a', 'fp', context);
    await recordJobStart(50, 'run-b', 'fp', { ...context, revision: 'rev-b' });
    // run-b finishes FIRST, with a different measurement.
    await recordJobFinish(50, 'run-b', {
      status: 'completed',
      ok: true,
      checks: [{ name: 'test', ran: true, ok: true, errorCount: 0, passedCount: 9, details: '' }],
    });
    const aWhileRunning = await getJobByRunId(50, 'run-a');
    expect(aWhileRunning).toMatchObject({ runId: 'run-a', status: 'running', revision: 'rev-a' });
    expect(aWhileRunning?.checks).toBeUndefined();
    await recordJobFinish(50, 'run-a', {
      status: 'completed',
      ok: false,
      checks: [{ name: 'test', ran: true, ok: false, errorCount: 2, passedCount: 3, details: '' }],
    });
    expect((await getJobByRunId(50, 'run-a'))?.checks?.[0]).toMatchObject({
      errorCount: 2,
      passedCount: 3,
    });
    expect(await getJobByRunId(50, 'run-b')).toMatchObject({ ok: true, revision: 'rev-b' });
    expect((await getJobByRunId(50, 'run-b'))?.checks?.[0]).toMatchObject({ passedCount: 9 });
  });

  it('completed: 差分レビューの判定を保存して読み出す', async () => {
    await recordJobStart(40, 'run-40', 'fp', {
      operation: 'POST /workflow/tasks/40/run-verification',
      worktreePath: '/tmp/worktree-40',
      revision: 'h',
    });
    const diffReview = {
      status: 'reviewed' as const,
      verdict: 'pass' as const,
      severity: 0,
      reasons: [],
      diffFingerprint: 'fp-40',
      headSha: 'h',
      criteriaRevision: 'c',
    };
    await recordJobFinish(40, 'run-40', { status: 'completed', ok: true, diffReview });
    expect((await getJobByRunId(40, 'run-40'))?.diffReview).toEqual(diffReview);
  });

  it('failed: 開始＋失敗イベントで error を含めて返す', async () => {
    await recordJobStart(5, 'run-5', 'fp-5', {
      operation: 'POST /workflow/tasks/5/run-verification',
      worktreePath: '/tmp/worktree-5',
      revision: null,
    });
    await recordJobFinish(5, 'run-5', {
      status: 'failed',
      error: 'gate threw',
      commands: [
        {
          command: 'bun test',
          cwd: '/tmp/worktree-9',
          exitCode: 23,
          signal: null,
          status: 'exited',
        },
      ],
    });
    const record = await getJobByRunId(5, 'run-5');
    expect(record).toMatchObject({
      status: 'failed',
      error: 'gate threw',
      commands: [
        {
          command: 'bun test',
          cwd: '/tmp/worktree-9',
          exitCode: 23,
          signal: null,
          status: 'exited',
        },
      ],
    });
  });

  it('構造化ログ: command/worktreePath/revision が開始・完了両方の派生結果に含まれる（受入条件6）', async () => {
    await recordJobStart(9, 'run-9', 'fp-9', {
      operation: 'POST /workflow/tasks/9/run-verification',
      worktreePath: '/tmp/worktree-9',
      revision: 'rev-9',
    });
    const running = await getJobByRunId(9, 'run-9');
    expect(running).toMatchObject({
      operation: 'POST /workflow/tasks/9/run-verification',
      worktreePath: '/tmp/worktree-9',
      revision: 'rev-9',
    });
    await recordJobFinish(9, 'run-9', {
      status: 'completed',
      ok: false,
      commands: [
        {
          command: 'bun test',
          cwd: '/tmp/worktree-9',
          exitCode: 23,
          signal: null,
          status: 'exited',
        },
      ],
    });
    const finished = await getJobByRunId(9, 'run-9');
    expect(finished).toMatchObject({
      operation: 'POST /workflow/tasks/9/run-verification',
      worktreePath: '/tmp/worktree-9',
      revision: 'rev-9',
      commands: [
        {
          command: 'bun test',
          cwd: '/tmp/worktree-9',
          exitCode: 23,
          signal: null,
          status: 'exited',
        },
      ],
      ok: false,
    });
  });

  it('存在しない runId は null を返す', async () => {
    await recordJobStart(6, 'run-6', 'fp-6', {
      operation: 'POST /workflow/tasks/6/run-verification',
      worktreePath: '/tmp/worktree-6',
      revision: null,
    });
    const record = await getJobByRunId(6, 'run-does-not-exist');
    expect(record).toBeNull();
  });
});

describe('getLatestJob', () => {
  it('複数ジョブの中から最新の runId を選ぶ', async () => {
    pushRawStart(7, 'run-old', { startedAtMs: Date.now() - 10_000 });
    pushRawStart(7, 'run-new', { startedAtMs: Date.now() });
    const record = await getLatestJob(7);
    expect(record?.runId).toBe('run-new');
  });

  it('ジョブが無いタスクは null を返す', async () => {
    const record = await getLatestJob(999);
    expect(record).toBeNull();
  });

  it('他タスクのジョブを誤って返さない（correlationId のタスクID部分の分離確認）', async () => {
    pushRawStart(8, 'run-task8', { startedAtMs: Date.now() });
    pushRawStart(18, 'run-task18', { startedAtMs: Date.now() + 5_000 });
    const record = await getLatestJob(8);
    expect(record?.runId).toBe('run-task8');
  });
});
