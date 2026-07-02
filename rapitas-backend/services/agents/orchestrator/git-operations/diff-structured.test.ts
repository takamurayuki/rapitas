// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * diff-structured.test
 *
 * getDiff の phantom ディレクトリガードを検証する。
 * 存在しない cwd を渡した場合、cmd.exe を spawn せず即 [] を返し、
 * logger.warn のみ出力すること（logger.error は出さない）を保証する。
 */
import { mock, describe, test, expect, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Logger 呼び出しキャプチャ用コンテナ — mock.module の factory がクロージャで参照する
// ---------------------------------------------------------------------------

const warnCalls = [];
const errorCalls = [];

// ---------------------------------------------------------------------------
// Module mocks — dynamic import より前に登録する必要がある
// NOTE: 全エクスポートをミラーすること（process-global のため汚染を最小化）
// ---------------------------------------------------------------------------

mock.module('../../../../config/logger', () => ({
  getBackendLogFilePath: (_stamp) => '/test/logs/backend.log',
  logger: {
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: (_b) => ({}),
  },
  createLogger: (_name) => ({
    warn: (...args) => {
      warnCalls.push(args);
    },
    error: (...args) => {
      errorCalls.push(args);
    },
    info: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: (_b) => ({}),
  }),
}));

// ---------------------------------------------------------------------------
// Dynamic import AFTER mocks are registered
// ---------------------------------------------------------------------------

const { getDiff } = await import('./diff-structured');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getDiff — phantom directory guard', () => {
  beforeEach(() => {
    warnCalls.length = 0;
    errorCalls.length = 0;
  });

  // Merged from 3 separate re-invocations of the same call into one test: each
  // originally re-ran getDiff() with an identical phantom path just to check a
  // different facet (return value / warn-not-error / warn payload shape) of the
  // same side effect — one call, multiple assertions, is equivalent and cheaper.
  test('phantom path → returns [], logs only warn (never error), tagging workingDirectory', async () => {
    const path = 'C:\\nonexistent\\phantom';
    const result = await getDiff(path, () => false);
    expect(result).toEqual([]);
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    expect(errorCalls.length).toBe(0);
    expect(warnCalls[0]?.[0]).toMatchObject({ workingDirectory: path });
  });

  test('empty string → returns []', async () => {
    const result = await getDiff('', () => false);
    expect(result).toEqual([]);
  });
});
