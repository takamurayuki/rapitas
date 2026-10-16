/**
 * queue-vanished-task-policy テスト
 */
import { describe, test, expect } from 'bun:test';
import { taskVanishedMessage, isTaskVanishedMessage } from './queue-vanished-task-policy';

describe('taskVanishedMessage / isTaskVanishedMessage', () => {
  test('生成したメッセージは isTaskVanishedMessage で true と判定されること', () => {
    const msg = taskVanishedMessage(648);
    expect(isTaskVanishedMessage(msg)).toBe(true);
  });

  test('無関係な文字列は false と判定されること', () => {
    expect(
      isTaskVanishedMessage('タスクは既に終端状態のため、残留キュー項目を自動キャンセルしました'),
    ).toBe(false);
    expect(isTaskVanishedMessage('Max retries (3) exceeded')).toBe(false);
  });

  test('null/undefined は false と判定されること', () => {
    expect(isTaskVanishedMessage(null)).toBe(false);
    expect(isTaskVanishedMessage(undefined)).toBe(false);
    expect(isTaskVanishedMessage('')).toBe(false);
  });

  test('タスクIDが異なれば生成メッセージも異なること', () => {
    expect(taskVanishedMessage(648)).not.toBe(taskVanishedMessage(649));
  });
});
