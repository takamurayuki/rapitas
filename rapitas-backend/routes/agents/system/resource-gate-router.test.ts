/**
 * resource-gate-router.test
 *
 * Task 1553: /agents/resource-gate/status reports the gate as enabled by
 * default, the new default threshold, and the rapitas process-tree CPU with
 * its averaging window next to the host-wide value.
 *
 * Run this file on its own: bun's mock.module is process-global.
 */
import { describe, it, expect, mock, afterEach, afterAll } from 'bun:test';

mock.module('../../../config/database', () => ({ prisma: {} }));
mock.module('../../../services/workflow/workflow-queue', () => ({
  isTaskTerminalForQueue: () => false,
  WorkflowQueueService: { getInstance: () => ({ getMaxConcurrency: () => 2 }) },
}));
mock.module('../../../services/system/resource-telemetry', () => ({
  getHostCpuBusyPercent: () => 97,
  getRapitasCpuBusyPercent: () => 31,
  getRapitasCpuWindowMs: () => 300_000,
  sampleResourceTelemetryNow: async () => {},
  startResourceTelemetryIfEnabled: () => {},
  stopResourceTelemetry: () => {},
  computeBusyPercent: () => null,
}));

const { resourceGateRouter } = await import('./resource-gate-router');

async function status(): Promise<Record<string, unknown>> {
  const res = await resourceGateRouter.handle(
    new Request('http://localhost/agents/resource-gate/status'),
  );
  return (await res.json()) as Record<string, unknown>;
}

afterEach(() => {
  delete process.env.RAPITAS_RESOURCE_GATE_ENABLED;
  delete process.env.RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT;
});
afterAll(() => mock.restore());

describe('GET /agents/resource-gate/status (task 1553)', () => {
  it('is enabled by default with threshold 60 and reports both CPU values', async () => {
    expect(await status()).toEqual({
      enabled: true,
      thresholdPercent: 60,
      hostCpuBusyPercent: 97,
      rapitasCpuBusyPercent: 31,
      windowMs: 300_000,
      effectiveMaxConcurrency: 2,
    });
  });

  it('reflects RAPITAS_RESOURCE_GATE_ENABLED=false and a custom threshold', async () => {
    process.env.RAPITAS_RESOURCE_GATE_ENABLED = 'false';
    process.env.RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT = '70';
    const body = await status();
    expect(body.enabled).toBe(false);
    expect(body.thresholdPercent).toBe(70);
  });
});
