/**
 * orphan-flag-policy.test
 *
 * 2026-09-27: マージ待ち(verify_done)の 1106 に「長時間進行中のまま実行が見当たり
 * ません。再実行をご検討ください」という通知が出た。25 分後に PR はマージされて
 * おり、助言に従えば進行中の公開処理を捨てていた。requeueOrphanTasks は同じ条件を
 * 既に除外していたが、通知側は除外していなかった。
 */
import { describe, expect, test } from 'bun:test';
import { shouldFlagOrphanTask } from './orphan-flag-policy';

describe('shouldFlagOrphanTask', () => {
  test('通常の進行中タスクは通知する', () => {
    expect(shouldFlagOrphanTask('in_progress', false)).toBe(true);
    expect(shouldFlagOrphanTask('plan_approved', false)).toBe(true);
    expect(shouldFlagOrphanTask(null, false)).toBe(true);
  });

  test.each([
    ['completed(別経路で healing 済み)', 'completed', false],
    ['awaiting_question(意図的な一時停止)', 'awaiting_question', false],
    ['verify_done かつ必須マージ待ち', 'verify_done', true],
  ])('通知しない: %s', (_label, workflowStatus, awaitingMerge) => {
    expect(shouldFlagOrphanTask(workflowStatus, awaitingMerge)).toBe(false);
  });

  test('verify_done でもマージ待ちでなければ通知する(本当に止まっている)', () => {
    expect(shouldFlagOrphanTask('verify_done', false)).toBe(true);
  });
});
