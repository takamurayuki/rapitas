/**
 * shutdown-error ユニットテスト
 *
 * plan.md の「エッジケースの方針」真理値表 11 ケースと定数値・buildShutdownErrorMessage を網羅する。
 * Worker 完全一致 / Server 前方一致 / 非 Error の三区分を中心に検証する。
 */
import { describe, expect, test } from 'bun:test';
import {
  SHUTDOWN_ERROR_MESSAGE,
  WORKER_SHUTDOWN_ERROR_MESSAGE,
  buildShutdownErrorMessage,
  isShutdownError,
} from './shutdown-error';

describe('定数値', () => {
  test('SHUTDOWN_ERROR_MESSAGE は Server 系プレフィックス', () => {
    expect(SHUTDOWN_ERROR_MESSAGE).toBe('Server is shutting down');
  });

  test('WORKER_SHUTDOWN_ERROR_MESSAGE は Manager 系 IPC メッセージ', () => {
    expect(WORKER_SHUTDOWN_ERROR_MESSAGE).toBe('Manager is shutting down');
  });
});

describe('buildShutdownErrorMessage', () => {
  test("'start new execution' → 完全一致", () => {
    expect(buildShutdownErrorMessage('start new execution')).toBe(
      'Server is shutting down, cannot start new execution',
    );
  });

  test("'continue execution' → 完全一致", () => {
    expect(buildShutdownErrorMessage('continue execution')).toBe(
      'Server is shutting down, cannot continue execution',
    );
  });

  test("'resume execution' → 完全一致", () => {
    expect(buildShutdownErrorMessage('resume execution')).toBe(
      'Server is shutting down, cannot resume execution',
    );
  });
});

describe('isShutdownError', () => {
  describe('true を返すケース（シャットダウンエラー）', () => {
    test('Manager 完全一致メッセージ → true', () => {
      expect(isShutdownError(new Error('Manager is shutting down'))).toBe(true);
    });

    test('SHUTDOWN_ERROR_MESSAGE プレフィックスのみ → true', () => {
      expect(isShutdownError(new Error(SHUTDOWN_ERROR_MESSAGE))).toBe(true);
    });

    test.each(['start new execution', 'continue execution', 'resume execution'])(
      'Server: %s → true',
      (action) => {
        expect(isShutdownError(new Error(buildShutdownErrorMessage(action)))).toBe(true);
      },
    );
  });

  describe('false を返すケース（非シャットダウンエラー）', () => {
    test('Manager + 後続テキスト → false（完全一致を維持）', () => {
      // IMPORTANT: agent-worker test :18 が false を期待する最重要ケース。
      // includes() や startsWith() だと誤って true になるため === のみ採用。
      expect(isShutdownError(new Error('Manager is shutting down — extra text'))).toBe(false);
    });

    test('無関係なエラーメッセージ → false', () => {
      expect(isShutdownError(new Error('Something else went wrong'))).toBe(false);
    });

    test("'Worker not ready' → false", () => {
      expect(isShutdownError(new Error('Worker not ready'))).toBe(false);
    });

    test("'Unexpected error' → false", () => {
      expect(isShutdownError(new Error('Unexpected error'))).toBe(false);
    });

    test('空文字 Error → false', () => {
      expect(isShutdownError(new Error(''))).toBe(false);
    });

    test('null → false', () => {
      expect(isShutdownError(null)).toBe(false);
    });

    test('undefined → false', () => {
      expect(isShutdownError(undefined)).toBe(false);
    });

    test('数値 → false', () => {
      expect(isShutdownError(42)).toBe(false);
    });

    test('文字列 → false（instanceof Error ✕）', () => {
      expect(isShutdownError('Server is shutting down')).toBe(false);
    });

    test('プレーンオブジェクト → false（instanceof Error ✕）', () => {
      expect(isShutdownError({ message: 'Server is shutting down' })).toBe(false);
    });
  });
});
