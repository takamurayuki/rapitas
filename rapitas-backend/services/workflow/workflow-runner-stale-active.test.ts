/**
 * workflow-runner-stale-active.test
 *
 * The rule has to clear a wedge WITHOUT aborting healthy work, so both
 * directions are pinned: an entry the DB no longer calls running is dropped,
 * and one it does — or one too young to judge — is kept.
 */

import { describe, expect, it } from 'bun:test';
import {
  STALE_ACTIVE_GRACE_MS,
  findStaleActiveEntries,
  type ActiveEntryLike,
} from './workflow-runner-stale-active';

const NOW = Date.parse('2026-10-09T06:00:00.000Z');
const entry = (queueItemId: number, taskId: number, ageMs: number): ActiveEntryLike => ({
  queueItemId,
  taskId,
  startedAt: new Date(NOW - ageMs),
});

const OLD = STALE_ACTIVE_GRACE_MS + 1_000;

describe('findStaleActiveEntries', () => {
  it('drops an entry whose item the DB no longer reports as running', () => {
    // The measured wedge: item 4172 was cancelled by the sweep while its
    // in-memory entry stayed, pinning concurrency 1 forever (#1165).
    const stale = findStaleActiveEntries([entry(4172, 1159, OLD)], [], NOW);
    expect(stale.map((e) => e.queueItemId)).toEqual([4172]);
  });

  it('keeps an entry the DB still reports as running', () => {
    expect(findStaleActiveEntries([entry(4180, 1200, OLD)], [4180], NOW)).toEqual([]);
  });

  it('keeps a young entry even when the DB no longer calls it running', () => {
    // A normal completion flips the row before the finally removes the entry;
    // judging that instant as a wedge would abort healthy work.
    expect(findStaleActiveEntries([entry(4181, 1201, 5_000)], [], NOW)).toEqual([]);
  });

  it('treats an entry exactly at the grace boundary as stale', () => {
    const stale = findStaleActiveEntries([entry(4182, 1202, STALE_ACTIVE_GRACE_MS)], [], NOW);
    expect(stale.map((e) => e.queueItemId)).toEqual([4182]);
  });

  it('separates stale from healthy in one pass', () => {
    const stale = findStaleActiveEntries(
      [entry(1, 10, OLD), entry(2, 20, OLD), entry(3, 30, 1_000)],
      [2],
      NOW,
    );
    expect(stale.map((e) => e.queueItemId)).toEqual([1]);
  });

  it('returns the oldest first, so the longest-held slot is freed first', () => {
    const stale = findStaleActiveEntries(
      [entry(9, 90, OLD), entry(7, 70, OLD + 60_000), entry(8, 80, OLD + 30_000)],
      [],
      NOW,
    );
    expect(stale.map((e) => e.queueItemId)).toEqual([7, 8, 9]);
  });

  it('does nothing when there are no entries', () => {
    expect(findStaleActiveEntries([], [], NOW)).toEqual([]);
  });

  it('honours an explicit grace period', () => {
    const e = [entry(5, 50, 10_000)];
    expect(findStaleActiveEntries(e, [], NOW, 5_000).map((x) => x.queueItemId)).toEqual([5]);
    expect(findStaleActiveEntries(e, [], NOW, 30_000)).toEqual([]);
  });
});
