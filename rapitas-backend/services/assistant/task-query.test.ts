/**
 * task-query.test
 *
 * The property this whole design exists for: ラピ reports numbers the
 * database produced, never numbers she worked out. So the model's job is to
 * return a *query*, and these tests are mostly about refusing the parts of
 * its answer that do not check out, and about the count being of everything
 * matched rather than of the rows that came back.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

let reply: string | Error = '{}';
let sent: { systemPrompt?: string; content: string }[] = [];
/** Query args prisma was given. */
let queries: Record<string, unknown>[] = [];
let countResult = 0;
let rowsResult: unknown[] = [];

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async (o: { systemPrompt?: string; messages: { content: string }[] }) => {
    sent.push({
      systemPrompt: o.systemPrompt,
      content: o.messages.map((m) => m.content).join('\n'),
    });
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      count: async (args: Record<string, unknown>) => {
        queries.push({ op: 'count', ...args });
        return countResult;
      },
      findMany: async (args: Record<string, unknown>) => {
        queries.push({ op: 'findMany', ...args });
        return rowsResult;
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));

const { interpretQuestion, runTaskQuery, MAX_ANSWER_ROWS } = await import('./task-query');

const THEMES = [
  { id: 1, name: 'rapitas' },
  { id: 36, name: '健康' },
];

const GOOD = JSON.stringify({
  themeId: 1,
  statuses: ['blocked'],
  updatedWithinDays: null,
  updatedBeforeDays: null,
  titleContains: null,
  order: 'newest',
  unclear: [],
});

beforeEach(() => {
  sent = [];
  queries = [];
  reply = GOOD;
  countResult = 0;
  rowsResult = [];
});

describe('reading the question', () => {
  test('resolves it into conditions', async () => {
    const out = await interpretQuestion('rapitas でブロックされているタスクは？', THEMES);
    expect(out?.query).toMatchObject({ themeId: 1, statuses: ['blocked'], order: 'newest' });
  });

  // The whole point of the split: the model must not be the one saying "5".
  test('is told not to answer, only to translate', async () => {
    await interpretQuestion('何件ある？', THEMES);
    expect(sent[0].systemPrompt).toContain('答えそのものは書きません');
  });

  // Same shape each time: hand back a field that does not check out, and it
  // must not survive into the query.
  test.each([
    ['a theme id that does not exist', { themeId: 999 }, 'themeId'],
    ['a non-positive day count', { updatedWithinDays: -3 }, 'updatedWithinDays'],
  ])('drops %s', async (_label, patch, field) => {
    reply = JSON.stringify({ ...JSON.parse(GOOD), ...patch });
    const out = await interpretQuestion('なにか', THEMES);
    expect(field in (out?.query ?? {})).toBe(false);
  });

  test('keeps only the statuses it recognises', async () => {
    reply = JSON.stringify({ ...JSON.parse(GOOD), statuses: ['blocked', 'めっちゃ急ぎ'] });
    const out = await interpretQuestion('なにか', THEMES);
    expect(out?.query.statuses).toEqual(['blocked']);
  });

  test('falls back to a known order when it invents one', async () => {
    reply = JSON.stringify({ ...JSON.parse(GOOD), order: 'おまかせ' });
    const out = await interpretQuestion('なにか', THEMES);
    expect(out?.query.order).toBe('newest');
  });

  test('gives up rather than guessing when there is no JSON', async () => {
    reply = 'わかりません';
    expect(await interpretQuestion('なにか', THEMES)).toBeNull();
  });

  test('returns null when the model is unavailable', async () => {
    reply = new Error('補助AI機能は無効化されています (RAPITAS_AUX_AI=off)。');
    expect(await interpretQuestion('なにか', THEMES)).toBeNull();
  });

  test('does not ask the model about an empty question', async () => {
    expect(await interpretQuestion('   ', THEMES)).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('running the query', () => {
  const where = () => queries.find((q) => q.op === 'findMany')!.where as Record<string, unknown>;

  test('counts everything matched, not the rows it returns', async () => {
    countResult = 412;
    rowsResult = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    const out = await runTaskQuery({ statuses: ['done'] });
    expect(out.total).toBe(412);
    expect(out.rows).toHaveLength(20);
  });

  test('caps how many rows an answer carries', async () => {
    await runTaskQuery({});
    expect(queries.find((q) => q.op === 'findMany')!.take).toBe(MAX_ANSWER_ROWS);
  });

  test('scopes to the theme', async () => {
    await runTaskQuery({ themeId: 1 });
    expect(where().themeId).toBe(1);
  });

  test('turns "recently" into a lower bound and "untouched" into an upper one', async () => {
    await runTaskQuery({ updatedWithinDays: 7 });
    expect((where().updatedAt as { gte: Date }).gte).toBeInstanceOf(Date);

    queries = [];
    await runTaskQuery({ updatedBeforeDays: 90 });
    expect((where().updatedAt as { lt: Date }).lt).toBeInstanceOf(Date);
  });

  test('matches on the title when a word was given', async () => {
    await runTaskQuery({ titleContains: 'アバター' });
    expect(where().title).toEqual({ contains: 'アバター' });
  });

  test('adds no condition for an empty query', async () => {
    await runTaskQuery({});
    expect(where()).toEqual({});
  });

  test.each([
    ['oldest', { updatedAt: 'asc' }],
    ['due-soonest', { dueDate: 'asc' }],
    ['newest', { updatedAt: 'desc' }],
  ] as const)('orders %s correctly', async (order, expected) => {
    await runTaskQuery({ order });
    expect(queries.find((q) => q.op === 'findMany')!.orderBy).toEqual(expected);
  });
});
