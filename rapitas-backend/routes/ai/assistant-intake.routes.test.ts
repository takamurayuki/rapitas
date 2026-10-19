/**
 * assistant-intake.routes.test
 *
 * ラピ's first non-display capability. The property that matters is not what
 * it returns but what it cannot do: propose a task without writing anything.
 *
 * So the database is a recording stand-in and the test asserts on the calls
 * that were made, not merely that the response looked right — a route that
 * quietly created the task would still return a perfectly good draft.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** Every `prisma.<model>.<method>` touched during a request. */
let calls: string[] = [];

const THEMES = [
  { id: 1, name: 'rapitas' },
  { id: 36, name: '健康' },
];

/**
 * A prisma stand-in that records the path of anything reached for.
 * Reads resolve; nothing is special-cased, so an unexpected write shows up as
 * a recorded call rather than as a crash the route could swallow.
 */
const recordingPrisma = new Proxy(
  {},
  {
    get: (_target, model: string) =>
      new Proxy(
        {},
        {
          get: (_t, method: string) => {
            return async () => {
              calls.push(`${model}.${String(method)}`);
              return model === 'theme' && method === 'findMany' ? THEMES : null;
            };
          },
        },
      ),
  },
);

mock.module('../../config/database', () => ({
  prisma: recordingPrisma,
  ensureDatabaseConnection: async () => {},
}));

const { assistantIntakeRoutes } = await import('./assistant-intake.routes');

/** POST a body to the route under test and return the parsed response. */
async function postDraft(body: unknown) {
  const res = await assistantIntakeRoutes.handle(
    new Request('http://localhost/assistant/task-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
}

/** The prisma methods that change data. */
const WRITE_METHODS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'executeRaw',
  '$executeRaw',
  '$executeRawUnsafe',
];

beforeEach(() => {
  calls = [];
});

describe('POST /assistant/task-draft', () => {
  test('proposes a task', async () => {
    const { status, json } = await postDraft({ text: 'rapitas のアバターを直す 2時間' });
    expect(status).toBe(200);
    expect(json.draft.title.length).toBeGreaterThan(0);
    expect(json.draft.themeId).toBe(1);
    expect(json.draft.estimatedHours).toBe(2);
  });

  test('returns no id, because it created nothing', async () => {
    const { json } = await postDraft({ text: 'rapitas のアバターを直す' });
    expect(json.draft.id).toBeUndefined();
  });

  // The one that matters.
  test('touches no write method on any model', async () => {
    await postDraft({ text: 'rapitas のアバターを直す 2時間 緊急 明日まで' });
    const writes = calls.filter((c) => WRITE_METHODS.some((m) => c.endsWith(`.${m}`)));
    expect(writes).toEqual([]);
  });

  test('reads only the themes', async () => {
    await postDraft({ text: 'rapitas のアバターを直す' });
    expect(calls).toEqual(['theme.findMany']);
  });

  test('rejects an empty body', async () => {
    const { status } = await postDraft({ text: '' });
    expect(status).not.toBe(200);
  });

  // A pasted document should not become a parse attempt of the whole thing.
  test('rejects text beyond the length cap', async () => {
    const { status } = await postDraft({ text: 'あ'.repeat(2001) });
    expect(status).not.toBe(200);
  });
});
