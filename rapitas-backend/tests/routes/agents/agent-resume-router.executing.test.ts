/**
 * agent-resume-router /tasks/executing テスト
 *
 * 実行中タスク一覧のレスポンス形（既存フィールド不変 + 累積実働 activeTimeMs
 * の付与）と、完了実行の合算がタスク単位で正しいことを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockExecFindMany = mock(() => Promise.resolve([] as unknown[]));
const mockTaskFindMany = mock(() => Promise.resolve([] as unknown[]));

const mockPrisma = {
  agentExecution: {
    findMany: mockExecFindMany,
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
  },
  task: {
    findMany: mockTaskFindMany,
  },
};

mock.module('../../../config', () => ({
  prisma: mockPrisma,
  getProjectRoot: () => 'C:/tmp',
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../../../services/agents/orchestrator/resume-completion', () => ({
  handleResumeCompletion: mock(async () => {}),
}));

const { agentResumeRouter } =
  await import('../../../routes/agents/execution-management/agent-resume-router');

const T0 = new Date('2026-08-12T00:00:00.000Z').getTime();

/** 実行中行フィクスチャ（/tasks/executing の1段目 findMany 用）。 */
function executingRow(executionId: number, taskId: number, sessionId: number, startMin: number) {
  return {
    id: executionId,
    status: 'running',
    startedAt: new Date(T0 + startMin * 60_000),
    session: {
      id: sessionId,
      createdAt: new Date(T0 + startMin * 60_000),
      config: { taskId },
    },
  };
}

/** 完了行フィクスチャ（累積実働の2段目 findMany 用）。 */
function finishedRow(taskId: number, startMin: number, endMin: number) {
  return {
    startedAt: new Date(T0 + startMin * 60_000),
    completedAt: new Date(T0 + endMin * 60_000),
    session: { config: { taskId } },
  };
}

describe('GET /tasks/executing', () => {
  let app: Elysia;

  beforeEach(() => {
    mockExecFindMany.mockReset();
    mockTaskFindMany.mockReset();
    mockTaskFindMany.mockResolvedValue([]);
    app = new Elysia().use(agentResumeRouter);
  });

  test('実行中タスクに完了分の累積実働 activeTimeMs を付与すること', async () => {
    // 1回目: 実行中行 / 2回目: 完了行（フェーズ2回分）
    mockExecFindMany
      .mockResolvedValueOnce([executingRow(10, 560, 5, 50)])
      .mockResolvedValueOnce([finishedRow(560, 0, 10), finishedRow(560, 12, 42)]);
    mockTaskFindMany.mockResolvedValue([{ id: 560, parentId: null }]);

    const res = await app.handle(new Request('http://localhost/tasks/executing'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    // 既存フィールド不変（後方互換）
    expect(body[0].executionId).toBe(10);
    expect(body[0].taskId).toBe(560);
    expect(body[0].sessionId).toBe(5);
    expect(body[0].executionStatus).toBe('running');
    // 追加: 完了2実行 (10分 + 30分) の合計
    expect(body[0].activeTimeMs).toBe(40 * 60_000);
  });

  test('完了実行が無いタスクの activeTimeMs は 0 になること', async () => {
    mockExecFindMany.mockResolvedValueOnce([executingRow(11, 700, 6, 0)]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValue([{ id: 700, parentId: null }]);

    const res = await app.handle(new Request('http://localhost/tasks/executing'));
    const body = await res.json();

    expect(body[0].activeTimeMs).toBe(0);
  });

  test('複数タスク実行中でも合算はタスク単位に分離されること', async () => {
    mockExecFindMany
      .mockResolvedValueOnce([executingRow(12, 1, 7, 60), executingRow(13, 2, 8, 61)])
      .mockResolvedValueOnce([finishedRow(1, 0, 10), finishedRow(2, 0, 5), finishedRow(2, 6, 9)]);
    mockTaskFindMany.mockResolvedValue([
      { id: 1, parentId: null },
      { id: 2, parentId: null },
    ]);

    const res = await app.handle(new Request('http://localhost/tasks/executing'));
    const body = await res.json();

    const byTask = new Map(
      (body as Array<{ taskId: number; activeTimeMs: number }>).map((r) => [r.taskId, r]),
    );
    expect(byTask.get(1)?.activeTimeMs).toBe(10 * 60_000);
    expect(byTask.get(2)?.activeTimeMs).toBe(8 * 60_000);
  });

  test('実行中タスクが無ければ空配列を返し、追加クエリを発行しないこと', async () => {
    mockExecFindMany.mockResolvedValueOnce([]);

    const res = await app.handle(new Request('http://localhost/tasks/executing'));
    const body = await res.json();

    expect(body).toEqual([]);
    // 実行行の findMany 1回のみ（完了行の合算クエリはスキップ）
    expect(mockExecFindMany).toHaveBeenCalledTimes(1);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
  });
});
