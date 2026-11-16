/**
 * assistant-update done-guard tests (companion design ch.2, stage 1 item 4)
 *
 * ラピ never marks a task done — on any task, accompanied or not. The write
 * and the undo are refused on the server, because `confirmed: true` is only
 * the client's word: a stale card or a hand-built request carries it as well.
 * Each refusal must leave the row untouched and a `refused` audit row behind.
 *
 * The opposite direction — undoing an act that had put a task INTO done — is
 * not a completion declaration and stays allowed.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { aiClientStub } from '../../tests/helpers/ai-client-stub';

mock.module('../../utils/ai-client', () => aiClientStub());
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

type Row = { status: string; priority: string; themeId: number | null; dueDate: Date | null };
let row: Row | null;
let writes = 0;
const actions: Array<Record<string, unknown>> = [];

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: {
      findUnique: async () => (row ? { ...row } : null),
      findMany: async () => [],
      update: async ({ data }: { data: Partial<Row> }) => {
        writes += 1;
        row = { ...(row as Row), ...data };
        return row;
      },
    },
    theme: { findUnique: async ({ where }: { where: { id: number } }) => ({ id: where.id }) },
    assistantAction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        actions.push(data);
        return { id: actions.length };
      },
      findUnique: async ({ where }: { where: { id: number } }) => {
        const a = actions[where.id - 1];
        return a ? { id: where.id, ...a } : null;
      },
    },
  },
}));

const { default: routes } = await import('./assistant-update.routes');

async function post(path: string, body: unknown) {
  const res = await routes.handle(
    new Request(`http://localhost/assistant${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** An executed task.update audit row, as an earlier ラピ version could have left it. */
function seedExecutedUpdate(before: Record<string, unknown>, after: Record<string, unknown>) {
  actions.push({
    capabilityId: 'task.update',
    status: 'executed',
    taskId: 5,
    resultJson: JSON.stringify({ before, after }),
  });
  return actions.length;
}

beforeEach(() => {
  row = { status: 'in-progress', priority: 'medium', themeId: 1, dueDate: null };
  writes = 0;
  actions.length = 0;
});

describe('POST /assistant/task-update refuses done', () => {
  test.each([
    ['confirmed', true],
    ['unconfirmed', false],
  ])(
    '%s: 409 done_not_allowed_via_assistant, row unchanged, refusal audited',
    async (_l, confirmed) => {
      const r = await post('/task-update', { taskId: 5, changes: { status: 'done' }, confirmed });
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ success: false, error: 'done_not_allowed_via_assistant' });
      expect(row).toEqual({ status: 'in-progress', priority: 'medium', themeId: 1, dueDate: null });
      expect(writes).toBe(0);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        capabilityId: 'task.update',
        status: 'refused',
        taskId: 5,
        errorMessage: 'done_not_allowed_via_assistant',
      });
    },
  );

  test('done bundled with an allowed change is refused whole', async () => {
    const r = await post('/task-update', {
      taskId: 5,
      changes: { status: 'done', priority: 'low' },
      confirmed: true,
    });
    expect(r.status).toBe(409);
    expect(row?.priority).toBe('medium');
    expect(writes).toBe(0);
  });

  test('other statuses still go through', async () => {
    const r = await post('/task-update', {
      taskId: 5,
      changes: { status: 'todo' },
      confirmed: true,
    });
    expect(r.status).toBe(200);
    expect(row?.status).toBe('todo');
  });
});

describe('POST /assistant/task-update/revert refuses writing done back', () => {
  test('before.status done: 409, row unchanged, refusal audited', async () => {
    // An act that took the task OUT of done; undoing it would put ラピ's hand
    // on the done mark.
    const id = seedExecutedUpdate({ status: 'done' }, { status: 'in-progress' });
    const r = await post('/task-update/revert', { actionId: id });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ success: false, error: 'done_not_allowed_via_assistant' });
    expect(row?.status).toBe('in-progress');
    expect(writes).toBe(0);
    expect(actions.at(-1)).toMatchObject({
      capabilityId: 'task.update',
      status: 'refused',
      errorMessage: 'done_not_allowed_via_assistant',
    });
  });

  test('undoing an act that had made the task done is allowed (it declares nothing)', async () => {
    row = { status: 'done', priority: 'medium', themeId: 1, dueDate: null };
    const id = seedExecutedUpdate({ status: 'in-progress' }, { status: 'done' });
    const r = await post('/task-update/revert', { actionId: id });
    expect(r.status).toBe(200);
    expect(row?.status).toBe('in-progress');
  });
});
