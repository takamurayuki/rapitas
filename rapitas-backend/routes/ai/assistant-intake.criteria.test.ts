/**
 * assistant-intake criteria tests (companion design stage 1, item 1)
 *
 * The creation mode always goes through "propose criteria → user confirms":
 * the draft carries criteria even when the reader proposed none, and the
 * confirmed create refuses to file a task without them. A created task is
 * accompanied: its TaskCompanion row travels in the same insert, and is then
 * pointed at the audit row that made it.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { aiClientStub } from '../../tests/helpers/ai-client-stub';

let modelReply: string | null = null;
let created: Record<string, unknown>[] = [];
let audited: Record<string, unknown>[] = [];
let linked: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];

mock.module('../../utils/ai-client', () =>
  aiClientStub({
    sendAIMessage: async () => {
      if (modelReply === null) throw new Error('model off');
      return { content: modelReply, tokensUsed: 0 };
    },
  }),
);
mock.module('../../config/database', () => ({
  prisma: {
    theme: { findMany: async () => [{ id: 1, name: '健康', description: null }] },
    assistantAction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audited.push(data);
        return { id: 40 + audited.length };
      },
    },
    taskCompanion: {
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        linked.push(args);
        return { count: 1 };
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));
mock.module('../../services/task/task-mutations', () => ({
  createTask: async (_prisma: unknown, data: Record<string, unknown>) => {
    created.push(data);
    return { id: 99, ...data };
  },
}));

const { assistantIntakeRoutes } = await import('./assistant-intake.routes');

async function post(path: string, body: unknown) {
  const res = await assistantIntakeRoutes.handle(
    new Request(`http://localhost/assistant/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> };
}

beforeEach(() => {
  modelReply = null;
  created = [];
  audited = [];
  linked = [];
});

describe('POST /assistant/task-draft always proposes criteria', () => {
  test('the model’s criteria are kept as proposed', async () => {
    modelReply = JSON.stringify({
      title: '健康診断を予約する',
      themeId: 1,
      acceptanceCriteria: ['予約が確定している', '日時がカレンダーにある'],
    });
    const { json } = await post('task-draft', { text: '健康診断を予約する' });
    expect(json.source).toBe('intent');
    expect(json.draft.acceptanceCriteria).toEqual(['予約が確定している', '日時がカレンダーにある']);
    expect(json.draft.acceptanceCriteriaFallback).toBe(false);
  });

  test('a model that proposed none still yields a flagged fallback', async () => {
    modelReply = JSON.stringify({
      title: '健康診断を予約する',
      themeId: 1,
      acceptanceCriteria: [],
    });
    const { json } = await post('task-draft', { text: '健康診断を予約する' });
    expect(json.draft.acceptanceCriteria).toHaveLength(1);
    expect(json.draft.acceptanceCriteria[0]).toContain('健康診断を予約する');
    expect(json.draft.acceptanceCriteriaFallback).toBe(true);
  });

  test('the pattern fallback (model unavailable) also carries criteria', async () => {
    const { json } = await post('task-draft', { text: '明日までに健康の記録をつける' });
    expect(json.source).toBe('patterns');
    expect(json.draft.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(json.draft.acceptanceCriteriaFallback).toBe(true);
  });
});

describe('POST /assistant/task-create requires criteria', () => {
  test.each([
    ['absent', undefined],
    ['empty', []],
    ['blank only', ['  ', '']],
  ])(
    '%s criteria: 400 acceptance_criteria_required, nothing created, refusal audited',
    async (_l, criteria) => {
      const task: Record<string, unknown> = { title: 'アバターを直す', themeId: 1 };
      if (criteria !== undefined) task.acceptanceCriteria = criteria;
      const { status, json } = await post('task-create', { confirmed: true, task });
      expect(status).toBe(400);
      expect(json.error).toBe('acceptance_criteria_required');
      expect(created).toEqual([]);
      expect(audited[0]).toMatchObject({
        capabilityId: 'task.create',
        status: 'refused',
        errorMessage: 'acceptance_criteria_required',
      });
    },
  );

  test('writes the criteria to the column and the companion row in the same create', async () => {
    const { status } = await post('task-create', {
      confirmed: true,
      task: {
        title: 'アバターを直す',
        themeId: 1,
        acceptanceCriteria: [' 崩れない ', '崩れない', '速い'],
      },
    });
    expect(status).toBe(200);
    expect(created).toHaveLength(1);
    expect(created[0].acceptanceCriteria).toEqual(['崩れない', '速い']);
    expect(created[0].companion).toEqual({ origin: 'task_create' });
  });

  test('points the companion row at the executed audit row', async () => {
    await post('task-create', {
      confirmed: true,
      task: { title: 'アバターを直す', themeId: 1, acceptanceCriteria: ['崩れない'] },
    });
    expect(audited[0]).toMatchObject({
      capabilityId: 'task.create',
      status: 'executed',
      taskId: 99,
    });
    expect(linked).toEqual([
      { where: { taskId: { in: [99] }, sourceActionId: null }, data: { sourceActionId: 41 } },
    ]);
  });
});
