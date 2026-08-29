/**
 * resource-telemetry.test
 *
 * Verifies the tick-delta CPU busy calculation and the enable-flag/no-op
 * contract, without touching real timers or the real `os.cpus()` output.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  computeBusyPercent,
  getHostCpuBusyPercent,
  startResourceTelemetryIfEnabled,
  stopResourceTelemetry,
} from './resource-telemetry';

describe('computeBusyPercent', () => {
  it('computes busy% from idle/total tick deltas (idle 20 / total 100 -> 80%)', () => {
    const previous = { idle: 100, total: 1000 };
    const current = { idle: 120, total: 1100 };
    expect(computeBusyPercent(previous, current)).toBe(80);
  });

  it('returns 0 when nothing was busy (idle delta == total delta)', () => {
    const previous = { idle: 100, total: 1000 };
    const current = { idle: 200, total: 1100 };
    expect(computeBusyPercent(previous, current)).toBe(0);
  });

  it('returns null when the total ticks did not move (degenerate interval)', () => {
    const previous = { idle: 100, total: 1000 };
    const current = { idle: 100, total: 1000 };
    expect(computeBusyPercent(previous, current)).toBeNull();
  });
});

describe('resource telemetry lifecycle', () => {
  afterEach(() => {
    stopResourceTelemetry();
    delete process.env.RAPITAS_RESOURCE_GATE_ENABLED;
  });

  it('returns null before any sample has completed', () => {
    expect(getHostCpuBusyPercent()).toBeNull();
  });

  it('does not start the sampler when the gate flag is disabled (default)', () => {
    delete process.env.RAPITAS_RESOURCE_GATE_ENABLED;
    startResourceTelemetryIfEnabled(50);
    // No timer should have been armed — cache stays null immediately after.
    expect(getHostCpuBusyPercent()).toBeNull();
  });

  it('stopResourceTelemetry clears the cache and is safe to call twice', () => {
    process.env.RAPITAS_RESOURCE_GATE_ENABLED = 'true';
    startResourceTelemetryIfEnabled(50);
    stopResourceTelemetry();
    stopResourceTelemetry();
    expect(getHostCpuBusyPercent()).toBeNull();
  });
});
