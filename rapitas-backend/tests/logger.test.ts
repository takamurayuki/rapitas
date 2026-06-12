/**
 * logger.test.ts
 *
 * Verifies that the file sink is disabled in test environments so that
 * test-generated errors do not contaminate the shared daily log file.
 */
import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { getBackendLogFilePath, logger } from '../config/logger';

describe('logger - テスト環境ファイルシンク無効化', () => {
  test('bun test は NODE_ENV=test で実行される', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  test('warn ログをファイルに書き込まない', () => {
    const filePath = getBackendLogFilePath();
    const before = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
    const marker = `logger-test-warn-${process.pid}-${Date.now()}`;

    logger.warn({ marker }, 'logger unit test - warn level');

    const after = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
    // Either the file was not created, or its content is unchanged.
    expect(after).toBe(before);
  });

  test('error ログをファイルに書き込まない', () => {
    const filePath = getBackendLogFilePath();
    const before = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
    const marker = `logger-test-error-${process.pid}-${Date.now()}`;

    logger.error({ marker }, 'logger unit test - error level');

    const after = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
    expect(after).toBe(before);
  });
});
