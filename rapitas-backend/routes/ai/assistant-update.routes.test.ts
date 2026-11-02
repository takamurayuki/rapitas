/**
 * assistant-update routes tests (#1119 stage 6)
 *
 * The HTTP contract around ラピ changing task state and arming auto-run:
 * nothing writes without confirmation, the audit row keeps what undo needs,
 * and an undo refuses to overwrite a later edit.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { aiClientStub } from '../../tests/helpers/ai-client-stub';

mock.module('../../utils/ai-client', () => aiClientStub());
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

type Row = {
  status: string;
  priority: string;
  themeId: number | null;
  dueDate: Date | null;
} | null;
let row: Row;
const actions: Array<Record<string, unknown>> = [];
const startAutoRun = mock(async (themeId: number) => ({
  themeId,
  status: 'running',
  enabled: true,
}));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: {
      findUnique: async () => (row ? { ...row } : null),
      findMany: async () => [],
      update: async ({ data }: { data: Partial<Row> }) => {
        row = { ...(row as NonNullable<Row>), ...data };
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
mock.module('../../services/workflow/auto-run/theme-auto-run-mutations', () => ({ startAutoRun }));

const { default: assistantUpdateRoutes } = await import('./assistant-update.routes');

async function post(path: string, body: unknown) {
  const res = await assistantUpdateRoutes.handle(
    new Request(`http://localhost/assistant${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  row = { status: 'todo', priority: 'medium', themeId: 1, dueDate: null };
  actions.length = 0;
  startAutoRun.mockClear();
});

describe('POST /assistant/task-update', () => {
  test('without confirmation: 400, nothing written, refusal recorded', async () => {
    const r = await post('/task-update', {
      taskId: 5,
      changes: { status: 'done' },
      confirmed: false,
    });
    expect(r.status).toBe(400);
    expect(row.status).toBe('todo');
    expect(actions[0]).toMatchObject({ capabilityId: 'task.update', status: 'refused' });
  });

  test('confirmed: applies and records before/after for undo', async () => {
    const r = await post('/task-update', {
      taskId: 5,
      changes: { status: 'done' },
      confirmed: true,
    });
    expect(r.status).toBe(200);
    expect(row.status).toBe('done');
    expect(r.body).toMatchObject({ before: { status: 'todo' }, after: { status: 'done' } });
    expect(JSON.parse(actions[0].resultJson as string)).toEqual({
      before: { status: 'todo' },
      after: { status: 'done' },
    });
  });

  test('an invalid change is a 400 and writes nothing', async () => {
    const r = await post('/task-update', {
      taskId: 5,
      changes: { status: 'archived' },
      confirmed: true,
    });
    expect(r.status).toBe(400);
    expect(row.status).toBe('todo');
  });

  test('a task in the trash (gone from Task) is a 404', async () => {
    row = null;
    const r = await post('/task-update', {
      taskId: 5,
      changes: { status: 'done' },
      confirmed: true,
    });
    expect(r.status).toBe(404);
  });
});

describe('POST /assistant/task-update/revert', () => {
  test('restores what ラピ changed', async () => {
    const applied = await post('/task-update', {
      taskId: 5,
      changes: { priority: 'urgent' },
      confirmed: true,
    });
    const r = await post('/task-update/revert', { actionId: applied.body.actionId });
    expect(r.status).toBe(200);
    expect(row.priority).toBe('medium');
  });

  test('refuses with 409 when the field was edited since, and names it', async () => {
    const applied = await post('/task-update', {
      taskId: 5,
      changes: { priority: 'urgent' },
      confirmed: true,
    });
    row.priority = 'low';
    const r = await post('/task-update/revert', { actionId: applied.body.actionId });
    expect(r.status).toBe(409);
    expect(r.body.conflicts).toEqual(['priority']);
    expect(row.priority).toBe('low');
  });

  test('refuses an action that is not an executed task.update', async () => {
    await post('/task-update', { taskId: 5, changes: { status: 'done' }, confirmed: false });
    const r = await post('/task-update/revert', { actionId: 1 });
    expect(r.status).toBe(404);
  });
});

describe('POST /assistant/autorun-start', () => {
  test('without confirmation it does not start', async () => {
    const r = await post('/autorun-start', { themeId: 3, confirmed: false });
    expect(r.status).toBe(400);
    expect(startAutoRun).not.toHaveBeenCalled();
  });
  test('confirmed, it starts and records the act', async () => {
    const r = await post('/autorun-start', { themeId: 3, confirmed: true });
    expect(r.status).toBe(200);
    expect(startAutoRun).toHaveBeenCalledWith(3);
    expect(actions.at(-1)).toMatchObject({ capabilityId: 'autorun.start', status: 'executed' });
  });
});
