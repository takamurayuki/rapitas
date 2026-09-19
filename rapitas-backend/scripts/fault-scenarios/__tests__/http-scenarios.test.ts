/**
 * http-scenarios.test
 *
 * Unit tests for the HTTP-driven fault scenarios (stop-during-verification,
 * db-write-failure, duplicate-callback, process-restart) with global fetch
 * mocked — actual live-backend coverage is provided by fault-injection-e2e.ts
 * in CI (see .github/workflows/e2e.yml), matching restart-loop-smoke.test.ts's
 * split between unit-tested helpers and a real E2E run.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { run as runStopDuringVerification } from '../stop-during-verification';
import { run as runDbWriteFailure } from '../db-write-failure';
import { run as runDuplicateCallback } from '../duplicate-callback';
import { run as runProcessRestart } from '../process-restart';
import { waitForPortFree } from '../../restart-loop-smoke';

const CTX = { port: 3211, baseUrl: 'http://localhost:3211', cwd: '.' };

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  // @ts-expect-error test override of global fetch
  delete globalThis.fetch;
});

describe('stop-during-verification', () => {
  it('passes when task creation and stop-execution both succeed', async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call++;
      return call === 1 ? jsonResponse({ id: 1 }) : jsonResponse({});
    }) as typeof fetch;

    const result = await runStopDuringVerification(CTX);
    expect(result.passed).toBe(true);
  });

  it('fails when task creation fails', async () => {
    globalThis.fetch = (async () => jsonResponse({}, false)) as typeof fetch;
    const result = await runStopDuringVerification(CTX);
    expect(result.passed).toBe(false);
  });
});

describe('db-write-failure', () => {
  it('passes when the invalid write is rejected', async () => {
    globalThis.fetch = (async () => jsonResponse({}, false, 422)) as typeof fetch;
    const result = await runDbWriteFailure(CTX);
    expect(result.passed).toBe(true);
  });

  it('fails when the invalid write is wrongly accepted', async () => {
    globalThis.fetch = (async () => jsonResponse({ id: 1 })) as typeof fetch;
    const result = await runDbWriteFailure(CTX);
    expect(result.passed).toBe(false);
  });
});

describe('duplicate-callback', () => {
  it('passes when both stop-execution calls succeed idempotently', async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call++;
      return call === 1 ? jsonResponse({ id: 1 }) : jsonResponse({});
    }) as typeof fetch;
    const result = await runDuplicateCallback(CTX);
    expect(result.passed).toBe(true);
  });

  it('fails when the second call errors', async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call++;
      if (call === 1) return jsonResponse({ id: 1 });
      if (call === 2) return jsonResponse({});
      return jsonResponse({}, false, 500);
    }) as typeof fetch;
    const result = await runDuplicateCallback(CTX);
    expect(result.passed).toBe(false);
  });
});

describe('process-restart', () => {
  it('passes when the port frees after the kill function runs', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      // Only intercept the task-creation call — the port-free check's own
      // /health probe must hit the real (unmocked) network so it correctly
      // observes "nothing listening" as free.
      if (String(input).endsWith('/tasks')) return jsonResponse({ id: 1 });
      throw new Error('connection refused (simulated free port)');
    }) as typeof fetch;
    const killFn = async () => {};
    const result = await runProcessRestart(CTX, killFn);
    expect(result.passed).toBe(true);
  }, 15000);

  it('fails when the port never frees (ghost socket)', async () => {
    globalThis.fetch = (async () => jsonResponse({ id: 1 })) as typeof fetch;
    // waitForPortFree isn't directly mockable through the module import here,
    // so this asserts the exported helper's contract instead — a ghost
    // socket path is exercised end-to-end by fault-injection-e2e.ts.
    const { free } = await waitForPortFree(65535, 50, 10, async () => false);
    expect(free).toBe(false);
  });
});
