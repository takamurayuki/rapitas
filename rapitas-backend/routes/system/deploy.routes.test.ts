/**
 * deploy.routes.test
 *
 * The HTTP shape. Two properties matter: a refusal must not come back as a
 * success (anything that only reads the status code would deploy-and-forget
 * on a request that did nothing), and GET must not act — it is the endpoint
 * you use to decide whether to press POST, so it cannot restart anything.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

let inspected = 0;
let deploys = 0;
let result: Record<string, unknown> = { deployed: true, reason: 'deployed', aheadCount: 2 };
let inspection: Record<string, unknown> = { ready: true, reason: 'deployed', aheadCount: 2 };
let seenCommit: unknown;

mock.module('../../services/scheduling/auto-restart-merged-code/deploy-now', () => ({
  deployNow: async (commit: string | null) => {
    deploys += 1;
    seenCommit = commit;
    return result;
  },
  inspectDeploy: async (commit: string | null) => {
    inspected += 1;
    seenCommit = commit;
    return inspection;
  },
}));

mock.module('../../services/scheduling/auto-restart-merged-code', () => ({
  getAutoRestartMergedCodeScheduler: () => ({ getStartupCommit: () => 'cafe123' }),
}));

const deployRoutes = (await import('./deploy.routes')).default;
const { Elysia } = await import('elysia');
const app = new Elysia().use(deployRoutes);

const call = (path: string, method: string) =>
  app.handle(new Request(`http://localhost${path}`, { method }));

beforeEach(() => {
  inspected = 0;
  deploys = 0;
  seenCommit = undefined;
  result = { deployed: true, reason: 'deployed', aheadCount: 2 };
  inspection = { ready: true, reason: 'deployed', aheadCount: 2 };
});

describe('POST /deploy/now', () => {
  test('reports what the deploy did', async () => {
    const res = await call('/deploy/now', 'POST');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deployed: true, aheadCount: 2 });
    expect(deploys).toBe(1);
  });

  // A refusal with a 200 is read as success by every caller that checks only
  // the status, which is most of them.
  test('answers 409 when a gate refused, with the gate named', async () => {
    result = { deployed: false, reason: 'running-executions', aheadCount: 2 };
    const res = await call('/deploy/now', 'POST');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ deployed: false, reason: 'running-executions' });
  });

  test('passes the running process its own startup commit', async () => {
    await call('/deploy/now', 'POST');
    expect(seenCommit).toBe('cafe123');
  });
});

describe('GET /deploy/status', () => {
  test('reports whether it would go, and what is waiting', async () => {
    const res = await call('/deploy/status', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ready: true, aheadCount: 2 });
  });

  // This is the endpoint you ask BEFORE pressing the other one. If it could
  // restart the process, there would be nothing safe to ask.
  test('acts on nothing', async () => {
    inspection = { ready: false, reason: 'queue-not-empty', aheadCount: 4 };
    const res = await call('/deploy/status', 'GET');
    expect(res.status).toBe(200);
    expect(deploys).toBe(0);
    expect(inspected).toBe(1);
  });
});
