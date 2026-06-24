/**
 * mock-logger.test.ts
 *
 * mock-logger ヘルパーのユニットテスト。
 * 各ファクトリが config/logger の全 export を mirror し、
 * bun の mock.module + await import フローで正しく機能することを実証する。
 */
import { describe, test, expect, mock } from 'bun:test';
import { createNoopLogger, loggerModuleFactory, loggerSpyFactory } from './mock-logger';

// ---------------------------------------------------------------------------
// createNoopLogger のユニットテスト
// ---------------------------------------------------------------------------
describe('createNoopLogger', () => {
  test('全メソッドが関数であること', () => {
    const logger = createNoopLogger();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.fatal).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  test('各メソッドを呼んでも throw しないこと', () => {
    const logger = createNoopLogger();
    expect(() => logger.info('msg')).not.toThrow();
    expect(() => logger.warn('msg', { key: 1 })).not.toThrow();
    expect(() => logger.error('err')).not.toThrow();
    expect(() => logger.debug('dbg')).not.toThrow();
    expect(() => logger.fatal('fatal')).not.toThrow();
  });

  test('child() が NoopLogger を返すこと', () => {
    const logger = createNoopLogger();
    const child = logger.child({ name: 'child' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.child).toBe('function');
  });

  test('child() が再帰的に機能すること', () => {
    const logger = createNoopLogger();
    const grandchild = logger.child({}).child({});
    expect(() => grandchild.warn('nested')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// loggerModuleFactory のユニットテスト
// ---------------------------------------------------------------------------
describe('loggerModuleFactory', () => {
  test('createLogger・logger・getBackendLogFilePath を返すこと', () => {
    const mod = loggerModuleFactory();
    expect(typeof mod.createLogger).toBe('function');
    expect(typeof mod.logger).toBe('object');
    expect(typeof mod.getBackendLogFilePath).toBe('function');
  });

  test('createLogger() が NoopLogger を返すこと', () => {
    const mod = loggerModuleFactory();
    const logger = mod.createLogger('test');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });

  test('getBackendLogFilePath() が文字列を返すこと', () => {
    const mod = loggerModuleFactory();
    const path = mod.getBackendLogFilePath();
    expect(typeof path).toBe('string');
  });

  test('logger.child() が機能すること', () => {
    const mod = loggerModuleFactory();
    const child = mod.logger.child({ name: 'sub' });
    expect(() => child.info('hello')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// loggerSpyFactory のユニットテスト
// ---------------------------------------------------------------------------
describe('loggerSpyFactory', () => {
  test('引数なしで loggerModuleFactory と同じ構造を返すこと', () => {
    const mod = loggerSpyFactory();
    expect(typeof mod.createLogger).toBe('function');
    expect(typeof mod.logger).toBe('object');
    expect(typeof mod.getBackendLogFilePath).toBe('function');
  });

  test('注入した warn スパイが createLogger 経由で呼ばれること', () => {
    const mockWarn = mock(() => {});
    const mod = loggerSpyFactory({ warn: mockWarn });
    const logger = mod.createLogger('test');
    logger.warn('something happened');
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  test('注入した error スパイが logger プロパティ経由で呼ばれること', () => {
    const mockError = mock(() => {});
    const mod = loggerSpyFactory({ error: mockError });
    mod.logger.error('an error');
    expect(mockError).toHaveBeenCalledTimes(1);
  });

  test('注入しないメソッドは throw しないこと', () => {
    const mockWarn = mock(() => {});
    const mod = loggerSpyFactory({ warn: mockWarn });
    const logger = mod.createLogger('test');
    // info は注入していないが throw しない
    expect(() => logger.info('info msg')).not.toThrow();
  });

  test('child() 経由でもスパイが機能すること', () => {
    const mockDebug = mock(() => {});
    const mod = loggerSpyFactory({ debug: mockDebug });
    const child = mod.createLogger('parent').child({ sub: true });
    child.debug('child debug');
    expect(mockDebug).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// mock.module + await import の実利用フロー実証テスト
// ---------------------------------------------------------------------------
describe('mock.module + await import フロー', () => {
  test('loggerModuleFactory を mock.module に渡すと createLogger が差し替えられること', async () => {
    const { loggerModuleFactory: factory } = await import('./mock-logger');
    mock.module('../../config/logger', factory);
    const { createLogger } = await import('../../config/logger');
    const logger = createLogger('integration-test');
    // no-op なので呼んでも throw しない
    expect(() => logger.info('ok')).not.toThrow();
    // 実 pino ではなく noop インスタンスであること（level プロパティを持たない）
    expect((logger as unknown as Record<string, unknown>).level).toBeUndefined();
  });
});
