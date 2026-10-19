/**
 * assistant-intake.create.test
 *
 * The confirmed half of ラピ's surface. `POST /assistant/task-create` is the
 * only route through which ラピ creates anything, and the property that
 * matters is that it will not do so unasked: the confirmation travels in the
 * payload, and without it nothing is written.
 *
 * Asserted on the calls the route made, not on its response — a route that
 * created the task and then returned an error would look the same from here.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** Prisma calls the route made, by `model.method`. */
let calls: string[] = [];
/** Task rows the route asked to create. */
let created: Record<string, unknown>[] = [];

mock.module('../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: async () => {},
}));

mock.module('../../services/task/task-mutations', () => ({
  createTask: async (_prisma: unknown, data: Record<string, unknown>) => {
    calls.push('createTask');
    created.push(data);
    return { id: 99, ...data };
  },
}));

const { assistantIntakeRoutes } = await import('./assistant-intake.routes');

const VALID_TASK = { title: 'アバターを直す', themeId: 1 };

async function post(path: string, body: unknown) {
  const res = await assistantIntakeRoutes.handle(
    new Request(`http://localhost/assistant/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: res.status < 500 ? await res.json().catch(() => null) : null };
}

beforeEach(() => {
  calls = [];
  created = [];
});

describe('POST /assistant/task-create', () => {
  test('creates the task when the user confirmed it', async () => {
    const { status, json } = await post('task-create', { confirmed: true, task: VALID_TASK });
    expect(status).toBe(200);
    expect(json.id).toBe(99);
    expect(created[0]).toMatchObject({ title: 'アバターを直す', themeId: 1, status: 'todo' });
  });

  // The gate. Both shapes of "the user did not agree to this" are refused:
  // an explicit false, and a payload that simply omits the field.
  test.each([
    ['false', { confirmed: false, task: VALID_TASK }],
    ['absent', { task: VALID_TASK }],
  ])('creates nothing when the confirmation is %s', async (_label, body) => {
    const { status } = await post('task-create', body);
    expect(status).not.toBe(200);
    expect(calls).toEqual([]);
  });

  test('says why it refused, rather than failing opaquely', async () => {
    const { status, json } = await post('task-create', { confirmed: false, task: VALID_TASK });
    expect(status).toBe(400);
    expect(json.error).toBe('confirmation_required');
  });

  // ラピ never guesses a theme, so a request without one is malformed rather
  // than something for the route to fill in.
  test('refuses a task with no theme', async () => {
    const { status } = await post('task-create', {
      confirmed: true,
      task: { title: 'テーマなし' },
    });
    expect(status).not.toBe(200);
    expect(calls).toEqual([]);
  });

  test('refuses an empty title', async () => {
    const { status } = await post('task-create', {
      confirmed: true,
      task: { title: '', themeId: 1 },
    });
    expect(status).not.toBe(200);
    expect(calls).toEqual([]);
  });

  test('passes the optional fields through when they are given', async () => {
    await post('task-create', {
      confirmed: true,
      task: {
        ...VALID_TASK,
        description: '元の発話',
        priority: 'urgent',
        estimatedHours: 2,
        dueDate: '2026-10-21T00:00:00.000Z',
      },
    });
    expect(created[0]).toMatchObject({
      description: '元の発話',
      priority: 'urgent',
      estimatedHours: 2,
    });
  });

  test('omits what was not given, rather than sending empty values', async () => {
    await post('task-create', { confirmed: true, task: VALID_TASK });
    expect('priority' in created[0]).toBe(false);
    expect('dueDate' in created[0]).toBe(false);
    expect('estimatedHours' in created[0]).toBe(false);
  });
});

describe('GET /assistant/capabilities', () => {
  test('reports what ラピ is allowed to do', async () => {
    const res = await assistantIntakeRoutes.handle(
      new Request('http://localhost/assistant/capabilities'),
    );
    const json = await res.json();
    const ids = json.capabilities.map((c: { id: string }) => c.id);
    expect(ids).toContain('task.draft');
    expect(ids).toContain('task.create');
  });

  // The surface is meant to be inspectable, not just enforced.
  test('says of each whether it writes and whether it needs confirming', async () => {
    const res = await assistantIntakeRoutes.handle(
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
