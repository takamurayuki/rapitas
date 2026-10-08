/**
 * worktree-removal-backoff.test
 *
 * Fixtures follow the 2026-10-06 measurement: cleanupStaleWorktrees runs on every
 * worker (re)init and re-attempted ~60 unremovable worktrees per sweep, producing
 * 423 log lines and five event-loop stalls inside one 894-second window.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  shouldSkipRemovalAttempt,
  recordRemovalRefused,
  clearRemovalRefusal,
  parkedRemovalCount,
  resetRemovalBackoff,
  REMOVAL_RETRY_COOLDOWN_MS,
} from './worktree-removal-backoff';

const WT = 'c:/projects/rapitas/.worktrees/task-997-b5316679';
const NOW = 1_800_000_000_000;

beforeEach(() => {
  resetRemovalBackoff();
});

describe('worktree removal backoff', () => {
  // Fails toward attempting: a path never seen before must always be tried.
  test('未知のパスは必ず試行する', () => {
    expect(shouldSkipRemovalAttempt(WT, NOW)).toBe(false);
  });

  test('拒否を記録した直後の再試行は省略する（worker 再起動ごとの再走を無効化）', () => {
    recordRemovalRefused(WT, NOW);
    expect(shouldSkipRemovalAttempt(WT, NOW)).toBe(true);
    expect(shouldSkipRemovalAttempt(WT, NOW + 60_000)).toBe(true);
    expect(shouldSkipRemovalAttempt(WT, NOW + REMOVAL_RETRY_COOLDOWN_MS - 1)).toBe(true);
  });

  // The cooldown must not be permanent: "uncommitted work" becomes removable the
  // moment someone commits it.
  test('冷却期間を過ぎれば再び試行する（恒久的に放置しない）', () => {
    recordRemovalRefused(WT, NOW);
    expect(shouldSkipRemovalAttempt(WT, NOW + REMOVAL_RETRY_COOLDOWN_MS)).toBe(false);
  });

  test('冷却期間の経過で記録を忘れ、次の拒否が新しい窓を開始する', () => {
    recordRemovalRefused(WT, NOW);
    shouldSkipRemovalAttempt(WT, NOW + REMOVAL_RETRY_COOLDOWN_MS);
    expect(parkedRemovalCount()).toBe(0);

    recordRemovalRefused(WT, NOW + REMOVAL_RETRY_COOLDOWN_MS);
    expect(shouldSkipRemovalAttempt(WT, NOW + REMOVAL_RETRY_COOLDOWN_MS + 1)).toBe(true);
  });

  test('削除に成功したら記録を消す', () => {
    recordRemovalRefused(WT, NOW);
    clearRemovalRefusal(WT);
    expect(shouldSkipRemovalAttempt(WT, NOW)).toBe(false);
    expect(parkedRemovalCount()).toBe(0);
  });

  test('パスごとに独立して管理する', () => {
    const other = 'c:/projects/rapitas/.worktrees/task-1015-dd9fdc24';
    recordRemovalRefused(WT, NOW);
    expect(shouldSkipRemovalAttempt(other, NOW)).toBe(false);
    expect(parkedRemovalCount()).toBe(1);
  });

  // The whole point: N sweeps over the same unremovable worktree cost one attempt.
  test('同一 worktree への 20 回のスイープで試行は 1 回に収まる', () => {
    let attempts = 0;
    for (let i = 0; i < 20; i++) {
      if (shouldSkipRemovalAttempt(WT, NOW + i * 1_000)) continue;
      attempts++;
      recordRemovalRefused(WT, NOW + i * 1_000);
    }
    expect(attempts).toBe(1);
  });
});
