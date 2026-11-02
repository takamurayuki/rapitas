/**
 * rapi-avatar-state.test
 *
 * What the avatar is showing, decided from the workflow phases the backend
 * broadcasts. The rules worth pinning are the priority order and the two
 * timed states — `error` clears itself, `waiting` does not, because one is
 * news and the other is a job for the user.
 */
import { describe, it, expect } from 'vitest';
import {
  applyPhase,
  resolveAvatarState,
  DONE_HOLD_MS,
  ERROR_HOLD_MS,
  type AvatarSignals,
} from '../rapi-avatar-state';

const NOW = 1_000_000;

/** Signals with nothing happening. */
const quiet = (): AvatarSignals => ({
  phases: {},
  errorAt: null,
  doneAt: null,
  activeExecutions: 0,
  interruptedCount: 0,
});

describe('applyPhase', () => {
  it('records the phase a task moved to', () => {
    expect(applyPhase({}, 7, 'plan_approved')).toEqual({ 7: 'plan_approved' });
  });

  it('replaces the previous phase for that task', () => {
    expect(applyPhase({ 7: 'draft' }, 7, 'research_done')).toEqual({ 7: 'research_done' });
  });

  it('keeps other tasks', () => {
    expect(applyPhase({ 7: 'draft' }, 8, 'in_progress')).toEqual({ 7: 'draft', 8: 'in_progress' });
  });

  // The runner emits `previousPhase → advancing` on EVERY poll tick, so
  // acting on it would make the avatar flicker at the poll rate.
  it('ignores the advancing pseudo-phase', () => {
    expect(applyPhase({ 7: 'in_progress' }, 7, 'advancing')).toEqual({ 7: 'in_progress' });
  });

  it('drops a task that finished', () => {
    expect(applyPhase({ 7: 'in_progress' }, 7, 'completed')).toEqual({});
    expect(applyPhase({ 7: 'in_progress' }, 7, 'verify_done')).toEqual({});
  });

  // Blocked is reported as a timed error instead; leaving it in the map
  // would hold the avatar on that task forever.
  it('drops a task that blocked', () => {
    expect(applyPhase({ 7: 'in_progress' }, 7, 'blocked')).toEqual({});
  });
});

describe('resolveAvatarState', () => {
  it('is idle with nothing happening', () => {
    expect(resolveAvatarState(quiet(), NOW).state).toBe('idle');
  });

  it('thinks while a task is being researched or planned', () => {
    for (const phase of ['draft', 'research_done']) {
      expect(resolveAvatarState({ ...quiet(), phases: { 7: phase } }, NOW).state).toBe('thinking');
    }
  });

  it('runs while a task is being implemented or verified', () => {
    for (const phase of ['plan_approved', 'in_progress']) {
      expect(resolveAvatarState({ ...quiet(), phases: { 7: phase } }, NOW).state).toBe('running');
    }
  });

  it('waits while a task needs an approval or an answer', () => {
    for (const phase of ['plan_created', 'awaiting_question']) {
      expect(resolveAvatarState({ ...quiet(), phases: { 7: phase } }, NOW).state).toBe('waiting');
    }
  });

  // An execution with no phase event yet still means work is happening —
  // the avatar should not sit idle through it.
  it('runs on a live execution even before any phase arrives', () => {
    expect(resolveAvatarState({ ...quiet(), activeExecutions: 1 }, NOW).state).toBe('running');
  });
});

describe('the states that time out', () => {
  it('shows an error, then lets it go', () => {
    const signals = { ...quiet(), errorAt: NOW };
    expect(resolveAvatarState(signals, NOW).state).toBe('error');
    expect(resolveAvatarState(signals, NOW + ERROR_HOLD_MS - 1).state).toBe('error');
    expect(resolveAvatarState(signals, NOW + ERROR_HOLD_MS).state).toBe('idle');
  });

  it('shows done, then lets it go', () => {
    const signals = { ...quiet(), doneAt: NOW };
    expect(resolveAvatarState(signals, NOW).state).toBe('done');
    expect(resolveAvatarState(signals, NOW + DONE_HOLD_MS).state).toBe('idle');
  });

  // Chosen deliberately: this machine carries chronically blocked tasks, so
  // a lasting error would leave the avatar red forever and say nothing.
  it('does not keep an error the way it keeps a wait', () => {
    const old = NOW - ERROR_HOLD_MS - 1;
    expect(resolveAvatarState({ ...quiet(), errorAt: old }, NOW).state).toBe('idle');
    expect(resolveAvatarState({ ...quiet(), phases: { 7: 'plan_created' } }, NOW).state).toBe(
      'waiting',
    );
  });
});

/** error > waiting > running > thinking > done > idle. */
describe('priority', () => {
  it('puts a fresh error above everything', () => {
    const state = resolveAvatarState(
      {
        phases: { 1: 'plan_created', 2: 'in_progress' },
        errorAt: NOW,
        doneAt: NOW,
        activeExecutions: 2,
        interruptedCount: 0,
      },
      NOW,
    ).state;
    expect(state).toBe('error');
  });

  it('puts a wait above work', () => {
    const state = resolveAvatarState(
      {
        phases: { 1: 'plan_created', 2: 'in_progress' },
        errorAt: null,
        doneAt: null,
        activeExecutions: 2,
        interruptedCount: 0,
      },
      NOW,
    ).state;
    expect(state).toBe('waiting');
  });

  it('puts running above thinking', () => {
    const state = resolveAvatarState(
      { ...quiet(), phases: { 1: 'draft', 2: 'in_progress' } },
      NOW,
    ).state;
    expect(state).toBe('running');
  });

  it('puts thinking above a lingering done', () => {
    const state = resolveAvatarState(
      { ...quiet(), phases: { 1: 'draft' }, doneAt: NOW },
      NOW,
    ).state;
    expect(state).toBe('thinking');
  });
});

describe('how many comets', () => {
  it('shows one per running execution', () => {
    expect(resolveAvatarState({ ...quiet(), activeExecutions: 3 }, NOW).agents).toBe(3);
  });

  it('shows at least one while running', () => {
    expect(resolveAvatarState({ ...quiet(), phases: { 1: 'in_progress' } }, NOW).agents).toBe(1);
  });

  // The avatar only draws up to four; more would be an unreadable smear.
  it('stops at four', () => {
    expect(resolveAvatarState({ ...quiet(), activeExecutions: 9 }, NOW).agents).toBe(4);
  });
});

/**
 * The avatar absorbed the resumable-executions banner, so it is now the
 * only sign that interrupted work is sitting there. That makes it a job
 * for the user, like an approval — and it holds until they deal with it.
 */
describe('interrupted work', () => {
  it('waits while something can be resumed', () => {
    expect(resolveAvatarState({ ...quiet(), interruptedCount: 2 }, NOW).state).toBe('waiting');
  });

  it('does not wait when there is none', () => {
    expect(resolveAvatarState({ ...quiet(), interruptedCount: 0 }, NOW).state).toBe('idle');
  });

  it('still lets a fresh error through first', () => {
    const signals = { ...quiet(), interruptedCount: 2, errorAt: NOW };
    expect(resolveAvatarState(signals, NOW).state).toBe('error');
  });

  // Running work is visible on its own; interrupted work is not, so it
  // keeps the higher claim on the user's attention.
  it('outranks work in progress', () => {
    const signals = { ...quiet(), interruptedCount: 1, activeExecutions: 2 };
    expect(resolveAvatarState(signals, NOW).state).toBe('waiting');
  });
});
