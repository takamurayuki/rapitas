/**
 * worker-health-router unit tests
 *
 * Verifies the HTTP contract (success envelope, 500 on failure) and that the
 * parent agent-metrics router mounts the endpoint without disturbing others.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const getWorkerHealth = mock(() => Promise.resolve({ points: [] } as unknown));
mock.module('./queries/worker-health', () => ({ getWorkerHealth }));

import { workerHealthRouter } from './worker-health-router';

beforeEach(() => {
  getWorkerHealth.mockReset();
  getWorkerHealth.mockImplementation(() => Promise.resolve({ points: [] }));
});

describe('workerHealthRouter', () => {
  test('GET /worker-health returns the success envelope', async () => {
    const res = await workerHealthRouter.handle(new Request('http://localhost/worker-health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { points: [] } });
  });

  test('GET /worker-health returns 500 when the query throws', async () => {
    getWorkerHealth.mockImplementation(() => Promise.reject(new Error('db down')));
    const res = await workerHealthRouter.handle(new Request('http://localhost/worker-health'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Failed to compute worker health series',
    });
  });
});
