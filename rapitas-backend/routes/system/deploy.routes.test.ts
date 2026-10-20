/**
 * deploy.routes.test
 *
 * The HTTP shape. Two properties matter: a refusal must not come back as a
 * success (anything that reads only the status code would deploy-and-forget
 * on a request that did nothing), and GET must not act — it is the endpoint
 * you ask in order to decide whether to press POST, so it cannot restart
 * anything.
 *
 * Nothing is mocked. The router takes its collaborators as arguments for this
 * reason: `mock.module` on the scheduler replaces it for every other test
 * file in the run, and measured here it took `index.test.ts` from 45 passing
 * to 58 failing.
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { createDeployRoutes } from './deploy.routes';
import type {
  DeployInspection,
  DeployNowResult,
} from '../../services/scheduling/auto-restart-merged-code/deploy-now';

let inspected = 0;
let deploys = 0;
let result: DeployNowResult = { deployed: true, reason: 'deployed', aheadCount: 2 };
let inspection: DeployInspection = { ready: true, reason: 'deployed', aheadCount: 2 };
let seenCommit: string | null | undefined;

const app = new Elysia().use(
  createDeployRoutes({
    startupCommit: () => 'cafe123',
    deploy: async (commit) => {
      deploys += 1;
      seenCommit = commit;
      return result;
    },
    inspect: async (commit) => {
      inspected += 1;
      seenCommit = commit;
      return inspection;
    },
  }),
);

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

// The default export is what the route barrel mounts; if it did not build,
// the endpoints would not exist no matter how well the factory behaves.
describe('the mounted router', () => {
  test('is built with the real collaborators', async () => {
    const mounted = (await import('./deploy.routes')).default;
    expect(mounted).toBeDefined();
    const res = await new Elysia()
      .use(mounted)
      .handle(new Request('http://localhost/deploy/status'));
    // Outside the dev orchestrator there is no startup commit, which is the
    // guard working rather than a failure.
    expect(await res.json()).toMatchObject({ ready: false, reason: 'no-startup-commit' });
  });
});
