/**
 * backup-service ユニットテスト
 *
 * runBackup が markEventLoopSection('backup-run') で包まれ、成功・失敗のどちらでも
 * 解放されることを検証する（06:00 JST 帯の停止を名指しするための計装）。
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const events: string[] = [];

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../config/db-provider', () => ({ getDbProvider: () => 'sqlite' }));
mock.module('../../utils/common/encryption-key-resolver', () => ({
  resolveEncryptionKey: () => 'a'.repeat(64),
}));
mock.module('./event-loop-lag-watchdog', () => ({
  markEventLoopSection: (name: string) => {
    events.push(`mark:${name}`);
    return () => events.push(`release:${name}`);
  },
}));

const { runBackup } = await import('./backup-service');

describe('runBackup section instrumentation', () => {
  let tmpHome: string;
  const realHomedir = os.homedir;
  const realDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    events.length = 0;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rapitas-backup-test-'));
    os.homedir = () => tmpHome;
  });

  afterEach(() => {
    os.homedir = realHomedir;
    if (realDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = realDbUrl;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  test('失敗時も backup-run 区間を登録し finally で解放する', async () => {
    delete process.env.DATABASE_URL;
    const result = await runBackup();
    expect(result.success).toBe(false);
    expect(events).toEqual(['mark:backup-run', 'release:backup-run']);
  });

  test('成功時は区間を登録・解放し、戻り値は不変', async () => {
    const dbPath = path.join(tmpHome, 'src.db');
    const { Database } = await import('bun:sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < 200; i++) insert.run('x'.repeat(100));
    db.close();
    process.env.DATABASE_URL = `file:${dbPath}`;

    const result = await runBackup();
    expect(result.success).toBe(true);
    expect(result.record?.filename.endsWith('.dump.enc')).toBe(true);
    expect(events).toEqual(['mark:backup-run', 'release:backup-run']);
  });
});
