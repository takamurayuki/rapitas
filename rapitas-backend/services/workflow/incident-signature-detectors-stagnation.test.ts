/**
 * incident-signature-detectors-stagnation.test
 *
 * Boundary tests for detectStagnation: each guard condition flips detection
 * off exactly once, and the threshold detects at >= (inclusive).
 * No DB, no mocks — every input is a plain snapshot.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectStagnation,
  STAGNATION_THRESHOLD_MS,
  type StagnationInput,
} from './incident-signature-detectors';

const NOW = 1_000_000_000_000;

describe('detectStagnation', () => {
  // A stagnant in-progress task: idle beyond the threshold, nothing running,
  // nothing queued, no legitimate wait state. Each test below flips ONE guard.
  const base: StagnationInput = {
    taskStatus: 'in-progress',
    workflowStatus: 'in_progress',
    lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS - 60_000,
    hasLiveExecution: false,
    hasAnyExecution: false,
    hasActiveQueueItem: false,
    nowMs: NOW,
  };

  it('detects a stale non-terminal task with no execution and no queue item', () => {
    const result = detectStagnation(base);
    expect(result).not.toBeNull();
    expect(result?.staleMs).toBe(STAGNATION_THRESHOLD_MS + 60_000);
  });

  it('detects at exactly the threshold (>= boundary)', () => {
    const result = detectStagnation({
      ...base,
      lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS,
    });
    expect(result).toEqual({ staleMs: STAGNATION_THRESHOLD_MS });
  });

  it('does NOT detect 1ms under the threshold', () => {
    expect(
      detectStagnation({ ...base, lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS + 1 }),
    ).toBeNull();
  });

  it.each([
    { name: 'a live execution exists', over: { hasLiveExecution: true } },
    { name: 'an active queue item exists', over: { hasActiveQueueItem: true } },
    {
      name: 'the task awaits a user answer',
      over: { workflowStatus: 'awaiting_question' },
    },
    { name: 'the workflow already completed', over: { workflowStatus: 'completed' } },
    { name: 'the task status is done', over: { taskStatus: 'done' } },
    { name: 'the task status is cancelled', over: { taskStatus: 'cancelled' } },
  ])('does NOT detect when $name', ({ over }) => {
    expect(detectStagnation({ ...base, ...over })).toBeNull();
  });

  it('still detects a blocked task (blocked is not terminal)', () => {
    expect(detectStagnation({ ...base, taskStatus: 'blocked' })).not.toBeNull();
  });

  // 受入(a): a never-started todo backlog item is out of scope no matter how stale.
  it('does NOT detect a pure todo backlog item (draft workflow, no execution ever)', () => {
    expect(
      detectStagnation({
        ...base,
        taskStatus: 'todo',
        workflowStatus: 'draft',
        lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS - 4 * 60_000, // 34m stale
      }),
    ).toBeNull();
  });

  it('does NOT detect a not-started task with workflowStatus=null (null guard)', () => {
    expect(detectStagnation({ ...base, taskStatus: 'todo', workflowStatus: null })).toBeNull();
  });

  // Each in-flight branch alone re-enables detection.
  it.each([
    { name: 'the workflow ever advanced past draft', over: { workflowStatus: 'research_done' } },
    { name: 'any execution ever existed', over: { hasAnyExecution: true } },
    { name: 'the task status is in-progress', over: { taskStatus: 'in-progress' } },
  ])('still detects when $name (single in-flight branch)', ({ over }) => {
    expect(
      detectStagnation({
        ...base,
        taskStatus: 'todo',
        workflowStatus: 'draft',
        ...over,
      }),
    ).not.toBeNull();
  });

  it('honors a custom thresholdMs override', () => {
    const custom = { ...base, lastActivityAtMs: NOW - 5_000, thresholdMs: 4_000 };
    expect(detectStagnation(custom)).toEqual({ staleMs: 5_000 });
    expect(detectStagnation({ ...custom, thresholdMs: 6_000 })).toBeNull();
  });
});
