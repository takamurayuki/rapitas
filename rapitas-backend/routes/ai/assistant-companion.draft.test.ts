/**
 * assistant-companion /draft and the user's path (G2 review item 2)
 *
 * The manual "伴走して" is reached from a consultation: the sentence goes to
 * /draft, which proposes start or stop for the task in hand; the card the user
 * confirms calls /start or /stop with confirmed:true. This walks that path on
 * rows (in-memory store), not on mock arguments: a sentence opens the row, a
 * second sentence closes it, and nothing is written before a confirmation.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { createMemoryDb, type MemoryDb } from '../../tests/helpers/companion-memory-db';

let db: MemoryDb = createMemoryDb();
let audited: Record<string, unknown>[] = [];

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: async () => {},
  prisma: new Proxy(
    {},
    {
      get: (_t, key: string) =>
        key === 'assistantAction'
          ? {
              create: async ({ data }: { data: Record<string, unknown> }) => {
                audited.push(data);
                return { id: 500 + audited.length };
              },
            }
          : db.client[key],
    },
  ),
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
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  db = createMemoryDb();
  audited = [];
  db.tables.Task.push(
    { id: 7, title: '手で作ったタスク', status: 'todo', workspaceId: 3 },
    { id: 8, title: '終わったタスク', status: 'done', workspaceId: 3 },
  );
});

describe('POST /assistant/companion/draft', () => {
  test('a sentence that is not a request is handed back to the consultation', async () => {
    const { json } = await post('/draft', { text: '完了条件は？', taskId: 7 });
    expect(json).toEqual({ success: true, matched: false });
    expect(audited).toEqual([]);
  });

  test('without a task it asks for one', async () => {
    const { json } = await post('/draft', { text: '伴走して' });
    expect(json).toMatchObject({ matched: true, action: 'start', needsTask: true });
  });

  test('proposes starting, writes no row, and records the proposal', async () => {
    const { json } = await post('/draft', { text: 'このタスクを伴走して', taskId: 7 });
    expect(json).toMatchObject({
      success: true,
      matched: true,
      action: 'start',
      proposal: { action: 'start', taskId: 7, title: '手で作ったタスク', active: false },
    });
    expect(json).not.toHaveProperty('unavailable');
    expect(db.tables.TaskCompanion).toEqual([]);
    expect(audited[0]).toMatchObject({ capabilityId: 'companion.draft', status: 'proposed' });
  });

  test.each([
    ['start on a finished task', '伴走して', 8, 'task_done'],
    ['stop when not accompanied', '伴走をやめて', 7, 'not_active'],
  ])('%s says why instead of proposing', async (_name, text, taskId, reason) => {
    const { json } = await post('/draft', { text, taskId });
    expect(json.unavailable).toBe(reason);
    expect(audited[0]).toMatchObject({ status: 'refused', errorMessage: reason });
  });

  test('a missing task is 404', async () => {
    const { status } = await post('/draft', { text: '伴走して', taskId: 999 });
    expect(status).toBe(404);
  });
});

describe('the user path: sentence → card → confirm (acceptance 5)', () => {
  test('"伴走して" then "伴走をやめて" opens and closes the row', async () => {
    // 1. The sentence becomes a proposal; nothing is written yet.
    const draft = await post('/draft', { text: '伴走して', taskId: 7 });
    const proposal = draft.json.proposal as { action: string; taskId: number };
    expect(proposal.action).toBe('start');
    expect(db.tables.TaskCompanion).toEqual([]);

    // 2. The card's button sends exactly that, confirmed.
    const started = await post(`/${proposal.action}`, { taskId: proposal.taskId, confirmed: true });
    expect(started.json).toMatchObject({ success: true, outcome: 'started' });
    expect(db.tables.TaskCompanion).toEqual([
      expect.objectContaining({ taskId: 7, origin: 'manual', closedAt: null, workspaceId: 3 }),
    ]);
    expect(db.tables.TaskCompanion[0].sourceActionId).toBe(started.json.actionId);

    // 3. Asking again now says it is already accompanied.
    const again = await post('/draft', { text: '伴走して', taskId: 7 });
    expect(again.json.unavailable).toBe('already_active');

    // 4. "伴走をやめて" proposes the stop; the confirmed stop closes the row.
    const stopDraft = await post('/draft', { text: '伴走をやめて', taskId: 7 });
    expect(stopDraft.json).toMatchObject({ action: 'stop', proposal: { active: true } });
    const stopped = await post('/stop', { taskId: 7, confirmed: true });
    expect(stopped.json.success).toBe(true);
    expect(db.tables.TaskCompanion[0]).toMatchObject({ closedReason: 'stopped_by_user' });
    expect(db.tables.TaskCompanion[0].closedAt).toBeInstanceOf(Date);
  });

  test('an unconfirmed press writes nothing', async () => {
    const res = await post('/start', { taskId: 7, confirmed: false });
    expect(res.status).toBe(400);
    expect(db.tables.TaskCompanion).toEqual([]);
  });
});
