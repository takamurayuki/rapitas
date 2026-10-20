/**
 * assistant-query.routes.test
 *
 * What ラピ can tell you. The property worth protecting is that she reports
 * what the database said: the model's answer is a *query*, so a misreading
 * produces the wrong question rather than a confident wrong number.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** What the stand-in model answers. */
let modelReply: string | Error = JSON.stringify({
  themeId: 1,
  statuses: ['blocked'],
  updatedWithinDays: null,
  updatedBeforeDays: null,
  titleContains: null,
  order: 'newest',
  unclear: [],
});

/** What the stand-in database reports. */
let taskCount = 7;
let taskRows: unknown[] = [{ id: 1, title: 'ブロック中のタスク', status: 'blocked' }];
/** Audit rows written. */
let audited: Record<string, unknown>[] = [];

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async () => {
    if (modelReply instanceof Error) throw modelReply;
    return { content: modelReply, tokensUsed: 0 };
  },
}));

mock.module('../../config/database', () => ({
  prisma: {
    theme: { findMany: async () => [{ id: 1, name: 'rapitas' }] },
    task: { count: async () => taskCount, findMany: async () => taskRows },
    assistantAction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audited.push(data);
        return { id: audited.length };
      },
      findMany: async () => [],
    },
  },
  ensureDatabaseConnection: async () => {},
}));

const { assistantQueryRoutes } = await import('./assistant-query.routes');

const ask = async (text: string) => {
  const res = await assistantQueryRoutes.handle(
    new Request('http://localhost/assistant/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  );
  return { status: res.status, json: await res.json().catch(() => null) };
};

beforeEach(() => {
  audited = [];
  taskCount = 7;
  taskRows = [{ id: 1, title: 'ブロック中のタスク', status: 'blocked' }];
  modelReply = JSON.stringify({
    themeId: 1,
    statuses: ['blocked'],
    updatedWithinDays: null,
    updatedBeforeDays: null,
    titleContains: null,
    order: 'newest',
    unclear: [],
  });
});

describe('POST /assistant/ask', () => {
  test('answers with the count the database gave, not one the model made up', async () => {
    const { status, json } = await ask('rapitas でブロックされているタスクは？');
    expect(status).toBe(200);
    expect(json.total).toBe(7);
  });

  // The query travels with the answer: a misread question is only visible if
  // you can see what it was taken to mean.
  test('shows what the question was taken to mean', async () => {
    const { json } = await ask('rapitas でブロックされているタスクは？');
    expect(json.query).toMatchObject({ themeId: 1, statuses: ['blocked'] });
  });

  test('says so when the model cannot be reached, rather than answering zero', async () => {
    modelReply = new Error('補助AI機能は無効化されています (RAPITAS_AUX_AI=off)。');
    const { json } = await ask('なにか');
    expect(json.available).toBe(false);
    expect(json.total).toBeUndefined();
  });

  test('records the question and the count it answered with', async () => {
    await ask('ブロック中は？');
    const row = audited.find((a) => a.capabilityId === 'task.query');
    expect(row).toMatchObject({ status: 'executed' });
    expect(JSON.parse(String(row?.resultJson)).total).toBe(7);
  });

  test('records a question it could not read as a failure', async () => {
    modelReply = 'わかりません';
    await ask('なにか');
    expect(audited[0]).toMatchObject({ capabilityId: 'task.query', status: 'failed' });
  });

  test('rejects an empty question', async () => {
    const res = await assistantQueryRoutes.handle(
      new Request('http://localhost/assistant/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      }),
    );
    expect(res.status).not.toBe(200);
  });
});

describe('GET /assistant/capabilities', () => {
  test('reports what ラピ is allowed to do', async () => {
    const res = await assistantQueryRoutes.handle(
      new Request('http://localhost/assistant/capabilities'),
    );
    const json = await res.json();
    const ids = json.capabilities.map((c: { id: string }) => c.id);
    expect(ids).toContain('task.draft');
    expect(ids).toContain('task.create');
  });

  // The surface is meant to be inspectable, not just enforced.
  test('says of each whether it writes and whether it needs confirming', async () => {
    const res = await assistantQueryRoutes.handle(
      new Request('http://localhost/assistant/capabilities'),
    );
    const json = await res.json();
    for (const capability of json.capabilities) {
      expect(typeof capability.writes).toBe('boolean');
      expect(typeof capability.requiresConfirmation).toBe('boolean');
      expect(typeof capability.undo).toBe('string');
    }
  });
});
