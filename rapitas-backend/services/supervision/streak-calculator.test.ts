/**
 * streak-calculator tests
 *
 * The hands-off bar: 10 untainted completed tasks AND 24 observed hours since the
 * latest intervention / failure / gate mutation, with unobserved time subtracted
 * and missing evidence reported as unmet.
 */
import { describe, expect, mock, test } from 'bun:test';
import { createTimelineFake } from './testing/timeline-fake';

const fake = createTimelineFake();
mock.module('../memory/timeline', () => fake.module);
mock.module('../../config/database', () => ({ prisma: {} }));

const { calculateStreak } = await import('./streak-calculator');
type StreakInput = import('./streak-calculator').StreakInput;

const H = 3_600_000;
const NOW = new Date('2026-09-12T00:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * H);

/** 10 completions spread over the last 26h, observed continuously for 72h. */
function healthyInput(overrides: Partial<StreakInput> = {}): StreakInput {
  return {
    now: NOW,
    horizonStart: ago(72),
    interventions: [{ at: ago(30), taskId: 1 }],
    failures: [],
    completions: Array.from({ length: 10 }, (_, i) => ({ at: ago(26 - i * 2), taskId: 100 + i })),
    gateMutation: { at: ago(40), observable: true },
    gaps: [],
    firstHeartbeatAt: ago(72),
    lastHeartbeatAt: ago(0.01),
    heartbeatIntervalMs: 60_000,
    heartbeatHistoryTruncated: false,
    ...overrides,
  };
}

describe('calculateStreak', () => {
  test('meets the bar with 10 tasks and 30 observed hours', () => {
    const r = calculateStreak(healthyInput());
    expect(r.reasonCodes).toEqual([]);
    expect(r.conditionMet).toBe(true);
    expect(r.streakCount).toBe(10);
    expect(r.observedHours).toBeCloseTo(30, 1);
  });

  test('fewer than 10 tasks is unmet', () => {
    const input = healthyInput();
    const r = calculateStreak({ ...input, completions: input.completions.slice(0, 9) });
    expect(r.conditionMet).toBe(false);
    expect(r.reasonCodes).toContain('streak_task_count_below_threshold');
  });

  test('under 24h since the last intervention is unmet and names the reset', () => {
    const input = healthyInput({ interventions: [{ at: ago(20), taskId: 1 }] });
    const r = calculateStreak({
      ...input,
      completions: Array.from({ length: 10 }, (_, i) => ({ at: ago(19 - i), taskId: 200 + i })),
    });
    expect(r.streakCount).toBe(10);
    expect(r.reasonCodes).toContain('streak_duration_below_threshold');
    expect(r.reasonCodes).toContain('recent_intervention');
  });

  test('an intervention resets the task count', () => {
    const r = calculateStreak(healthyInput({ interventions: [{ at: ago(1), taskId: 1 }] }));
    expect(r.streakCount).toBe(0);
    expect(r.resetKind).toBe('intervention');
  });

  test('a gate mutation (this task landing) resets the streak to 0', () => {
    const r = calculateStreak(healthyInput({ gateMutation: { at: ago(0.5), observable: true } }));
    expect(r.streakCount).toBe(0);
    expect(r.reasonCodes).toContain('self_gate_mutation');
  });

  test('a failure resets and is reported, not dropped from the population', () => {
    const r = calculateStreak(healthyInput({ failures: [{ at: ago(2), taskId: 999 }] }));
    expect(r.conditionMet).toBe(false);
    expect(r.reasonCodes).toContain('failure_or_interruption_in_streak');
  });

  test('a completed task that had an earlier intervention is excluded from the count', () => {
    const r = calculateStreak(healthyInput({ interventions: [{ at: ago(30), taskId: 100 }] }));
    expect(r.streakCount).toBe(9);
    expect(r.excludedTaskIds).toEqual([100]);
  });

  test('observation gaps are subtracted from hands-off time', () => {
    const r = calculateStreak(healthyInput({ gaps: [{ startAt: ago(28), endAt: ago(20) }] }));
    expect(r.observedHours).toBeCloseTo(22, 1);
    expect(r.observedGapMinutes).toBeCloseTo(480, 0);
    expect(r.reasonCodes).toContain('streak_duration_below_threshold');
  });

  test('time before the first heartbeat is not credited', () => {
    const r = calculateStreak(healthyInput({ firstHeartbeatAt: ago(10) }));
    expect(r.observedHours).toBeCloseTo(10, 1);
    expect(r.conditionMet).toBe(false);
  });

  test('an ongoing silence counts as a gap and flags a stale monitor', () => {
    const r = calculateStreak(healthyInput({ lastHeartbeatAt: ago(5) }));
    expect(r.reasonCodes).toContain('monitor_heartbeat_stale');
    expect(r.observedHours).toBeCloseTo(25, 1);
  });

  test('zero events is no_observation_evidence, never hands-off success', () => {
    const r = calculateStreak(
      healthyInput({
        interventions: [],
        completions: [],
        gateMutation: { at: null, observable: true },
        firstHeartbeatAt: null,
        lastHeartbeatAt: null,
      }),
    );
    expect(r.conditionMet).toBe(false);
    expect(r.reasonCodes).toContain('no_observation_evidence');
    expect(r.streakCount).toBe(0);
  });

  test('unobservable git and truncated history are unmet', () => {
    const r = calculateStreak(
      healthyInput({
        gateMutation: { at: null, observable: false },
        heartbeatHistoryTruncated: true,
      }),
    );
    expect(r.reasonCodes).toContain('gate_mutation_unobservable');
    expect(r.reasonCodes).toContain('observation_history_truncated');
  });
});
