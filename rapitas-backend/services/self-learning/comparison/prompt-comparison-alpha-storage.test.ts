/**
 * prompt-comparison-alpha-storage.test
 *
 * Pins the shared alpha-ledger lock. The lock is the 'wx' write alone — an
 * existsSync() ahead of it only widened the window that flag closes (CodeQL
 * js/file-system-race), so these cases must hold with the check removed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { acquireAlphaLedgerLock, releaseAlphaLedgerLock } from './prompt-comparison-alpha-storage';

let tmpDir: string;
let savedDataDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rapitas-alpha-ledger-'));
  savedDataDir = process.env.RAPITAS_DATA_DIR;
  process.env.RAPITAS_DATA_DIR = tmpDir;
});

afterEach(() => {
  releaseAlphaLedgerLock();
  if (savedDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = savedDataDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('acquireAlphaLedgerLock / releaseAlphaLedgerLock', () => {
  it('grants the lock once and refuses it while held', () => {
    expect(acquireAlphaLedgerLock()).toBe(true);
    expect(acquireAlphaLedgerLock()).toBe(false);
  });

  it('grants it again after release', () => {
    expect(acquireAlphaLedgerLock()).toBe(true);
    releaseAlphaLedgerLock();
    expect(acquireAlphaLedgerLock()).toBe(true);
  });

  it('release is a no-op when nothing is held', () => {
    expect(() => releaseAlphaLedgerLock()).not.toThrow();
  });

  it('creates the data directory on demand', () => {
    rmSync(tmpDir, { recursive: true, force: true });
    expect(acquireAlphaLedgerLock()).toBe(true);
  });
});
