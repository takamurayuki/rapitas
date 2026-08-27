/**
 * ExecutionFileLogger — logExecutionEnd ユニットテスト
 *
 * logExecutionEnd() の 3 ログレベル分岐を検証する。
 * completed → INFO / failed → ERROR / その他 → WARN。
 * flush() は呼ばないため fs/promises モックは不要。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Module-level mocks（import 前に宣言） ──────────────────────────────────────

// NOTE: ExecutionFileLogger はモジュール初期化時に createLogger を呼ぶ。
// テストランナーへのログ混入を防ぐためスタブ化する。
// コンソールパススルー引数を検証するため spy 関数として保持する。
const infoMock = mock(() => {});
const warnMock = mock(() => {});
const errorMock = mock(() => {});
const debugMock = mock(() => {});

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: infoMock, warn: warnMock, error: errorMock, debug: debugMock }),
}));

// ── 動的 import（mock.module 宣言後） ─────────────────────────────────────────

const { ExecutionFileLogger } = await import('./index');

// ── ヘルパー ──────────────────────────────────────────────────────────────────

/**
 * テスト用のロガーインスタンスを生成する。
 * enableConsolePassthrough=false で log() 内の console 呼出しを抑止する。
 */
function makeLogger() {
  // HACK(agent): private field assertion in test — entries/errorCount/warningCount を検証するため as any キャストを使用
  return new ExecutionFileLogger(1, 1, 1, 'テストタスク', 'test', undefined, undefined, {
    enableConsolePassthrough: false,
  });
}

/**
 * enableConsolePassthrough=true のロガーインスタンスを生成する。
 * pino へ渡る引数（context/error）を検証するために使用する。
 */
function makePassthroughLogger() {
  return new ExecutionFileLogger(2, 1, 1, 'テストタスク', 'test', undefined, undefined, {
    enableConsolePassthrough: true,
  });
}

// ── ログレベル分岐テスト ───────────────────────────────────────────────────────

describe('ExecutionFileLogger.logExecutionEnd — ログレベル分岐', () => {
  test('status=completed → level が INFO になる', () => {
    const logger = makeLogger();
    logger.logExecutionEnd('completed');
    const entry = (logger as any).entries.at(-1);
    expect(entry.level).toBe('INFO');
    expect(entry.eventType).toBe('execution_end');
    expect((entry.message as string).includes('completed')).toBe(true);
  });

  test('status=failed → level が ERROR になる', () => {
    const logger = makeLogger();
    logger.logExecutionEnd('failed');
    const entry = (logger as any).entries.at(-1);
    expect(entry.level).toBe('ERROR');
    expect(entry.eventType).toBe('execution_end');
    expect((entry.message as string).includes('failed')).toBe(true);
  });

  test('status=cancelled → level が WARN になる', () => {
    const logger = makeLogger();
    logger.logExecutionEnd('cancelled');
    const entry = (logger as any).entries.at(-1);
    expect(entry.level).toBe('WARN');
    expect(entry.eventType).toBe('execution_end');
  });

  test('status=interrupted → level が WARN になる', () => {
    const logger = makeLogger();
    logger.logExecutionEnd('interrupted');
    expect((logger as any).entries.at(-1).level).toBe('WARN');
  });

  test('status=timeout → level が WARN になる', () => {
    const logger = makeLogger();
    logger.logExecutionEnd('timeout');
    expect((logger as any).entries.at(-1).level).toBe('WARN');
  });

  test('completed でも failed でもない任意の status → WARN フォールバック', () => {
    const logger = makeLogger();
    logger.logExecutionEnd('unknown_status');
    expect((logger as any).entries.at(-1).level).toBe('WARN');
  });
});

// ── カウンター副作用テスト ──────────────────────────────────────────────────────

describe('ExecutionFileLogger.logExecutionEnd — カウンター副作用', () => {
  test('completed → errorCount / warningCount が増加しない', () => {
    const logger = makeLogger();
    logger.logExecutionEnd('completed');
    // HACK(agent): private field assertion in test
    expect((logger as any).errorCount).toBe(0);
    expect((logger as any).warningCount).toBe(0);
  });

  test('failed → errorCount が 1 増加する', () => {
    const logger = makeLogger();
    logger.logExecutionEnd('failed');
    // HACK(agent): private field assertion in test
    expect((logger as any).errorCount).toBe(1);
    expect((logger as any).warningCount).toBe(0);
  });

  test('cancelled → warningCount が 1 増加する', () => {
    const logger = makeLogger();
    logger.logExecutionEnd('cancelled');
    // HACK(agent): private field assertion in test
    expect((logger as any).warningCount).toBe(1);
    expect((logger as any).errorCount).toBe(0);
  });
});

// ── コンソールパススルー引数テスト（#694: 失敗理由が pino に届いていなかった不具合） ──────

describe('ExecutionFileLogger.log — コンソールパススルー引数', () => {
  beforeEach(() => {
    infoMock.mockClear();
    warnMock.mockClear();
    errorMock.mockClear();
    debugMock.mockClear();
  });

  test('logExecutionEnd(failed, {errorMessage}) → pino.error に errorMessage を含む context が渡る', () => {
    const logger = makePassthroughLogger();
    logger.logExecutionEnd('failed', { errorMessage: 'Claude CLI exited 1' });

    expect(errorMock).toHaveBeenCalledTimes(1);
    const [context, message] = errorMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(context.errorMessage).toBe('Claude CLI exited 1');
    expect(message.includes('Execution ended with status: failed')).toBe(true);
  });

  test('logExecutionEnd(failed, {errorMessage}) → context.err.message に失敗理由が入る（log-format-parser の parsePino が err.message を signature に使うため）', () => {
    const logger = makePassthroughLogger();
    logger.logExecutionEnd('failed', { errorMessage: 'Claude CLI exited 1' });

    const [context] = errorMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(context.err).toBeInstanceOf(Error);
    expect((context.err as Error).message).toBe('Claude CLI exited 1');
  });

  test('logExecutionEnd(failed) → errorMessage 未指定なら context.err は付与されない', () => {
    const logger = makePassthroughLogger();
    logger.logExecutionEnd('failed');

    const [context] = errorMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(context.err).toBeUndefined();
  });

  test('logError(message, error) → pino.error に err フィールドとしてエラーが渡る', () => {
    const logger = makePassthroughLogger();
    const err = new Error('boom');
    logger.logError('処理に失敗', err);

    expect(errorMock).toHaveBeenCalledTimes(1);
    const [context] = errorMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(context.err).toBe(err);
  });

  test('logWarn(message, context) → pino.warn に context がそのまま渡る', () => {
    const logger = makePassthroughLogger();
    logger.logWarn('リトライします', { attempt: 2 });

    expect(warnMock).toHaveBeenCalledTimes(1);
    const [context] = warnMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(context.attempt).toBe(2);
  });

  test('context も error も無い場合 → pino.error はメッセージのみで呼ばれる（第一引数なし）', () => {
    const logger = makePassthroughLogger();
    logger.log('ERROR', 'error', 'コンテキスト無しのエラー');

    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock.mock.calls[0]).toEqual([`[ExecLog:2] コンテキスト無しのエラー`]);
  });

  test('context が undefined で error のみ指定 → クラッシュせず err フィールドのみの context が渡る', () => {
    const logger = makePassthroughLogger();
    const err = new Error('context 無しのエラー');
    expect(() => logger.log('ERROR', 'error', 'メッセージ', undefined, err)).not.toThrow();

    expect(errorMock).toHaveBeenCalledTimes(1);
    const [context] = errorMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(context).toEqual({ err });
  });
});
