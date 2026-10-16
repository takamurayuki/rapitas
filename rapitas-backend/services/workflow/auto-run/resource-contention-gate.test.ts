/**
 * resource-contention-gate.test
 *
 * Table-driven coverage of the five evaluateResourceGate branches (disabled,
 * concurrency<=1, unsampled CPU, threshold exceeded, overridden), plus the
 * one-shot consumption contract of the override registry.
 */
import { describe, it, expect } from 'bun:test';
import {
  evaluateResourceGate,
  requestResourceGateOverride,
  consumeResourceGateOverride,
  type ResourceGateInput,
} from './resource-contention-gate';

const BASE: ResourceGateInput = {
  enabled: true,
  effectiveMaxConcurrency: 4,
  hostCpuBusyPercent: 90,
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

  it('fails open (no hold) when the host CPU has not been sampled yet', () => {
    const result = evaluateResourceGate({ ...BASE, hostCpuBusyPercent: null });
    expect(result.hold).toBe(false);
  });

  it('holds when enabled, parallel, and CPU busy% is at/above the threshold', () => {
    const result = evaluateResourceGate({ ...BASE, hostCpuBusyPercent: 85, thresholdPercent: 85 });
    expect(result.hold).toBe(true);
  });

  it('does not hold when CPU busy% is below the threshold', () => {
    const result = evaluateResourceGate({ ...BASE, hostCpuBusyPercent: 84, thresholdPercent: 85 });
    expect(result.hold).toBe(false);
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
