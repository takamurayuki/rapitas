/**
 * assistant-companion routes tests (companion design 4.3, stage 1 acceptance 5)
 *
 * "伴走して" creates the task's row through a declared, confirmed capability;
 * "伴走をやめる" closes it. Unconfirmed requests change nothing and leave a
 * refusal in the audit log.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

type Row = {
  id: number;
  taskId: number;
  origin: string;
  sourceActionId: number | null;
  closedAt: Date | null;
  closedReason?: string | null;
};
let rows: Map<number, Row>;
let audited: Record<string, unknown>[];

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: async () => {},
  prisma: {
    task: {
      findUnique: async ({ where }: { where: { id: number } }) =>
        where.id === 404 ? null : { id: where.id, status: 'todo' },
    },
    taskCompanion: {
      findUnique: async ({ where }: { where: { taskId: number } }) =>
        rows.get(where.taskId) ?? null,
      create: async ({ data }: { data: { taskId: number; origin: string } }) => {
        const row = { id: rows.size + 1, sourceActionId: null, closedAt: null, ...data };
        rows.set(data.taskId, row);
        return row;
      },
      update: async () => {
        throw new Error('not used here');
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const row = rows.get(where.taskId as number);
        if (!row || ('closedAt' in where && row.closedAt !== where.closedAt)) return { count: 0 };
        rows.set(row.taskId, { ...row, ...data } as Row);
        return { count: 1 };
      },
    },
    assistantAction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audited.push(data);
        return { id: 100 + audited.length };
      },
    },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

const { default: routes } = await import('./assistant-companion.routes');

async function post(path: string, body: unknown) {
  const res = await routes.handle(
    new Request(`http://localhost/assistant/companion${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  rows = new Map();
  audited = [];
});

describe('POST /assistant/companion/start', () => {
  test('confirmed: creates a manual row and records the act', async () => {
    const r = await post('/start', { taskId: 7, confirmed: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, outcome: 'started' });
    expect(rows.get(7)).toMatchObject({
      taskId: 7,
      origin: 'manual',
      closedAt: null,
      sourceActionId: 101,
    });
    expect(audited[0]).toMatchObject({
      capabilityId: 'companion.start',
      status: 'executed',
      taskId: 7,
    });
  });

  test('unconfirmed: 400, no row, refusal recorded', async () => {
    const r = await post('/start', { taskId: 7, confirmed: false });
    expect(r.status).toBe(400);
    expect(rows.size).toBe(0);
    expect(audited[0]).toMatchObject({ capabilityId: 'companion.start', status: 'refused' });
  });

  test('already accompanied: 409; unknown task: 404', async () => {
    await post('/start', { taskId: 7, confirmed: true });
    expect((await post('/start', { taskId: 7, confirmed: true })).status).toBe(409);
    expect((await post('/start', { taskId: 404, confirmed: true })).status).toBe(404);
  });
});

describe('POST /assistant/companion/stop', () => {
  test('confirmed: closes the row with stopped_by_user', async () => {
    await post('/start', { taskId: 7, confirmed: true });
    const r = await post('/stop', { taskId: 7, confirmed: true });
    expect(r.status).toBe(200);
    expect(rows.get(7)?.closedAt).toBeInstanceOf(Date);
    expect(rows.get(7)?.closedReason).toBe('stopped_by_user');
    expect(audited.at(-1)).toMatchObject({ capabilityId: 'companion.stop', status: 'executed' });
  });

  test('unconfirmed: 400 and the row stays open', async () => {
    await post('/start', { taskId: 7, confirmed: true });
    expect((await post('/stop', { taskId: 7, confirmed: false })).status).toBe(400);
    expect(rows.get(7)?.closedAt).toBeNull();
  });

  test('nothing open: 409 not_active', async () => {
    const r = await post('/stop', { taskId: 7, confirmed: true });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('not_active');
  });
});
