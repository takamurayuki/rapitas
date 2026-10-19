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

/** The audit rows the route wrote. */
let audited: Record<string, unknown>[] = [];

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
            return async (args?: { data?: Record<string, unknown> }) => {
              calls.push(`${model}.${String(method)}`);
              if (model === 'assistantAction' && method === 'create') {
                audited.push(args?.data ?? {});
                return { id: audited.length };
              }
              return model === 'theme' && method === 'findMany' ? THEMES : null;
            };
          },
        },
      ),
  },
);

/** What the stand-in model answers, or the error it throws. */
let modelReply: string | Error = JSON.stringify({
  title: 'アバターの吹き出しが長文で崩れる問題を修正',
  summary: '長文で折り返されず崩れる',
  themeId: 1,
  themeReason: 'アバターは rapitas 本体の機能のため',
  priority: 'high',
  dueDate: null,
  estimatedHours: 2,
  acceptanceCriteria: ['長文でも吹き出しの幅を超えない'],
  unclear: [],
});

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async () => {
    if (modelReply instanceof Error) throw modelReply;
    return { content: modelReply, tokensUsed: 0 };
  },
}));

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

/** The one write proposing is allowed to make: its own audit record. */
const AUDIT_WRITE = 'assistantAction.create';

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
  audited = [];
  modelReply = DEFAULT_MODEL_REPLY;
});

/** The good answer, restored before each test. */
const DEFAULT_MODEL_REPLY = modelReply;

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

  // The one that matters. Proposing writes exactly one row — its own audit
  // record — and nothing else. Recording that ラピ suggested something is not
  // a change to the user's data; a write to any other model would be, so the
  // exemption is spelled out rather than the assertion relaxed.
  test('changes nothing of the user own, whatever it understood', async () => {
    await postDraft({ text: 'rapitas のアバターを直す 2時間 緊急 明日まで' });
    const writes = calls.filter((c) => WRITE_METHODS.some((m) => c.endsWith(`.${m}`)));
    expect(writes).toEqual([AUDIT_WRITE]);
  });

  test('reads the themes and writes only its own record', async () => {
    await postDraft({ text: 'rapitas のアバターを直す' });
    expect(calls).toEqual(['theme.findMany', AUDIT_WRITE]);
  });

  test('records the proposal, so a draft the user walked away from still shows', async () => {
    await postDraft({ text: 'rapitas のアバターを直す' });
    expect(audited[0]).toMatchObject({ capabilityId: 'task.draft', status: 'proposed' });
  });

  // The point of reading intent: the theme is chosen from meaning, and the
  // reason is the model's own words rather than "the name was in the text".
  test('reports that it read the intent, and why it chose the theme', async () => {
    const { json } = await postDraft({ text: 'アバターの吹き出しが長文だと崩れる' });
    expect(json.source).toBe('intent');
    expect(json.draft.themeId).toBe(1);
    expect(json.draft.themeReason).toBe('アバターは rapitas 本体の機能のため');
    expect(json.draft.acceptanceCriteria).toEqual(['長文でも吹き出しの幅を超えない']);
  });

  // RAPITAS_AUX_AI=off, no provider, CLI busy. The feature degrades to the
  // pattern reader instead of failing, and says so.
  test('falls back to patterns when the model is unavailable, and says so', async () => {
    modelReply = new Error('補助AI機能は無効化されています (RAPITAS_AUX_AI=off)。');
    const { status, json } = await postDraft({ text: 'rapitas のアバターを直す 2時間' });
    expect(status).toBe(200);
    expect(json.source).toBe('patterns');
    expect(json.draft.title.length).toBeGreaterThan(0);
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
