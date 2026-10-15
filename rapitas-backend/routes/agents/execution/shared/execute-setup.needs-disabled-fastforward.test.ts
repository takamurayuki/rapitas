/**
 * execute-setup.needs-disabled-fastforward.test
 *
 * Pure-function coverage for needsDisabledFastForward: determines which
 * workflowStatus values a workflow-disabled task must be fast-forwarded past
 * (to 'plan_approved') so its direct verify.md PUT is accepted by
 * ALLOWED_FILE_TYPES_BY_STATUS in workflow-handlers-files.ts.
 */
import { describe, test, expect } from 'bun:test';
import { needsDisabledFastForward } from './execute-setup';

describe('needsDisabledFastForward', () => {
  test.each([
    [null, true],
    [undefined, true],
    ['draft', true],
    ['plan_created', true],
  ])('needs fast-forward for %s', (status, expected) => {
    expect(needsDisabledFastForward(status)).toBe(expected);
  });

  test.each([
    ['research_done', false],
    ['plan_approved', false],
    ['in_progress', false],
    ['awaiting_question', false],
    ['verify_done', false],
    ['completed', false],
  ])('does not need fast-forward for %s (already allows a verify save)', (status, expected) => {
    expect(needsDisabledFastForward(status)).toBe(expected);
  });
});
