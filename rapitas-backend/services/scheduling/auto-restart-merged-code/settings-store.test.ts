/**
 * settings-store.test
 *
 * Real file I/O round-trips against a temp RAPITAS_DATA_DIR, plus the
 * safe defaults when files are absent or invalid.
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readAutoRestartEnabled,
  writeAutoRestartEnabled,
  readLastRestartAt,
  writeLastRestartAt,
  readDeferCount,
  writeDeferCount,
} from './settings-store';

const originalDataDir = process.env.RAPITAS_DATA_DIR;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'auto-restart-store-'));
  process.env.RAPITAS_DATA_DIR = tempDir;
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = originalDataDir;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best-effort temp cleanup
  }
});

describe('enabled toggle', () => {
  test('defaults to false when the file is absent', () => {
    expect(readAutoRestartEnabled()).toBe(false);
  });

  test('round-trips true and false', () => {
    writeAutoRestartEnabled(true);
    expect(readAutoRestartEnabled()).toBe(true);
    writeAutoRestartEnabled(false);
    expect(readAutoRestartEnabled()).toBe(false);
  });

  test('treats garbage content as false (safe side)', () => {
    writeFileSync(join(tempDir, '.auto-restart-merged-code-enabled'), 'yes please');
    expect(readAutoRestartEnabled()).toBe(false);
  });

  test('creates the data dir when missing', () => {
    process.env.RAPITAS_DATA_DIR = join(tempDir, 'nested', 'dir');
    writeAutoRestartEnabled(true);
    expect(readAutoRestartEnabled()).toBe(true);
  });
});

describe('last-restart stamp', () => {
  test('defaults to 0 when the file is absent', () => {
    expect(readLastRestartAt()).toBe(0);
  });

  test('round-trips an epoch ms value', () => {
    const ts = 1765000000000;
    writeLastRestartAt(ts);
    expect(readLastRestartAt()).toBe(ts);
  });

  test('returns 0 on non-numeric content', () => {
    writeFileSync(join(tempDir, '.auto-restart-merged-code-last-at'), 'not-a-number');
    expect(readLastRestartAt()).toBe(0);
  });

  test('deferCount defaults to 0 when the file is absent', () => {
    expect(readDeferCount()).toBe(0);
  });

  test('deferCount round-trips and clamps to a non-negative integer', () => {
    writeDeferCount(3);
    expect(readDeferCount()).toBe(3);
    writeDeferCount(0);
    expect(readDeferCount()).toBe(0);
    writeDeferCount(-2);
    expect(readDeferCount()).toBe(0);
  });

  test('deferCount returns 0 on non-numeric content', () => {
    writeFileSync(join(tempDir, '.auto-restart-merged-code-defer-count'), 'many');
    expect(readDeferCount()).toBe(0);
  });

  test('uses a file separate from the dev-restart-on-dry stamp', () => {
    // The two restart mechanisms must keep independent rate limits.
    writeLastRestartAt(123456789);
    expect(readLastRestartAt()).toBe(123456789);
    // .dev-restart-last-at was never created by this store.
    expect(() => readLastRestartAt()).not.toThrow();
    const devRestartStamp = join(tempDir, '.dev-restart-last-at');
    expect(existsSync(devRestartStamp)).toBe(false);
  });
});
