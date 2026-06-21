/**
 * shutdown-error ユニットテスト
 *
 * SHUTDOWN_ERROR_MESSAGE 定数・buildShutdownErrorMessage()・isShutdownError() の
 * 正確性とラウンドトリップを検証する。
 */
import { describe, expect, test } from 'bun:test';
import {
  SHUTDOWN_ERROR_MESSAGE,
  buildShutdownErrorMessage,
  isShutdownError,
} from './shutdown-error';

describe('SHUTDOWN_ERROR_MESSAGE', () => {
  test('期待する定数値を持つ', () => {
    expect(SHUTDOWN_ERROR_MESSAGE).toBe('Server is shutting down');
  });
});

describe('buildShutdownErrorMessage', () => {
  test("'start new execution' → 従来文字列と完全一致", () => {
    expect(buildShutdownErrorMessage('start new execution')).toBe(
      'Server is shutting down, cannot start new execution',
    );
  });

  test("'continue execution' → 従来文字列と完全一致", () => {
    expect(buildShutdownErrorMessage('continue execution')).toBe(
      'Server is shutting down, cannot continue execution',
    );
  });

  test("'resume execution' → 従来文字列と完全一致", () => {
    expect(buildShutdownErrorMessage('resume execution')).toBe(
      'Server is shutting down, cannot resume execution',
    );
  });
});

describe('isShutdownError', () => {
  describe('true を返すケース', () => {
    test('buildShutdownErrorMessage で生成したメッセージの Error → true（start）', () => {
      expect(isShutdownError(new Error(buildShutdownErrorMessage('start new execution')))).toBe(
        true,
      );
    });

    test('buildShutdownErrorMessage で生成したメッセージの Error → true（continue）', () => {
      expect(isShutdownError(new Error(buildShutdownErrorMessage('continue execution')))).toBe(
        true,
      );
    });

    test('buildShutdownErrorMessage で生成したメッセージの Error → true（resume）', () => {
      expect(isShutdownError(new Error(buildShutdownErrorMessage('resume execution')))).toBe(true);
    });

    test('SHUTDOWN_ERROR_MESSAGE プレフィックスのみの Error → true', () => {
      expect(isShutdownError(new Error(SHUTDOWN_ERROR_MESSAGE))).toBe(true);
    });
  });

  describe('false を返すケース（非シャットダウンエラー）', () => {
    test('別メッセージの Error → false', () => {
      expect(isShutdownError(new Error('Something else went wrong'))).toBe(false);
    });

    test('null → false', () => {
      expect(isShutdownError(null)).toBe(false);
    });

    test('undefined → false', () => {
      expect(isShutdownError(undefined)).toBe(false);
    });

    test('文字列 → false', () => {
      expect(isShutdownError('Server is shutting down')).toBe(false);
    });

    test('プレーンオブジェクト → false', () => {
      expect(isShutdownError({ message: SHUTDOWN_ERROR_MESSAGE })).toBe(false);
    });

    test('空文字 Error → false', () => {
      expect(isShutdownError(new Error(''))).toBe(false);
    });
  });
});
