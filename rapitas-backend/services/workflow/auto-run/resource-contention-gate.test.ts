/**
 * resource-contention-gate.test
 *
 * Table-driven coverage of the evaluateResourceGate branches (disabled,
 * concurrency<=1, nothing running yet, unsampled CPU, threshold exceeded,
 * overridden), the rapitas-only CPU basis (task 1553), the default-on flag
 * and threshold, plus the one-shot consumption contract of the override registry.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  evaluateResourceGate,
  isResourceGateEnabled,
  resolveResourceGateThreshold,
  requestResourceGateOverride,
  consumeResourceGateOverride,
  type ResourceGateInput,
} from './resource-contention-gate';

const BASE: ResourceGateInput = {
  enabled: true,
  effectiveMaxConcurrency: 4,
  activeCount: 1,
  hostCpuBusyPercent: 90,
  rapitasCpuBusyPercent: 90,
  thresholdPercent: 85,
  overridden: false,
};

describe('evaluateResourceGate', () => {
  it('never holds when the gate is disabled', () => {
    const result = evaluateResourceGate({ ...BASE, enabled: false });
    expect(result.hold).toBe(false);
  });

  it('never holds when effectiveMaxConcurrency is 1 (default, no intentional parallelism)', () => {
    const result = evaluateResourceGate({ ...BASE, effectiveMaxConcurrency: 1 });
    expect(result.hold).toBe(false);
  });

  it('fails open (no hold) when the rapitas CPU has not been sampled yet', () => {
    const result = evaluateResourceGate({ ...BASE, rapitasCpuBusyPercent: null });
    expect(result.hold).toBe(false);
  });

  it('never holds the FIRST task: nothing is running yet (activeCount 0)', () => {
    const result = evaluateResourceGate({ ...BASE, activeCount: 0, rapitasCpuBusyPercent: 100 });
    expect(result.hold).toBe(false);
  });

  it('holds when enabled, parallel, and rapitas CPU busy% is at/above the threshold', () => {
    const result = evaluateResourceGate({ ...BASE, rapitasCpuBusyPercent: 85 });
    expect(result.hold).toBe(true);
  });

  it('does not hold when rapitas CPU busy% is below the threshold', () => {
    const result = evaluateResourceGate({ ...BASE, rapitasCpuBusyPercent: 84 });
    expect(result.hold).toBe(false);
  });

  it('other applications pegging the host do not hold (host 100%, rapitas 10%)', () => {
    const result = evaluateResourceGate({
      ...BASE,
      hostCpuBusyPercent: 100,
      rapitasCpuBusyPercent: 10,
      thresholdPercent: 60,
    });
    expect(result.hold).toBe(false);
  });

  it('rapitas itself over the threshold holds even on a quiet host (host 10%, rapitas 70%)', () => {
    const result = evaluateResourceGate({
      ...BASE,
      hostCpuBusyPercent: 10,
      rapitasCpuBusyPercent: 70,
      thresholdPercent: 60,
    });
    expect(result.hold).toBe(true);
    expect(result.cpuBusyPercent).toBe(70);
    expect(result.hostCpuBusyPercent).toBe(10);
  });

  it('never holds when a manual override was just consumed', () => {
    const result = evaluateResourceGate({ ...BASE, overridden: true });
    expect(result.hold).toBe(false);
  });

  it('always echoes back the busy%/threshold/concurrency it decided on', () => {
    const result = evaluateResourceGate(BASE);
    expect(result.cpuBusyPercent).toBe(90);
    expect(result.thresholdPercent).toBe(85);
    expect(result.effectiveMaxConcurrency).toBe(4);
  });
});

describe('resource gate settings (task 1553)', () => {
  afterEach(() => {
    delete process.env.RAPITAS_RESOURCE_GATE_ENABLED;
    delete process.env.RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT;
  });

  it('is enabled by default and disabled only by false/0/off', () => {
    delete process.env.RAPITAS_RESOURCE_GATE_ENABLED;
    expect(isResourceGateEnabled()).toBe(true);
    process.env.RAPITAS_RESOURCE_GATE_ENABLED = 'true';
    expect(isResourceGateEnabled()).toBe(true);
    for (const off of ['false', '0', 'off', ' OFF ']) {
      process.env.RAPITAS_RESOURCE_GATE_ENABLED = off;
      expect(isResourceGateEnabled()).toBe(false);
    }
  });

  it('threshold defaults to 60 and is configurable; junk falls back to 60', () => {
    delete process.env.RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT;
    expect(resolveResourceGateThreshold()).toBe(60);
    process.env.RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT = '75';
    expect(resolveResourceGateThreshold()).toBe(75);
    for (const bad of ['abc', '0', '-5', '101', '']) {
      process.env.RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT = bad;
      expect(resolveResourceGateThreshold()).toBe(60);
    }
  });
});

describe('resource gate override registry', () => {
  it('consumes a pending override exactly once', () => {
    const themeId = 12345;
    requestResourceGateOverride(themeId);
    expect(consumeResourceGateOverride(themeId)).toBe(true);
    expect(consumeResourceGateOverride(themeId)).toBe(false);
  });

  it('returns false for a theme with no pending override', () => {
    expect(consumeResourceGateOverride(999999)).toBe(false);
  });
});
