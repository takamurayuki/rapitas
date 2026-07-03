/**
 * workflow-runner-events.test
 *
 * Coverage for the ActivityLog + SSE event emission helpers extracted from
 * workflow-runner.ts: phase-transition logging (incl. the cycle-log noise
 * filter for 'advancing' / no-op transitions), and the two never-throw
 * broadcast helpers.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const activityLogCreate = mock(() => Promise.resolve({}));
const broadcast = mock(() => {});
const logCycleEvent = mock(() => {});
const logWarn = mock(() => {});

// NOTE: Mirror ALL real exports of '../../config' — bun mock.module is
// process-global; any file in the same test run importing an export missing
// here would throw "export not found".
mock.module('../../config', () => ({
  prisma: { activityLog: { create: activityLogCreate } },
  ensureDatabaseConnection: mock(() => Promise.resolve()),
  logger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  },
  createLogger: () => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  }),
  getDbProvider: () => 'sqlite',
  getInsensitiveMode: () => ({}),
  getProjectRoot: () => 'C:/Projects/rapitas',
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    warn: logWarn,
    error: mock(() => {}),
    debug: mock(() => {}),
  }),
}));

mock.module('../communication/realtime-service', () => ({
  realtimeService: { broadcast },
}));

mock.module('../observability', () => ({
  logCycleEvent,
  getCycleLogFilePath: () => '/tmp/cycle.ndjson',
}));

const { logPhaseTransition, broadcastRunnerStatus, broadcastItemUpdate } =
  await import('./workflow-runner-events');

beforeEach(() => {
  activityLogCreate.mockClear();
  activityLogCreate.mockImplementation(() => Promise.resolve({}));
  broadcast.mockClear();
  broadcast.mockImplementation(() => {});
  logCycleEvent.mockClear();
  logWarn.mockClear();
});

describe('logPhaseTransition', () => {
  it('writes an ActivityLog row with known Japanese phase labels', async () => {
    await logPhaseTransition(1, 'draft', 'research_done');

    expect(activityLogCreate).toHaveBeenCalledTimes(1);
    const call = activityLogCreate.mock.calls[0][0] as {
      data: { taskId: number; action: string; metadata: string };
    };
    expect(call.data.taskId).toBe(1);
    expect(call.data.action).toBe('workflow_phase_transition');
    const metadata = JSON.parse(call.data.metadata) as {
      previousLabel: string;
      newLabel: string;
    };
    expect(metadata.previousLabel).toBe('調査中');
    expect(metadata.newLabel).toBe('計画中');
  });

  it('falls back to the raw phase string for an unknown phase', async () => {
    await logPhaseTransition(2, 'draft', 'totally_unknown_phase');

    const call = activityLogCreate.mock.calls[0][0] as { data: { metadata: string } };
    const metadata = JSON.parse(call.data.metadata) as { newLabel: string };
    expect(metadata.newLabel).toBe('totally_unknown_phase');
  });

  it('broadcasts the transition on the orchestra channel', async () => {
    await logPhaseTransition(3, 'plan_created', 'plan_approved');

    expect(broadcast).toHaveBeenCalledTimes(1);
    const [channel, event, payload] = broadcast.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(channel).toBe('orchestra');
    expect(event).toBe('phase_transition');
    expect(payload.taskId).toBe(3);
    expect(payload.newLabel).toBe('実装中');
  });

  it('records a cycle-log event for a real, non-advancing transition', async () => {
    await logPhaseTransition(4, 'plan_approved', 'in_progress');

    expect(logCycleEvent).toHaveBeenCalledTimes(1);
    const [name, fields] = logCycleEvent.mock.calls[0] as [string, { from: string; to: string }];
    expect(name).toBe('phase.transition');
    expect(fields.from).toBe('plan_approved');
    expect(fields.to).toBe('in_progress');
  });

  it('skips the cycle log for the synthetic "advancing" pseudo-phase', async () => {
    await logPhaseTransition(5, 'draft', 'advancing');

    expect(activityLogCreate).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(logCycleEvent).not.toHaveBeenCalled();
  });

  it('skips the cycle log for a no-op transition (previousPhase === newPhase)', async () => {
    await logPhaseTransition(6, 'in_progress', 'in_progress');

    expect(logCycleEvent).not.toHaveBeenCalled();
  });

  it('swallows a DB failure and logs a warning instead of throwing', async () => {
    activityLogCreate.mockImplementation(() => Promise.reject(new Error('DB down')));

    await expect(logPhaseTransition(7, 'draft', 'research_done')).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalledTimes(1);
    // A failure before the broadcast call must not have reached SSE.
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('broadcastRunnerStatus', () => {
  const status = {
    running: true,
    activeExecutions: 2,
    queueDepth: 1,
  } as unknown as Parameters<typeof broadcastRunnerStatus>[1];

  it('broadcasts the runner status payload on the orchestra channel', () => {
    broadcastRunnerStatus('runner_started', status);

    expect(broadcast).toHaveBeenCalledTimes(1);
    const [channel, event, payload] = broadcast.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(channel).toBe('orchestra');
    expect(event).toBe('runner_started');
    expect(payload.runner).toBe(status);
  });

  it('never throws even when the broadcast itself throws', () => {
    broadcast.mockImplementation(() => {
      throw new Error('SSE unavailable');
    });

    expect(() => broadcastRunnerStatus('runner_stopped', status)).not.toThrow();
  });
});

describe('broadcastItemUpdate', () => {
  it('broadcasts the item-update payload with all fields', () => {
    broadcastItemUpdate(10, 20, 'dequeued', 'in_progress', 3);

    expect(broadcast).toHaveBeenCalledTimes(1);
    const [channel, event, payload] = broadcast.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(channel).toBe('orchestra');
    expect(event).toBe('item_update');
    expect(payload).toMatchObject({
      event: 'dequeued',
      itemId: 10,
      taskId: 20,
      phase: 'in_progress',
      activeCount: 3,
    });
  });

  it('never throws even when the broadcast itself throws', () => {
    broadcast.mockImplementation(() => {
      throw new Error('SSE unavailable');
    });

    expect(() => broadcastItemUpdate(1, 2, 'enqueued', 'draft', 0)).not.toThrow();
  });
});
