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
    // NOTE: selectExecutingRows は heartbeatAt を実時刻(new Date())基準の
    // 鮮度窓(EXECUTING_DISPLAY_STALE_MS=5分)で判定する(executing-tasks-filter.ts:39,45)。
    // T0はテスト用の固定過去時刻のため、heartbeatAtだけは実時刻にする必要がある。
    heartbeatAt: new Date(),
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

  // 契約（nav80）: 入力待ち行には質問文 question を載せる。モバイルの承認ページが
  // タスクごとに execution-status を叩かずに質問カードを出すため。
  test('入力待ちの行は質問文 question を返すこと', async () => {
    mockExecFindMany
      .mockResolvedValueOnce([
        {
          ...executingRow(20, 801, 9, 0),
          status: 'waiting_for_input',
          heartbeatAt: null,
          question: 'どちらのブランチに入れますか？',
          session: { id: 9, status: 'running', createdAt: new Date(T0), config: { taskId: 801 } },
        },
      ])
      .mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValue([{ id: 801, parentId: null }]);

    const res = await app.handle(new Request('http://localhost/tasks/executing'));
    const body = await res.json();

    expect(body[0].executionStatus).toBe('waiting_for_input');
    expect(body[0].question).toBe('どちらのブランチに入れますか？');
    // 1段目の select が question を読むこと（読まなければ実 DB では常に null になる）
    const firstCall = mockExecFindMany.mock.calls[0] as unknown as [
      { select: Record<string, unknown> },
    ];
    expect(firstCall[0].select.question).toBe(true);
  });

  test('質問文の無い入力待ちは question が null になること（キーは必ずある）', async () => {
    mockExecFindMany
      .mockResolvedValueOnce([
        {
          ...executingRow(21, 802, 10, 0),
          status: 'waiting_for_input',
          heartbeatAt: null,
          question: null,
          session: { id: 10, status: 'running', createdAt: new Date(T0), config: { taskId: 802 } },
        },
      ])
      .mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValue([{ id: 802, parentId: null }]);

    const res = await app.handle(new Request('http://localhost/tasks/executing'));
    const body = await res.json();

    expect(Object.prototype.hasOwnProperty.call(body[0], 'question')).toBe(true);
    expect(body[0].question).toBeNull();
  });

  test('running の行は古い質問文が残っていても question を null で返すこと', async () => {
    mockExecFindMany
      .mockResolvedValueOnce([{ ...executingRow(22, 803, 11, 0), question: '前の質問' }])
      .mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValue([{ id: 803, parentId: null }]);

    const res = await app.handle(new Request('http://localhost/tasks/executing'));
    const body = await res.json();

    expect(body[0].executionStatus).toBe('running');
    expect(body[0].question).toBeNull();
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
