/**
 * worker-restart-log unit tests
 *
 * The key property: a time before recording began is "unknown" (null), never 0.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  appendWorkerRestart,
  ensureRestartRecordingStarted,
  readWorkerRestartLog,
  countRestartsInRange,
  recordWorkerRestartSafely,
} from './worker-restart-log';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worker-restart-log-'));
  file = join(dir, 'worker-restarts.ndjson');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const T0 = new Date('2026-10-01T00:00:00.000Z');
const hour = (n: number) => new Date(T0.getTime() + n * 3_600_000);

describe('worker restart log', () => {
  test('missing file reads as not recording', () => {
    const log = readWorkerRestartLog(file);
    expect(log.recordingStartedAt).toBeNull();
    expect(countRestartsInRange(log, T0, hour(1))).toBeNull();
  });

  test('first line is the recordingStartedAt marker', () => {
    ensureRestartRecordingStarted(T0, file);
    ensureRestartRecordingStarted(hour(5), file); // idempotent
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ type: 'recording_started', at: T0.toISOString() });
  });

  test('time before recording started is null, not 0', () => {
    ensureRestartRecordingStarted(hour(10), file);
    const log = readWorkerRestartLog(file);
    expect(countRestartsInRange(log, hour(2), hour(3))).toBeNull();
    expect(countRestartsInRange(log, hour(9), hour(11))).toBeNull(); // straddles the start
    expect(countRestartsInRange(log, hour(10), hour(11))).toBe(0);
  });

  test('counts restarts inside [start, end)', () => {
    ensureRestartRecordingStarted(T0, file);
    appendWorkerRestart(hour(1), file);
    appendWorkerRestart(hour(1.5), file);
    appendWorkerRestart(hour(2), file);
    const log = readWorkerRestartLog(file);
    expect(countRestartsInRange(log, hour(1), hour(2))).toBe(2);
    expect(countRestartsInRange(log, hour(2), hour(3))).toBe(1);
  });

  test('append creates the marker when the file does not exist', () => {
    appendWorkerRestart(hour(1), file);
    const log = readWorkerRestartLog(file);
    expect(log.recordingStartedAt?.toISOString()).toBe(hour(1).toISOString());
    expect(log.restarts).toHaveLength(1);
  });

  test('recordWorkerRestartSafely swallows I/O failures and reports false', () => {
    // A path whose parent is an existing FILE cannot be created as a directory.
    ensureRestartRecordingStarted(T0, file);
    expect(recordWorkerRestartSafely(hour(1), join(file, 'nested', 'x.ndjson'))).toBe(false);
    expect(recordWorkerRestartSafely(hour(1), file)).toBe(true);
  });

  test('malformed lines are skipped, not thrown', () => {
    ensureRestartRecordingStarted(T0, file);
    appendWorkerRestart(hour(1), file);
    require('fs').appendFileSync(file, 'not json\n');
    expect(readWorkerRestartLog(file).restarts).toHaveLength(1);
    expect(existsSync(file)).toBe(true);
  });
});
