/**
 * deviation-router tests — routes are mounted under /workflow and delegate
 * to the handlers (deps injected; no DB).
 */
import { describe, expect, test } from 'bun:test';
import { createDeviationRoutes } from './deviation-router';
import type { DeviationDeps } from './deviation-handlers';

const deps: DeviationDeps = {
  readPlan: async () => '# no files declared',
  findExecutions: async () => [],
  readOperations: () => ({ operations: [], warnings: [] }),
  logSource: () => ({ getBounds: async () => null, getRange: async () => [] }),
  appendAudit: () => {},
};

const app = createDeviationRoutes(deps);
const base = 'http://localhost/workflow';

describe('deviation routes', () => {
  test('GET /tasks/:taskId/deviation-timeline', async () => {
    const res = await app.handle(new Request(`${base}/tasks/3/deviation-timeline`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ambiguous', executionId: null });
  });

  test('GET /executions/:executionId/deviation-context', async () => {
    const res = await app.handle(new Request(`${base}/executions/4/deviation-context?seq=1`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: [] });
  });

  test('POST /tasks/:taskId/deviation-audit without header → 403', async () => {
    const res = await app.handle(
      new Request(`${base}/tasks/3/deviation-audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test('POST /tasks/:taskId/deviation-audit with header → saved', async () => {
    const res = await app.handle(
      new Request(`${base}/tasks/3/deviation-audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rapitas-source': 'ui' },
        body: JSON.stringify({ decision: 'approved', comment: 'ok' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      audit: { taskId: 3, ambiguous: true },
    });
  });
});
