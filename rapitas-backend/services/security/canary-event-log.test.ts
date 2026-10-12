/**
 * Canary event log tests — the detection log must be a separate file from the cycle log.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendCanaryHit, countCanaryHits, getCanaryLogFilePath } from './canary-event-log';
import type { CanaryHitRecord } from './canary-types';

let dir: string;
const prev = process.env.RAPITAS_DATA_DIR;

const record: CanaryHitRecord = {
  t: '2026-10-13T01:02:03.000Z',
  tokenId: 'abc',
  label: 'sandbox',
  ip: '203.0.113.9',
  forwardedFor: null,
  ua: 'curl/8.0',
  stage: 'isolated',
  trust: 'direct',
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canary-log-'));
  process.env.RAPITAS_DATA_DIR = dir;
});
afterEach(() => {
  if (prev === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = prev;
  rmSync(dir, { recursive: true, force: true });
});

describe('countCanaryHits', () => {
  test('counts lines per stage across daily files and ignores junk', () => {
    appendCanaryHit(record);
    appendCanaryHit({ ...record, t: '2026-10-14T00:00:00.000Z' });
    appendCanaryHit({ ...record, stage: 'production' });
    writeFileSync(join(dir, 'logs', 'canary-2026-10-15.ndjson'), 'not json\n', 'utf8');
    expect(countCanaryHits('isolated')).toBe(2);
    expect(countCanaryHits('production')).toBe(1);
  });

  test('returns 0 when no log exists', () => {
    expect(countCanaryHits('isolated')).toBe(0);
  });
});

describe('appendCanaryHit', () => {
  test('writes IP, UA and time to a canary-prefixed daily file', () => {
    expect(appendCanaryHit(record)).toBe(true);
    const lines = readFileSync(getCanaryLogFilePath('2026-10-13'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ip).toBe('203.0.113.9');
    expect(parsed.ua).toBe('curl/8.0');
    expect(parsed.t).toBe(record.t);
  });

  test('never creates a cycle-*.ndjson file', () => {
    appendCanaryHit(record);
    appendCanaryHit(record);
    const names = readdirSync(join(dir, 'logs'));
    expect(names).toEqual(['canary-2026-10-13.ndjson']);
    expect(
      readFileSync(join(dir, 'logs', names[0]), 'utf8')
        .trim()
        .split('\n'),
    ).toHaveLength(2);
  });

  test('returns false instead of throwing when the data dir is a regular file', () => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'x');
    process.env.RAPITAS_DATA_DIR = blocker;
    expect(appendCanaryHit(record)).toBe(false);
    expect(existsSync(join(dir, 'logs'))).toBe(false);
  });
});
