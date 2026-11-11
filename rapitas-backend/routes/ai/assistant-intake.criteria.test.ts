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
    // Kept first and in order; one checkable sentence is added to reach 3.
    expect(json.draft.acceptanceCriteria.slice(0, 2)).toEqual([
      '予約が確定している',
      '日時がカレンダーにある',
    ]);
    expect(json.draft.acceptanceCriteria).toHaveLength(3);
    expect(json.draft.acceptanceCriteriaFallback).toBe(false);
    expect(
      json.draft.acceptanceCriteriaItems.map((i: { supplemented?: boolean }) => !!i.supplemented),
    ).toEqual([false, false, true]);
  });

  test('every item says who checks it, and the whole is scored (design 段B)', async () => {
    modelReply = JSON.stringify({
      title: '設定画面を作る',
      themeId: 1,
      acceptanceCriteria: [
        '設定画面が使いやすい',
        '保存ボタンを押すと値がサーバーに保存される',
        '本人が見て配色に納得できる',
      ],
    });
    const { json } = await post('task-draft', { text: '設定画面を作る' });
    const items = json.draft.acceptanceCriteriaItems as Array<{
      text: string;
      verifier: string;
      vague?: { term: string; suggestion: string };
    }>;
    expect(items.map((i) => i.verifier)).toEqual(['jury', 'jury', 'user']);
    expect(items[0].vague?.term).toBe('使いやすい');
    expect(items[0].vague?.suggestion).toContain('タップ');
    expect(items[1].vague).toBeUndefined();
    // spec-quality-checker's score for the spec carrying these criteria.
    expect(typeof json.draft.criteriaQuality.score).toBe('number');
    expect(json.draft.criteriaQuality.vagueCount).toBe(1);
    expect(json.draft.criteriaQuality.reasons.join('\n')).toContain('使いやすい');
  });

  test('more than seven are cut to seven', async () => {
    modelReply = JSON.stringify({
      title: '大掃除',
      themeId: 1,
      acceptanceCriteria: Array.from(
        { length: 9 },
        (_, i) => `部屋${i + 1}の床に物が置かれていない`,
      ),
    });
    const { json } = await post('task-draft', { text: '大掃除' });
    expect(json.draft.acceptanceCriteria).toHaveLength(7);
  });

  test('a model that proposed none still yields a flagged fallback', async () => {
    modelReply = JSON.stringify({
      title: '健康診断を予約する',
      themeId: 1,
      acceptanceCriteria: [],
    });
    const { json } = await post('task-draft', { text: '健康診断を予約する' });
    // Three checkable sentences built from the task, not one generic line.
    expect(json.draft.acceptanceCriteria).toHaveLength(3);
    for (const c of json.draft.acceptanceCriteria) expect(c).toContain('健康診断を予約する');
    expect(json.draft.acceptanceCriteriaFallback).toBe(true);
    expect(json.draft.acceptanceCriteriaItems.map((i: { verifier: string }) => i.verifier)).toEqual(
      ['jury', 'jury', 'user'],
    );
  });

  test('the pattern fallback (model unavailable) also carries criteria', async () => {
    const { json } = await post('task-draft', { text: '明日までに健康の記録をつける' });
    expect(json.source).toBe('patterns');
    expect(json.draft.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
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
