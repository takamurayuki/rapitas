/**
 * retry-rollback-contract.test
 *
 * Contract between `POST /tasks/:id/retry` and the file-save guard.
 *
 * A retried task must land on a workflowStatus that can still RECORD the work
 * the re-run produces. `verify_done` cannot: its allowed-file-type set is
 * empty, so a task left there re-runs a full implementer phase and is then
 * refused when it PUTs verify.md, discarding the run (measured on task 632:
 * 15.1 min / $4.15 thrown away). The retry route therefore rolls verify_done
 * back to the implementer entry status — the same target the self-repair
 * bounce uses (resolveImplementEntryStatus).
 */
import { describe, test, expect } from 'bun:test';
import { ALLOWED_FILE_TYPES_BY_STATUS } from './shared';

/** The only two statuses resolveImplementEntryStatus can return. */
const IMPLEMENT_ENTRY_STATUSES = ['plan_approved', 'research_done'] as const;

describe('retry rollback target', () => {
  test('verify_done can record nothing — which is why parking a retry there strands it', () => {
    expect(ALLOWED_FILE_TYPES_BY_STATUS.verify_done.size).toBe(0);
    expect(ALLOWED_FILE_TYPES_BY_STATUS.completed.size).toBe(0);
  });

  test.each(IMPLEMENT_ENTRY_STATUSES)(
    'the retry rollback target %s can still save verify.md',
    (status) => {
      expect(ALLOWED_FILE_TYPES_BY_STATUS[status].has('verify')).toBe(true);
    },
  );

  test('every status a re-run can be parked at accepts at least one file type', () => {
    // Guards against a future status being added with an empty set and silently
    // becoming a second black hole for retried tasks.
    const stranding = Object.entries(ALLOWED_FILE_TYPES_BY_STATUS)
      .filter(([, allowed]) => allowed.size === 0)
      .map(([status]) => status);
    // verify_done / completed are the KNOWN terminal pair the retry route
    // explicitly rolls back from; anything else appearing here is a new bug.
    expect(stranding.sort()).toEqual(['completed', 'verify_done']);
  });
});
