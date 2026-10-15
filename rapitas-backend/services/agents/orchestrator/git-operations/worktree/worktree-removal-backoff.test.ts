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
  REMOVAL_MAX_COOLDOWN_MS,
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

  // 窓が切れたら保留としては数えないが、記録そのものは残す（strike 数を保つため。
  // 旧実装は削除していたので、掃除間隔と同値の固定窓では毎回ゼロから数え直していた）。
  test('冷却期間が経過すれば保留として数えず、次の拒否が窓を開き直す', () => {
    recordRemovalRefused(WT, NOW);
    shouldSkipRemovalAttempt(WT, NOW + REMOVAL_RETRY_COOLDOWN_MS);
    expect(parkedRemovalCount(NOW + REMOVAL_RETRY_COOLDOWN_MS)).toBe(0);

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

describe('繰り返し拒否された worktree は窓が伸びる (2026-10-12)', () => {
  beforeEach(() => resetRemovalBackoff());

  // 実測 2026-10-12: クールダウン 30 分が掃除間隔 30 分
  // (worktree-cleanup-scheduler の defaultIntervalMs) と同値だったため、次の掃除が
  // 来た時点で窓はちょうど切れており、毎回全件が再試行されていた。再起動後2時間で
  // 7 件 × 掃除5回 = WARN 80 行、対象はすべて `Missing Git metadata`
  // (= .git が無く git worktree remove では永久に削除不能)。
  // 固定窓は掃除間隔と衝突しうるので、拒否が続くほど窓を伸ばす。
  test('初回の窓は従来どおり、2回目以降は倍に伸びる', () => {
    recordRemovalRefused(WT, NOW);
    // 初回: 30 分ちょうどでは切れている（従来の挙動を保つ）
    expect(shouldSkipRemovalAttempt(WT, NOW + REMOVAL_RETRY_COOLDOWN_MS)).toBe(false);

    // 2 回目の拒否 → 窓は 2 倍
    recordRemovalRefused(WT, NOW);
    expect(shouldSkipRemovalAttempt(WT, NOW + REMOVAL_RETRY_COOLDOWN_MS)).toBe(true);
    expect(shouldSkipRemovalAttempt(WT, NOW + REMOVAL_RETRY_COOLDOWN_MS * 2)).toBe(false);
  });

  test('掃除間隔と同値でも 2 回目以降はスキップされる（本件の再現）', () => {
    const SWEEP = REMOVAL_RETRY_COOLDOWN_MS; // 30 分
    let t = NOW;
    let attempts = 0;
    for (let sweep = 0; sweep < 6; sweep += 1) {
      if (!shouldSkipRemovalAttempt(WT, t)) {
        attempts += 1;
        recordRemovalRefused(WT, t); // 常に拒否される worktree
      }
      t += SWEEP;
    }
    // 修正前は 6 回すべて試行していた。指数的に伸びるので大幅に減る。
    expect(attempts).toBeLessThanOrEqual(3);
  });

  test('窓には上限がある（恒久スキップにはしない）', () => {
    for (let i = 0; i < 20; i += 1) recordRemovalRefused(WT, NOW);
    expect(shouldSkipRemovalAttempt(WT, NOW + REMOVAL_MAX_COOLDOWN_MS)).toBe(false);
  });

  test('削除成功で窓の伸びもリセットされる', () => {
    recordRemovalRefused(WT, NOW);
    recordRemovalRefused(WT, NOW);
    recordRemovalRefused(WT, NOW);
    clearRemovalRefusal(WT);
    recordRemovalRefused(WT, NOW);
    // 1 回目に戻るので 30 分で切れる
    expect(shouldSkipRemovalAttempt(WT, NOW + REMOVAL_RETRY_COOLDOWN_MS)).toBe(false);
  });
});
