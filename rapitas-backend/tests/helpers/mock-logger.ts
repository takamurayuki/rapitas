/**
 * mock-logger.ts
 *
 * config/logger モジュール全体を差し替えるファクトリ関数を提供する。
 * このファイル自身は mock.module を一切呼ばない ─ bun の hoisting 制約に従い、
 * 呼び出しはテストファイル側の責務。
 *
 * 使い方:
 *   import { loggerModuleFactory } from '../helpers/mock-logger';
 *   mock.module('../../config/logger', loggerModuleFactory);
 *   const { myModule } = await import('../../myModule');
 */

import type pino from 'pino';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/**
 * logger の各メソッドに差し込めるスパイ関数の型。
 * @param info  - info メソッド差し替え / info method override
 * @param warn  - warn メソッド差し替え / warn method override
 * @param error - error メソッド差し替え / error method override
 * @param debug - debug メソッド差し替え / debug method override
 * @param fatal - fatal メソッド差し替え / fatal method override
 */
export interface LoggerSpies {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
  fatal?: (...args: unknown[]) => void;
}

/** テスト用 no-op logger が実装する最小インターフェース */
export interface NoopLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
  child: (...args: unknown[]) => NoopLogger;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 完全 no-op の logger インスタンスを生成する。
 *
 * pino.Logger のうち、テストで使用頻度の高い
 * `info / warn / error / debug / fatal / child` を no-op 実装する。
 * `child()` は再帰的に noop logger を返す。
 *
 * @returns no-op logger インスタンス / noop logger instance
 */
export function createNoopLogger(): NoopLogger {
  const noop = (): void => {};
  const inst: NoopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    fatal: noop,
    child: () => inst,
  };
  return inst;
}

/**
 * config/logger モジュール全体を差し替えるファクトリ（no-op 版）。
 *
 * `config/logger` が export する `createLogger`・`logger`・`getBackendLogFilePath`
 * を全て mirror する。一部 export の欠落による他テストの import 破壊を防ぐため、
 * 必ず全 export を含める。
 *
 * @returns config/logger と同一構造のモジュールオブジェクト / module object mirroring config/logger
 */
export function loggerModuleFactory(): {
  createLogger: (name: string) => NoopLogger;
  logger: NoopLogger;
  getBackendLogFilePath: (stamp?: string) => string;
} {
  const noopLogger = createNoopLogger();
  return {
    createLogger: (_name: string) => createNoopLogger(),
    logger: noopLogger,
    getBackendLogFilePath: (_stamp?: string) => '',
  };
}

/**
 * スパイ注入可能な config/logger モジュールファクトリ（spy 版）。
 *
 * 渡した `spies` で no-op をオーバーライドした logger を返す。
 * `warn: mockWarn` 等を検証したいテスト（約 20 ファイル）向け。
 * 大多数のテストには {@link loggerModuleFactory}（引数なし）で十分。
 *
 * @param spies - オーバーライドしたいメソッドのスパイ関数 / spy functions to override
 * @returns config/logger と同一構造のモジュールオブジェクト / module object mirroring config/logger
 */
export function loggerSpyFactory(spies?: LoggerSpies): {
  createLogger: (name: string) => NoopLogger;
  logger: NoopLogger;
  getBackendLogFilePath: (stamp?: string) => string;
} {
  const noop = (): void => {};
  const makeLogger = (): NoopLogger => {
    const inst: NoopLogger = {
      info: spies?.info ?? noop,
      warn: spies?.warn ?? noop,
      error: spies?.error ?? noop,
      debug: spies?.debug ?? noop,
      fatal: spies?.fatal ?? noop,
      child: () => makeLogger(),
    };
    return inst;
  };
  return {
    createLogger: (_name: string) => makeLogger(),
    logger: makeLogger(),
    getBackendLogFilePath: (_stamp?: string) => '',
  };
}

// NOTE: pino.Logger 型は直接使用せず NoopLogger で代替する。
// これは config/logger が pino に強依存しているが、テスト環境では pino を
// import させたくない（ファイルシンク副作用）ためのトレードオフ。
export type { pino };
