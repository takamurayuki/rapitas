/**
 * theme-auto-run-scheduler.resource-gate.test
 *
 * Covers the resource-contention gate insertion point in advanceTheme() (task
 * 725): when the gate holds, selectNextTask must not be called and an
 * ActivityLog + a single deduplicated Notification are recorded instead.
 * RAPITAS_RESOURCE_GATE_ENABLED is set/restored around each test since the
 * gate is a no-op whenever the flag is unset (the default for every other
 * scheduler test in this suite).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  mockSelectNextTask,
  mockActivityLogCreate,
  mockNotifyResourceContentionHold,
  mockEvaluateResourceGate,
  mockConsumeResourceGateOverride,
  mockLogCycleEvent,
} from './theme-auto-run-scheduler.test-support';

let scheduler: ThemeAutoRunScheduler;
const ORIGINAL_ENABLED = process.env.RAPITAS_RESOURCE_GATE_ENABLED;

beforeEach(() => {
  resetAllMocks();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
});

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.RAPITAS_RESOURCE_GATE_ENABLED;
  else process.env.RAPITAS_RESOURCE_GATE_ENABLED = ORIGINAL_ENABLED;
});

describe('advanceTheme — resource-contention gate (RAPITAS_RESOURCE_GATE_ENABLED=true)', () => {
  it('holds selection, records an ActivityLog entry, and skips selectNextTask when the gate holds', async () => {
    process.env.RAPITAS_RESOURCE_GATE_ENABLED = 'true';
    mockEvaluateResourceGate.mockReturnValue({
      hold: true,
      cpuBusyPercent: 92,
      thresholdPercent: 85,
      effectiveMaxConcurrency: 4,
    });

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockSelectNextTask).not.toHaveBeenCalled();
    expect(mockActivityLogCreate).toHaveBeenCalledTimes(1);
    const data = (
      mockActivityLogCreate.mock.calls[0]?.[0] as { data: { action: string; metadata: string } }
    ).data;
    expect(data.action).toBe('auto_run.resource_deferred');
    expect(JSON.parse(data.metadata)).toMatchObject({
      themeId: 1,
      cpuBusyPercent: 92,
      thresholdPercent: 85,
    });
    expect(mockLogCycleEvent).toHaveBeenCalledWith(
      'task.resource_hold',
      expect.objectContaining({ theme: 1, cause: 'host_cpu_busy' }),
    );
  });

  it('creates the notification once across two consecutive holding ticks (notifyOnce dedup is the caller responsibility)', async () => {
    process.env.RAPITAS_RESOURCE_GATE_ENABLED = 'true';
    mockEvaluateResourceGate.mockReturnValue({
      hold: true,
      cpuBusyPercent: 90,
      thresholdPercent: 85,
      effectiveMaxConcurrency: 4,
    });

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);
    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockNotifyResourceContentionHold).toHaveBeenCalledTimes(2);
    expect(mockActivityLogCreate).toHaveBeenCalledTimes(2);
  });

  it('proceeds to normal selection when a pending override was just consumed', async () => {
    process.env.RAPITAS_RESOURCE_GATE_ENABLED = 'true';
    mockConsumeResourceGateOverride.mockReturnValue(true);
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockEvaluateResourceGate).not.toHaveBeenCalled();
    expect(mockSelectNextTask).toHaveBeenCalled();
    expect(mockActivityLogCreate).not.toHaveBeenCalled();
  });

  it('does not touch the gate at all when the feature flag is unset (default)', async () => {
    delete process.env.RAPITAS_RESOURCE_GATE_ENABLED;
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockEvaluateResourceGate).not.toHaveBeenCalled();
    expect(mockConsumeResourceGateOverride).not.toHaveBeenCalled();
    expect(mockSelectNextTask).toHaveBeenCalled();
  });
});
