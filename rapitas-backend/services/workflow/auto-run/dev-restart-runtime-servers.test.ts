/**
 * dev-restart-runtime-servers.test
 *
 * gracefulRestart() must stop the runtime-smoke servers this backend owns
 * before it exits, like the shared shutdown sequence does.
 */
import { describe, test, expect, mock, afterAll } from 'bun:test';

const callOrder: string[] = [];

mock.module('../workflow-runner', () => ({
  WorkflowRunner: {
    getInstance: () => ({
      stopProcessing: () => {
        callOrder.push('stopProcessing');
        return Promise.resolve();
      },
    }),
  },
}));
mock.module('../../agents/agent-orchestrator', () => ({
  AgentOrchestrator: {
    getInstance: () => ({
      gracefulShutdown: () => {
        callOrder.push('gracefulShutdown');
        return Promise.resolve();
      },
      getActiveExecutionCount: () => 0,
    }),
  },
}));
mock.module('../../communication/realtime-service', () => ({
  realtimeService: { shutdown: () => callOrder.push('realtimeShutdown') },
}));
const mockStopRuntime = mock((_reason?: string) => {
  callOrder.push('stopRuntimeServers');
  return Promise.resolve({ attempted: 1, stopped: 1, timedOut: false });
});
mock.module('../../agents/verification/runtime-smoke/runtime-server-shutdown', () => ({
  stopAllRuntimeServersForShutdown: mockStopRuntime,
  RUNTIME_SERVER_SHUTDOWN_TIMEOUT_MS: 15_000,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {},
}));
mock.module('../../observability', () => ({ logCycleEvent: () => {} }));

const exitCodes: number[] = [];
const originalExit = process.exit;
// @ts-expect-error: replacing process.exit for tests
process.exit = (code?: number) => {
  exitCodes.push(code ?? 0);
  callOrder.push('exit');
};
afterAll(() => {
  process.exit = originalExit;
});

const { gracefulRestart } = await import('./dev-restart-on-dry');

// 2026-11-23 13:43: an auto-run dev-restart (exit 75) landed 23 s after task
// 1403's runtime check launched its preview (pnpm → vite). gracefulRestart
// stopped the workflow runner and the agents but never the runtime servers,
// so the preview inherited the backend's listening socket and :3001 stayed a
// ghost until it was stopped by hand. The shared shutdown sequence has done
// this step since 6b0f7a05; this restart path did not use it.
describe('gracefulRestart', () => {
  test('stops the owned runtime servers before the agents and the exit', async () => {
    await gracefulRestart();
    await new Promise((r) => setTimeout(r, 400));

    expect(mockStopRuntime).toHaveBeenCalledTimes(1);
    expect(callOrder.indexOf('stopRuntimeServers')).toBeGreaterThan(
      callOrder.indexOf('stopProcessing'),
    );
    expect(callOrder.indexOf('stopRuntimeServers')).toBeLessThan(
      callOrder.indexOf('gracefulShutdown'),
    );
    expect(exitCodes).toEqual([75]);
  });
});
