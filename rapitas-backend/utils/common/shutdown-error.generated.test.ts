/**
 * shutdown-error.generated.test
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:shutdown-error`
 * ソース: scripts/gen-shutdown-error-artifacts.ts
 *
 * SNAPSHOT:
 *   SHUTDOWN_ACTIONS: ["start new execution","continue execution","resume execution"]
 *   SHUTDOWN_ERROR_MESSAGE: "Server is shutting down"
 *   WORKER_SHUTDOWN_ERROR_MESSAGE: "Manager is shutting down"
 */
import { describe, expect, test } from 'bun:test';
import { buildShutdownErrorMessage, isShutdownError } from './shutdown-error';

describe('SHUTDOWN_ACTIONS ラウンドトリップ（自動生成）', () => {
  test.each([
    ['start new execution', 'Server is shutting down, cannot start new execution'],
    ['continue execution', 'Server is shutting down, cannot continue execution'],
    ['resume execution', 'Server is shutting down, cannot resume execution'],
  ])('action: "%s" — buildShutdownErrorMessage + isShutdownError', (action, expectedMessage) => {
    expect(buildShutdownErrorMessage(action)).toBe(expectedMessage);
    expect(isShutdownError(new Error(buildShutdownErrorMessage(action)))).toBe(true);
  });
});

describe('isShutdownError 真理値表（自動生成）', () => {
  test('Worker 完全一致 → true', () => {
    expect(isShutdownError(new Error('Manager is shutting down'))).toBe(true);
  });

  test('Server プレフィックスのみ → true', () => {
    expect(isShutdownError(new Error('Server is shutting down'))).toBe(true);
  });

  test('Worker + suffix → false（完全一致のみ）', () => {
    expect(isShutdownError(new Error('Manager is shutting down — extra text'))).toBe(false);
  });

  test('null → false', () => {
    expect(isShutdownError(null)).toBe(false);
  });

  test('string → false（instanceof Error ✕）', () => {
    expect(isShutdownError('Server is shutting down')).toBe(false);
  });

  test('プレーンオブジェクト → false（instanceof Error ✕）', () => {
    expect(isShutdownError({ message: 'Server is shutting down' })).toBe(false);
  });
});
