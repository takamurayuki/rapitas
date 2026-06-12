/**
 * Backup Service テスト
 *
 * Validates pruning + listing behavior on a temp directory. The actual
 * pg_dump / SQLite encryption paths are exercised by the
 * scripts/backup-smoke.ts script and not in unit tests (they need a live DB).
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listBackups, pruneOldBackups } from '../../services/system/backup-service';

let tmpHome: string;
let homeSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rapitas-backup-test-'));
  // backup-service reads os.homedir(); spy it directly. Overriding process.env.HOME
  // is unreliable — bun's os.homedir() does not re-read it at runtime on Linux,
  // so the CI sqlite suite saw the real home and listed 0 backups.
  homeSpy = spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(() => {
  homeSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function seedBackupFile(name: string, mtimeOffsetMs = 0): string {
  const dir = path.join(tmpHome, '.rapitas', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, 'fake-encrypted-data');
  if (mtimeOffsetMs !== 0) {
    const t = new Date(Date.now() + mtimeOffsetMs);
    fs.utimesSync(fp, t, t);
  }
  return fp;
}

describe('listBackups + pruneOldBackups', () => {
  it('listBackupsは新しい順で返す', () => {
    seedBackupFile('rapitas-001.dump.enc', -3000);
    seedBackupFile('rapitas-002.dump.enc', -2000);
    seedBackupFile('rapitas-003.dump.enc', -1000);

    const items = listBackups();
    expect(items.length).toBe(3);
    expect(items[0].filename).toBe('rapitas-003.dump.enc');
    expect(items[2].filename).toBe('rapitas-001.dump.enc');
  });

  it('pruneOldBackupsは古いものから削除し、保持件数を維持する', () => {
    seedBackupFile('rapitas-001.dump.enc', -5000);
    seedBackupFile('rapitas-002.dump.enc', -4000);
    seedBackupFile('rapitas-003.dump.enc', -3000);
    seedBackupFile('rapitas-004.dump.enc', -2000);
    seedBackupFile('rapitas-005.dump.enc', -1000);

    pruneOldBackups(2);

    const remaining = listBackups();
    expect(remaining.length).toBe(2);
    expect(remaining.map((r) => r.filename)).toEqual([
      'rapitas-005.dump.enc',
      'rapitas-004.dump.enc',
    ]);
  });

  it('.dump.enc以外のファイルは無視する', () => {
    seedBackupFile('rapitas-001.dump.enc');
    const dir = path.join(tmpHome, '.rapitas', 'backups');
    fs.writeFileSync(path.join(dir, 'README.txt'), 'noise');
    fs.writeFileSync(path.join(dir, '.status.json'), '{}');

    const items = listBackups();
    expect(items.length).toBe(1);
    expect(items[0].filename).toBe('rapitas-001.dump.enc');
  });
});
