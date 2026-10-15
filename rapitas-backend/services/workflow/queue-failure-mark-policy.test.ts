/**
 * queue-failure-mark-policy.test
 *
 * Pins which queue items count as a failure mark, using the real messages the
 * writers produce.
 */
import { describe, expect, it } from 'bun:test';
import { isFailureMarkQueueItem } from './queue-failure-mark-policy';
import { taskVanishedMessage } from './queue-vanished-task-policy';
import { haltParkMessage } from './workflow-runner-halt-guard';

describe('isFailureMarkQueueItem', () => {
  it('counts every failed item', () => {
    expect(isFailureMarkQueueItem('failed', null)).toBe(true);
    expect(isFailureMarkQueueItem('failed', 'Cancelled by user')).toBe(true);
  });

  it('ignores statuses that are not failure marks', () => {
    expect(isFailureMarkQueueItem('completed', null)).toBe(false);
  });

  it.each([
    haltParkMessage(1, 'plan', 'iteration_budget'),
    taskVanishedMessage(1),
    'タスクは既に終端状態のため、残留キュー項目を自動キャンセルしました',
    'タスクが halt / blocked で実行しえないため、キュー枠を占有していた残留項目を自動キャンセルしました（定期スイープ）',
    '長時間 running のまま生存実行が確認できないため自動キャンセルしました（定期スイープ）',
    'Repair admission expired or was stopped before dispatch',
    'Cancelled by user',
  ])('does not count a benign cancel: %s', (message) => {
    expect(isFailureMarkQueueItem('cancelled', message)).toBe(false);
  });

  it('counts cancelled items with an unknown or missing message (conservative)', () => {
    expect(isFailureMarkQueueItem('cancelled', null)).toBe(true);
    expect(isFailureMarkQueueItem('cancelled', 'something new')).toBe(true);
  });
});
