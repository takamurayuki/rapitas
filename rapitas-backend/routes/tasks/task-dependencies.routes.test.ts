// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * task-dependencies.routes.test
 *
 * Reading and replacing what a task waits for (#1559): a refused set comes
 * back as 400 with the reason, not as a success that stored nothing.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let result: unknown = { ok: true, ids: [12] };
const setPrerequisites = mock(async () => result);
mock.module('../../services/task/task-dependencies', () => ({
  setPrerequisites,
  listPrerequisites: async () => [{ id: 12, title: 'API を作る', status: 'todo' }],
}));

const { taskDependencyRoutes } = await import('./task-dependencies.routes');

const put = (body: unknown) =>
  taskDependencyRoutes.handle(
    new Request('http://localhost/tasks/20/dependencies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  result = { ok: true, ids: [12] };
  setPrerequisites.mockClear();
});

describe('PUT /tasks/:id/dependencies', () => {
  it('stores them and answers with the prerequisites', async () => {
    const res = await put({ dependsOn: [12] });
    expect(res.status).toBe(200);
    expect(setPrerequisites.mock.calls[0]).toEqual([20, [12]]);
    expect((await res.json()).prerequisites[0].id).toBe(12);
  });

  it('answers 400 with the reason when refused', async () => {
    result = { ok: false, code: 'cycle', message: 'お互いを待つことになり…' };
    const res = await put({ dependsOn: [12] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      code: 'cycle',
      error: 'お互いを待つことになり…',
    });
  });

  it('refuses something that is not a list of task ids', async () => {
    const res = await put({ dependsOn: ['x'] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(setPrerequisites).not.toHaveBeenCalled();
  });
});

describe('GET /tasks/:id/dependencies', () => {
  it('lists the prerequisites with their status', async () => {
    const res = await taskDependencyRoutes.handle(
      new Request('http://localhost/tasks/20/dependencies'),
    );
    expect((await res.json()).prerequisites).toEqual([
      { id: 12, title: 'API を作る', status: 'todo' },
    ]);
  });
});
