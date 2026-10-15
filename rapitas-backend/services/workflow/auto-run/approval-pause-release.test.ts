/**
 * approval-pause-release tests
 *
 * The decision is pure, so these tests exercise the predicate directly rather
 * than standing up a scheduler: what must never regress is WHICH approval
 * pauses may be released, not how the release is written.
 */
import { describe, it, expect } from 'bun:test';
import {
  decideApprovalPauseRelease,
  APPROVAL_PAUSE_RELEASE_CAUSE,
  type ApprovalPauseFacts,
} from './approval-pause-release';

const base: ApprovalPauseFacts = {
  pauseStatus: 'paused_approval',
  planApproved: false,
  autoRunExcluded: false,
  forbiddenChangeHeld: false,
  manualRejectionHeld: false,
};

describe('decideApprovalPauseRelease', () => {
  it('releases a pause whose task the operator excluded from selection', () => {
    // Measured 2026-10-15: PATCH /tasks/1259 {autoRunExcluded:true} dropped the
    // theme's remainingCount 7 -> 6 but left it paused on 1259 for 7 more
    // minutes, because nothing in the paused-theme path reads this flag.
    const d = decideApprovalPauseRelease({ ...base, autoRunExcluded: true });
    expect(d?.reason).toBe('operator_excluded');
    // Already excluded, so selection cannot pick it again — nothing to write.
    expect(d?.excludeFromAutoRun).toBe(false);
  });

  it('releases a pause held for a human forbidden-change override', () => {
    // forbidden-change-plan-hold keeps the task at plan_created until a human
    // overrides, so neither of the two existing exits can ever fire.
    const d = decideApprovalPauseRelease({ ...base, forbiddenChangeHeld: true });
    expect(d?.reason).toBe('forbidden_change_hold');
    // Must be written, or the selector re-picks the task and it re-pauses.
    expect(d?.excludeFromAutoRun).toBe(true);
  });

  it('keeps an ordinary approval wait paused', () => {
    expect(decideApprovalPauseRelease(base)).toBeNull();
  });

  it('keeps the pause when the plan is already approved', () => {
    // The existing resume path owns this case; releasing here would race it.
    expect(
      decideApprovalPauseRelease({ ...base, planApproved: true, forbiddenChangeHeld: true }),
    ).toBeNull();
  });

  it('never releases a user-initiated pause', () => {
    // task 883: an explicit user pause must not be silently overridden.
    expect(
      decideApprovalPauseRelease({
        ...base,
        pauseStatus: 'paused_user',
        autoRunExcluded: true,
        forbiddenChangeHeld: true,
      }),
    ).toBeNull();
  });

  it('never releases the reason-unknown legacy pause', () => {
    expect(
      decideApprovalPauseRelease({
        ...base,
        pauseStatus: 'paused',
        autoRunExcluded: true,
        forbiddenChangeHeld: true,
      }),
    ).toBeNull();
  });

  it('leaves a manually rejected plan paused', () => {
    // revise-plan re-dispatches the planner for a rejected plan; excluding the
    // task from selection would break that recovery path.
    expect(decideApprovalPauseRelease({ ...base, manualRejectionHeld: true })).toBeNull();
  });

  it('prefers the operator exclusion when both reasons apply', () => {
    // An already-excluded task needs no write, even under a forbidden-change hold.
    const d = decideApprovalPauseRelease({
      ...base,
      autoRunExcluded: true,
      forbiddenChangeHeld: true,
    });
    expect(d?.reason).toBe('operator_excluded');
    expect(d?.excludeFromAutoRun).toBe(false);
  });

  it('exposes a stable transition cause', () => {
    expect(APPROVAL_PAUSE_RELEASE_CAUSE).toBe('approval_pause_released');
  });
});
