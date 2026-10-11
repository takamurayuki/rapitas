/**
 * shutdown-sequence.test
 *
 * The listening socket must be released BEFORE any other shutdown step.
 *
 * Measured on 2026-10-10: the event-loop watchdog triggered a self-heal restart,
 * the sequence spent its whole 30s budget on the steps that ran ahead of
 * `stopServer()` (SSE close, runtime-smoke servers) while the loop was
 * saturated, and the shutdown watchdog then called `process.exit` with the
 * socket still open. That left a LISTEN socket owned by a dead PID (21996)
 * whose accept queue filled up, so every connection to port 3001 was refused —
 * and it survived three further automatic restarts, which is exactly the ghost
 * this module's own comment ("Closing listening socket first for quick port
 * release") was written to prevent. The log said "first"; the code did it third.
 *
 * `stopServer()` is bounded by its own internal race, so putting it first cannot
 * delay the rest.
 */
import { describe, expect, it } from 'bun:test';
import { runShutdownSteps, type ShutdownSteps } from './shutdown-sequence';

/** Records the order steps run in, and lets one of them hang on demand. */
function makeSteps(hangOn?: keyof ShutdownSteps) {
  const order: string[] = [];
  const step = <T>(name: keyof ShutdownSteps, value: T) => {
    order.push(name);
    if (name === hangOn) return new Promise<T>(() => {}); // never settles
    return Promise.resolve(value);
  };
  const steps: ShutdownSteps = {
    stopServer: () => step('stopServer', undefined) as Promise<void>,
    closeRealtime: () => {
      order.push('closeRealtime');
    },
    stopRuntimeServers: () => step('stopRuntimeServers', { stopped: 0 }),
    shutdownExecutionOwners: () => step('shutdownExecutionOwners', undefined) as Promise<void>,
  };
  return { order, steps };
}

describe('runShutdownSteps', () => {
  it('releases the listening socket before anything else', async () => {
    const { order, steps } = makeSteps();
    await runShutdownSteps('[test]', steps);
    expect(order[0]).toBe('stopServer');
  });

  it('still runs every other step', async () => {
    const { order, steps } = makeSteps();
    await runShutdownSteps('[test]', steps);
    expect(new Set(order)).toEqual(
      new Set(['stopServer', 'closeRealtime', 'stopRuntimeServers', 'shutdownExecutionOwners']),
    );
  });

  it('has already closed the socket when a later step hangs', async () => {
    // The measured failure: a later step never settles and the caller's watchdog
    // force-exits. Whatever else is lost, the socket must already be released.
    const { order, steps } = makeSteps('stopRuntimeServers');
    const pending = runShutdownSteps('[test]', steps);
    await Promise.race([pending, new Promise((r) => setTimeout(r, 50))]);
    expect(order[0]).toBe('stopServer');
    expect(order).toContain('stopRuntimeServers');
  });

  it('does not abort the remaining steps when one throws', async () => {
    const order: string[] = [];
    const steps: ShutdownSteps = {
      stopServer: async () => {
        order.push('stopServer');
      },
      closeRealtime: () => {
        order.push('closeRealtime');
        throw new Error('realtime boom');
      },
      stopRuntimeServers: async () => {
        order.push('stopRuntimeServers');
        return {};
      },
      shutdownExecutionOwners: async () => {
        order.push('shutdownExecutionOwners');
      },
    };
    await runShutdownSteps('[test]', steps);
    expect(order).toEqual([
      'stopServer',
      'closeRealtime',
      'stopRuntimeServers',
      'shutdownExecutionOwners',
    ]);
  });

  it('reports the socket as released even if stopServer itself throws', async () => {
    const order: string[] = [];
    const steps: ShutdownSteps = {
      stopServer: async () => {
        order.push('stopServer');
        throw new Error('stop boom');
      },
      closeRealtime: () => {
        order.push('closeRealtime');
      },
      stopRuntimeServers: async () => {
        order.push('stopRuntimeServers');
        return {};
      },
      shutdownExecutionOwners: async () => {
        order.push('shutdownExecutionOwners');
      },
    };
    await runShutdownSteps('[test]', steps);
    // A failure here must not stop the agents from being shut down.
    expect(order).toContain('shutdownExecutionOwners');
  });
});
