/**
 * cpu-usage-monitor.test
 *
 * Verifies the cpuUsage-delta percent calculation and the enable-flag/no-op
 * contract, without touching real timers or real process.cpuUsage() output.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  computeSelfCpuPercent,
  startCpuUsageMonitorIfEnabled,
  stopCpuUsageMonitor,
} from './cpu-usage-monitor';

describe('computeSelfCpuPercent', () => {
  it('computes percent of one core from user+system microsecond deltas', () => {
    // 500ms of combined user+system CPU time over a 1000ms interval -> 50%.
    const previous: NodeJS.CpuUsage = { user: 0, system: 0 };
    const current: NodeJS.CpuUsage = { user: 300_000, system: 200_000 };
    expect(computeSelfCpuPercent(previous, current, 1000)).toBe(50);
  });

  it('can exceed 100% (multi-core burst within the interval)', () => {
    const previous: NodeJS.CpuUsage = { user: 0, system: 0 };
    const current: NodeJS.CpuUsage = { user: 1_500_000, system: 0 };
    expect(computeSelfCpuPercent(previous, current, 1000)).toBe(150);
  });

  it('returns 0 (not negative) when cpuUsage somehow ticks backward', () => {
    const previous: NodeJS.CpuUsage = { user: 100_000, system: 0 };
    const current: NodeJS.CpuUsage = { user: 50_000, system: 0 };
    expect(computeSelfCpuPercent(previous, current, 1000)).toBe(0);
  });

  it('returns null for a degenerate (non-positive) interval', () => {
    const previous: NodeJS.CpuUsage = { user: 0, system: 0 };
    const current: NodeJS.CpuUsage = { user: 100_000, system: 0 };
    expect(computeSelfCpuPercent(previous, current, 0)).toBeNull();
  });
});

describe('cpu usage monitor lifecycle', () => {
  afterEach(() => {
    stopCpuUsageMonitor();
    delete process.env.RAPITAS_CPU_MONITOR_ENABLED;
  });

  it('does not arm the sampler when the enable flag is off (default)', () => {
    delete process.env.RAPITAS_CPU_MONITOR_ENABLED;
    expect(() => startCpuUsageMonitorIfEnabled(50)).not.toThrow();
  });

  it('is safe to start and stop repeatedly when enabled', () => {
    process.env.RAPITAS_CPU_MONITOR_ENABLED = 'true';
    startCpuUsageMonitorIfEnabled(50);
    startCpuUsageMonitorIfEnabled(50); // second call must not double-arm
    stopCpuUsageMonitor();
    stopCpuUsageMonitor(); // safe to call twice
  });
});
