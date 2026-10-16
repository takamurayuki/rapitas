/**
 * resume-condition ハンドラのテスト
 *
 * 承認 API: ヘッダー無しは 403、不正回答は 422、プレビューは書き込み 0 回、
 * 同一停止の再承認は冪等、再発時は過去の回答を提案（承認自体は必須）。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
interface Row {
  id: number;
  taskId: number;
  cause: string;
  createdAt: Date;
  metadata: string | null;
}
let rows: Row[] = [];
let nextId = 1;
const NOW = 1_800_000_000_000;

const fakeDb = {
  task: {
    findUnique: mock(() =>
      Promise.resolve({
        id: 5,
        status: 'blocked',
        workflowStatus: 'draft',
        workingDirectory: null,
        theme: null,
      }),
    ),
  },
  workflowTransition: {
    findFirst: mock((args: unknown) => {
      const { where } = args as { where: { cause?: string | { notIn: string[] } } };
      const hit = [...rows]
        .reverse()
        .find((r) =>
          typeof where.cause === 'string'
            ? r.cause === where.cause
            : !where.cause?.notIn.includes(r.cause),
        );
      return Promise.resolve(hit ?? null);
    }),
    findMany: mock((args: unknown) => {
      const { where } = args as { where: { cause: { in: string[] } } };
      return Promise.resolve(rows.filter((r) => where.cause.in.includes(r.cause)));
    }),
    create: mock((args: unknown) => {
      const { data } = args as { data: Omit<Row, 'id' | 'createdAt'> };
      rows.push({ ...data, id: nextId++, createdAt: new Date(NOW) });
      return Promise.resolve({});
    }),
  },
};
mock.module('../../config/database', () => ({ prisma: fakeDb }));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { handleGetResumeQuestion, handlePreviewResumeCondition, handleApproveResumeCondition } =
  await import('../../routes/workflow/resume-condition-handlers');

const deps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HACK(agent): structural fake of the Prisma client
  db: fakeDb as any,
  now: () => NOW,
  fileExists: (p: string) => p === 'src/fixed.ts',
};
const QID = 'rq-5-retry_cap_exhausted-1';

function ctx(body?: unknown, headers?: Record<string, string>) {
  return {
    params: { taskId: '5' },
    body,
    headers,
    set: { status: 200 as number | string | undefined },
  };
}

beforeEach(() => {
  nextId = 1;
  rows = [
    {
      id: nextId++,
      taskId: 5,
      cause: 'blocked_escalated',
      createdAt: new Date(NOW - 1000),
      metadata: JSON.stringify({ reason: 'retry_cap_exhausted' }),
    },
  ];
  fakeDb.workflowTransition.create.mockClear();
});

describe('GET resume-question', () => {
  test('解除可能な理由では質問を1問返し、履歴がなければ提案なし', async () => {
    const r = await handleGetResumeQuestion(ctx(), deps);
    expect(r).toMatchObject({ state: 'question', questionId: QID, suggestion: null });
  });
  test('解除不可の理由は not_resumable（質問なし）', async () => {
    rows[0].metadata = JSON.stringify({ reason: 'awaiting_question' });
    expect(await handleGetResumeQuestion(ctx(), deps)).toMatchObject({ state: 'not_resumable' });
  });
});

describe('POST preview / approve', () => {
  const answer = { questionId: QID, answer: true };

  test('プレビューは条件を返すが DB へ書き込まない', async () => {
    const r = await handlePreviewResumeCondition(ctx(answer), deps);
    expect(r).toMatchObject({ success: true, preview: { questionId: QID } });
    expect(fakeDb.workflowTransition.create).not.toHaveBeenCalled();
  });

  test('X-Rapitas-Source が無ければ 403 で何も書かない', async () => {
    const c = ctx(answer);
    const r = await handleApproveResumeCondition(c, deps);
    expect(c.set.status).toBe(403);
    expect(r.success).toBe(false);
    expect(fakeDb.workflowTransition.create).not.toHaveBeenCalled();
  });

  test('不正な回答は 422、古い質問IDは 409', async () => {
    const bad = ctx({ questionId: QID, answer: 'はい' }, { 'x-rapitas-source': 'ui' });
    await handleApproveResumeCondition(bad, deps);
    expect(bad.set.status).toBe(422);
    const stale = ctx(
      { questionId: 'rq-5-retry_cap_exhausted-99', answer: true },
      { 'x-rapitas-source': 'ui' },
    );
    await handleApproveResumeCondition(stale, deps);
    expect(stale.set.status).toBe(409);
    expect(fakeDb.workflowTransition.create).not.toHaveBeenCalled();
  });

  test('承認は24時間の期限と質問IDを保存し、同一停止への再承認は冪等', async () => {
    const h = { 'x-rapitas-source': 'ui' };
    const first = await handleApproveResumeCondition(ctx(answer, h), deps);
    expect(first).toMatchObject({ success: true, condition: { questionId: QID } });
    const stored = JSON.parse(rows.at(-1)?.metadata ?? '{}');
    expect(stored.expiresAt - stored.approvedAt).toBe(24 * 60 * 60_000);

    await handleApproveResumeCondition(ctx(answer, h), deps);
    expect(fakeDb.workflowTransition.create).toHaveBeenCalledTimes(1);
    expect(await handleGetResumeQuestion(ctx(), deps)).toMatchObject({ state: 'active' });
  });

  test('同一理由が再発すると過去の回答を提案するが、承認操作は依然必須', async () => {
    const h = { 'x-rapitas-source': 'operator' };
    await handleApproveResumeCondition(ctx(answer, h), deps);
    // 新しい停止: 新しい escalation 行 → 新しい質問ID。タスクは再び blocked。
    rows.push({
      id: nextId++,
      taskId: 5,
      cause: 'blocked_escalated',
      createdAt: new Date(NOW + 1),
      metadata: JSON.stringify({ reason: 'retry_cap_exhausted' }),
    });
    const r = await handleGetResumeQuestion(ctx(), deps);
    expect(r).toMatchObject({
      state: 'question',
      suggestion: { kind: 'boolean', value: true },
    });
    // 提案が出ただけでは条件は有効にならない（active ではなく question）
    expect((r as { state: string }).state).toBe('question');
  });
});
