/**
 * probe-cache.test
 *
 * TTL boundary tests for the per-task probe result cache: success caches for
 * PROBE_SUCCESS_TTL_MS, a permanent failure only for PROBE_FAILURE_TTL_MS,
 * and invalidateProbeCache clears per-task or globally.
 */
import { describe, it, expect } from 'bun:test';
import {
  getCachedProbeResult,
  setCachedProbeResult,
  invalidateProbeCache,
  PROBE_SUCCESS_TTL_MS,
  PROBE_FAILURE_TTL_MS,
} from './probe-cache';

describe('probe-cache', () => {
  it('returns null on a miss', () => {
    expect(getCachedProbeResult(9001, 'db', 0)).toBeNull();
  });

  it('caches a success result for PROBE_SUCCESS_TTL_MS', () => {
    const taskId = 9002;
    setCachedProbeResult(taskId, 'db', 'success', 1000);

    expect(getCachedProbeResult(taskId, 'db', 1000 + PROBE_SUCCESS_TTL_MS - 1)).toBe('success');
    expect(getCachedProbeResult(taskId, 'db', 1000 + PROBE_SUCCESS_TTL_MS)).toBeNull();
  });

  it('caches a permanent failure for the shorter PROBE_FAILURE_TTL_MS', () => {
    const taskId = 9003;
    setCachedProbeResult(taskId, 'agent-endpoint', 'permanent_failure', 1000);

    expect(getCachedProbeResult(taskId, 'agent-endpoint', 1000 + PROBE_FAILURE_TTL_MS - 1)).toBe(
      'permanent_failure',
    );
    expect(getCachedProbeResult(taskId, 'agent-endpoint', 1000 + PROBE_FAILURE_TTL_MS)).toBeNull();
  });

  it('keeps per-target entries independent', () => {
    const taskId = 9004;
    setCachedProbeResult(taskId, 'db', 'success', 1000);

    expect(getCachedProbeResult(taskId, 'agent-endpoint', 1000)).toBeNull();
  });

  it('invalidateProbeCache(taskId) clears only that task', () => {
    setCachedProbeResult(9005, 'db', 'success', 1000);
    setCachedProbeResult(9006, 'db', 'success', 1000);

    invalidateProbeCache(9005);

    expect(getCachedProbeResult(9005, 'db', 1000)).toBeNull();
    expect(getCachedProbeResult(9006, 'db', 1000)).toBe('success');
  });

  it('invalidateProbeCache() with no argument clears everything', () => {
    setCachedProbeResult(9007, 'db', 'success', 1000);

    invalidateProbeCache();

    expect(getCachedProbeResult(9007, 'db', 1000)).toBeNull();
  });
});
