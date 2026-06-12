/**
 * task-execution-lock テスト
 *
 * 同一タスクへの多重実行を1つに収れんさせるミューテックスの単体テスト。
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  acquireTaskExecutionLock,
  releaseTaskExecutionLock,
  isTaskExecutionLocked,
} from './task-execution-lock';

describe('task-execution-lock', () => {
  // Each test uses a unique task id to avoid cross-test lock leakage.
  let nextId = 1000;
  let taskId: number;

  beforeEach(() => {
    taskId = nextId++;
  });

  test('未ロックのタスクはロックを取得できる', () => {
    expect(acquireTaskExecutionLock(taskId)).toBe(true);
  });

  test('既にロック中のタスクは取得に失敗する（多重起動防止）', () => {
    expect(acquireTaskExecutionLock(taskId)).toBe(true);
    expect(acquireTaskExecutionLock(taskId)).toBe(false);
  });

  test('解放後は再取得できる', () => {
    expect(acquireTaskExecutionLock(taskId)).toBe(true);
    releaseTaskExecutionLock(taskId);
    expect(acquireTaskExecutionLock(taskId)).toBe(true);
  });

  test('isTaskExecutionLocked はロック状態を反映する', () => {
    expect(isTaskExecutionLocked(taskId)).toBe(false);
    acquireTaskExecutionLock(taskId);
    expect(isTaskExecutionLocked(taskId)).toBe(true);
    releaseTaskExecutionLock(taskId);
    expect(isTaskExecutionLocked(taskId)).toBe(false);
  });

  test('TTL が経過した古いロックは奪取できる', () => {
    // Acquire with a 0ms TTL so it is immediately stale.
    expect(acquireTaskExecutionLock(taskId, 0)).toBe(true);
    // The previous lock is stale (expiresAt = now), so a fresh acquire succeeds.
    expect(acquireTaskExecutionLock(taskId)).toBe(true);
  });

  test('解放は冪等（未ロックでも例外を投げない）', () => {
    expect(() => releaseTaskExecutionLock(taskId)).not.toThrow();
  });
});
