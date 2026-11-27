/**
 * pending-update-count.test
 *
 * The progress strip shows 「更新の取り込み待ち N件」 (2026-11-27 request). N is
 * the number of updates merged into the branch since the backend booted: one
 * per merge or direct commit (first parent), not every commit inside a PR.
 */
import { describe, expect, test } from 'bun:test';
import { createPendingUpdateCounter } from './pending-update-count';

describe('pending update count', () => {
  test('counts first-parent commits from the startup commit to origin', async () => {
    const calls: string[][] = [];
    const counter = createPendingUpdateCounter({
      startupCommit: () => 'abc123',
      run: async (args) => {
        calls.push(args);
        return '3\n';
      },
      now: () => 0,
    });
    expect(await counter()).toBe(3);
    expect(calls[0]).toEqual(['rev-list', '--count', '--first-parent', 'abc123..origin/develop']);
  });

  test('is null without a startup commit or when git fails', async () => {
    const noCommit = createPendingUpdateCounter({
      startupCommit: () => null,
      run: async () => '1',
      now: () => 0,
    });
    expect(await noCommit()).toBeNull();
    const failing = createPendingUpdateCounter({
      startupCommit: () => 'abc',
      run: async () => {
        throw new Error('git failed');
      },
      now: () => 0,
    });
    expect(await failing()).toBeNull();
  });

  test('reuses the count for 30 seconds so polling does not run git each time', async () => {
    let t = 0;
    let runs = 0;
    const counter = createPendingUpdateCounter({
      startupCommit: () => 'abc',
      run: async () => String(++runs),
      now: () => t,
    });
    expect(await counter()).toBe(1);
    t = 29_000;
    expect(await counter()).toBe(1);
    t = 31_000;
    expect(await counter()).toBe(2);
  });
});
