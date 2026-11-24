/**
 * workflow-orchestrator-overlap-guard.merge-outcome.test
 *
 * 2026-11-24: TempoRaid task 1420 was held twice for the full 30-minute
 * ceiling (and 1418 twice before it) on PR #35. That PR could not merge: it
 * conflicted with develop, and the task filed to resolve the conflict (#1529)
 * was queued behind the held task in the theme's single slot — a circular
 * wait the ceiling was the only way out of. A PR whose latest auto-merge
 * outcome is "conflict filed" merges only after outside help, like an
 * exhausted one, so it must not hold an implementer.
 */
import { describe, expect, test } from 'bun:test';
import { MERGE_OUTCOME_CAUSES, isParkedMergeOutcome } from './workflow-orchestrator-overlap-guard';

describe('isParkedMergeOutcome', () => {
  test.each(['auto_merge_exhausted', 'auto_merge_conflict_filed'])(
    'a PR whose latest auto-merge outcome is %s is parked',
    (cause) => {
      expect(isParkedMergeOutcome(cause)).toBe(true);
    },
  );

  test.each([['auto_merged'], [undefined]])('%p is not parked', (cause) => {
    expect(isParkedMergeOutcome(cause)).toBe(false);
  });

  test('the lookup reads every cause it classifies', () => {
    // A cause missing from the query can never be the "latest" one, so a
    // conflict filed after a merge attempt would be invisible.
    for (const cause of ['auto_merged', 'auto_merge_exhausted', 'auto_merge_conflict_filed']) {
      expect(MERGE_OUTCOME_CAUSES).toContain(cause);
    }
  });
});
