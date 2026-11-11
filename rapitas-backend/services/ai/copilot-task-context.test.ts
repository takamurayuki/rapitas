/**
 * copilot-task-context tests (companion design stage 1, item 3 / acceptance 3)
 *
 * "完了条件は？" and "今どこ？" must be answered from the DB. These check the
 * assembled input: the task's acceptance criteria, workflow status, halt
 * reason and its five most recent transitions reach the message the model is
 * sent — taken from the rows, not from the conversation.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

type TransitionArgs = { where: { taskId: number }; take: number; orderBy: unknown };

let taskRow: Record<string, unknown> | null = null;
let transitionRows: Array<Record<string, unknown>> = [];
let transitionArgs: TransitionArgs[] = [];
let transitionsFail = false;

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: { findUnique: async () => taskRow },
    workflowTransition: {
      findMany: async (args: TransitionArgs) => {
        transitionArgs.push(args);
        if (transitionsFail) throw new Error('no table');
        return transitionRows.slice(0, args.take);
      },
    },
    copilotMessage: { create: async () => ({}), findMany: async () => [] },
  },
}));

const sent: Array<{ messages: Array<{ role: string; content: string }> }> = [];
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async (args: { messages: Array<{ role: string; content: string }> }) => {
    sent.push(args);
    return { content: 'answer', tokensUsed: 1 };
  },
  sendAIMessageStream: async () => new ReadableStream(),
}));
mock.module('../local-llm/response-cache', () => ({
  getCachedResponse: () => null,
  setCachedResponse: () => {},
  generateCacheKey: () => 'k',
}));
// All four runtime exports mirrored: mock.module replaces the whole module.
mock.module('../agents/agent-knowledge-sharing', () => ({
  gatherSharedKnowledge: () => Promise.resolve({}),
  formatKnowledgeContext: () => '',
  extractMethodFromVerify: () => [],
  updatePatternsFromExecution: () => Promise.resolve(),
}));

const { buildTaskContext, CONTEXT_TRANSITIONS } = await import('./copilot-task-context');
const { sendCopilotMessage } = await import('./copilot-chat-service');

const CRITERIA = [
  'ログイン画面で正しいパスワードなら入れる',
  '誤ったパスワードでは入れず理由が出る',
];

function transition(i: number) {
  return {
    fromStatus: i === 0 ? null : `s${i - 1}`,
    toStatus: `s${i}`,
    actor: 'system',
    cause: `cause_${i}`,
    createdAt: new Date(Date.UTC(2026, 10, 11, 10, 60 - i)),
  };
}

beforeEach(() => {
  taskRow = {
    title: 'ログインを直す',
    status: 'in-progress',
    priority: 'high',
    description: '説明',
    acceptanceCriteria: JSON.stringify(CRITERIA),
    workflowStatus: 'plan_created',
    haltReason: 'budget_time_exceeded',
    haltedAt: new Date('2026-11-11T09:00:00.000Z'),
    theme: { name: 'rapitas', workingDirectory: null },
    comments: [],
    subtasks: [],
  };
  // Newest first, as the query orders them; seven exist, five are asked for.
  transitionRows = Array.from({ length: 7 }, (_, i) => transition(i));
  transitionArgs = [];
  transitionsFail = false;
  sent.length = 0;
});

describe('buildTaskContext', () => {
  it('carries the criteria, stage, halt reason and the five newest transitions', async () => {
    const ctx = await buildTaskContext(1);
    for (const c of CRITERIA) expect(ctx).toContain(c);
    expect(ctx).toContain('ワークフローの段階: 計画作成済み（承認待ち）（plan_created）');
    expect(ctx).toContain('停止中: budget_time_exceeded');
    expect(transitionArgs).toEqual([
      {
        where: { taskId: 1 },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: CONTEXT_TRANSITIONS,
        select: { fromStatus: true, toStatus: true, actor: true, cause: true, createdAt: true },
      } as unknown as TransitionArgs,
    ]);
    expect(CONTEXT_TRANSITIONS).toBe(5);
    for (let i = 0; i < 5; i++) expect(ctx).toContain(`cause_${i}`);
    expect(ctx).not.toContain('cause_5');
  });

  it('says plainly when there are no criteria and no workflow yet', async () => {
    taskRow = {
      ...(taskRow as object),
      acceptanceCriteria: null,
      workflowStatus: null,
      haltReason: null,
    };
    const ctx = await buildTaskContext(1);
    expect(ctx).toContain('完了条件: 登録されていません');
    expect(ctx).toContain('ワークフローの段階: 未開始');
    expect(ctx).not.toContain('停止中');
  });

  it('keeps the rest of the context when the transitions cannot be read', async () => {
    transitionsFail = true;
    const ctx = await buildTaskContext(1);
    expect(ctx).toContain(CRITERIA[0]);
    expect(ctx).not.toContain('直近の遷移');
  });
});

describe('the consult input sent to the model', () => {
  it.each(['完了条件は？', '今どこ？'])('「%s」 is sent with the DB values', async (question) => {
    await sendCopilotMessage({ message: question, taskId: 1 });
    expect(sent).toHaveLength(1);
    const last = sent[0].messages.at(-1)?.content ?? '';
    expect(last.endsWith(`ユーザー: ${question}`)).toBe(true);
    for (const c of CRITERIA) expect(last).toContain(c);
    expect(last).toContain('plan_created');
    expect(last).toContain('budget_time_exceeded');
    expect(last).toContain('cause_0');
  });
});
