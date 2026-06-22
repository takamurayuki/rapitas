/**
 * ExecutionFileLogger — logExecutionEnd ユニットテスト
 *
 * logExecutionEnd() の 3 ログレベル分岐を検証する。
 * completed → INFO / failed → ERROR / その他 → WARN。
 * flush() は呼ばないため fs/promises モックは不要。
 */
import { describe, test, expect, mock } from 'bun:test';

// ── Module-level mocks（import 前に宣言） ──────────────────────────────────────

// NOTE: ExecutionFileLogger はモジュール初期化時に createLogger を呼ぶ。
// テストランナーへのログ混入を防ぐためスタブ化する。
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
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
