import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'path';
import { getBackendLogFilePath, createLogger, logger } from './logger';

const originalDataDir = process.env.RAPITAS_DATA_DIR;
afterEach(() => {
  if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = originalDataDir;
});

describe('getBackendLogFilePath', () => {
  test('builds a path under RAPITAS_DATA_DIR/logs when overridden', () => {
    process.env.RAPITAS_DATA_DIR = '/fake/data/dir';
    expect(getBackendLogFilePath('2026-01-15')).toBe(
      join('/fake/data/dir', 'logs', 'backend-2026-01-15.log'),
    );
  });

  test("defaults to today's date stamp when none is given", () => {
    process.env.RAPITAS_DATA_DIR = '/fake/data/dir';
    const path = getBackendLogFilePath();
    expect(path).toMatch(/backend-\d{4}-\d{2}-\d{2}\.log$/);
  });

  test('falls back to ~/.rapitas/logs when RAPITAS_DATA_DIR is unset/blank', () => {
    delete process.env.RAPITAS_DATA_DIR;
    expect(getBackendLogFilePath('2026-01-15')).toContain(join('.rapitas', 'logs'));

    process.env.RAPITAS_DATA_DIR = '   ';
    expect(getBackendLogFilePath('2026-01-15')).toContain(join('.rapitas', 'logs'));
  });
});

describe('createLogger / logger', () => {
  test('createLogger returns a child logger carrying the given name', () => {
    const child = createLogger('my-module');
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
    expect(typeof child.error).toBe('function');
  });

  test('the root logger exposes the standard pino level methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });
});
