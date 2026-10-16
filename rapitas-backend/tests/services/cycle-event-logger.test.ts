/**
 * Cycle Event Logger テスト
 *
 * Verifies the AI-facing NDJSON cycle event stream: path resolution, the
 * test-env no-op guard, and the actual NDJSON write path (one self-describing
 * `{ t, evt, ... }` object per line) when the guard is lifted.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
  closeSync,
  openSync,
  chmodSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  logCycleEvent,
  getCycleLogFilePath,
  _resetForTests,
} from '../../services/observability/cycle-event-logger';

/** Local YYYY-MM-DD stamp, mirroring the module's internal stamp. */
function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

describe('cycle-event-logger', () => {
  let dir: string;
  const origDataDir = process.env.RAPITAS_DATA_DIR;
  const origNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // Each case sets a fresh RAPITAS_DATA_DIR, but the module caches its
    // WriteStream by date alone — without this, a case here reuses the prior
    // case's stream (pointed at a tmpdir this beforeEach/afterEach already
    // rotated away) instead of opening one against its own dir.
    _resetForTests();
    dir = mkdtempSync(join(tmpdir(), 'cycle-log-'));
    process.env.RAPITAS_DATA_DIR = dir;
  });

  afterEach(() => {
    if (origDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = origDataDir;
    process.env.NODE_ENV = origNodeEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  test('getCycleLogFilePath places a daily NDJSON file under <DATA_DIR>/logs', () => {
    const p = getCycleLogFilePath('2026-06-22');
    expect(p).toBe(join(dir, 'logs', 'cycle-2026-06-22.ndjson'));
  });

  test('is a no-op under NODE_ENV=test (never writes a file)', () => {
    process.env.NODE_ENV = 'test';
    logCycleEvent('task.enqueued', { theme: 1, task: 42 });
    expect(existsSync(getCycleLogFilePath())).toBe(false);
  });

  test('writes one NDJSON line per event with t + evt first', async () => {
    process.env.NODE_ENV = 'development';
    logCycleEvent('task.enqueued', { theme: 1, task: 42, msg: 'next task' });
    logCycleEvent('task.completed', { theme: 1, task: 42, ok: true });

    // WriteStream opens the fd and flushes asynchronously; let the event loop run.
    await new Promise((r) => setTimeout(r, 50));

    const lines = readFileSync(getCycleLogFilePath(todayStamp()), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]);
    expect(first.evt).toBe('task.enqueued');
    expect(first.theme).toBe(1);
    expect(first.task).toBe(42);
    expect(first.msg).toBe('next task');
    // `t` is an ISO timestamp and the first key on the line.
    expect(typeof first.t).toBe('string');
    expect(Object.keys(first)[0]).toBe('t');
    expect(Object.keys(first)[1]).toBe('evt');
    expect(new Date(first.t).toISOString()).toBe(first.t);

    const second = JSON.parse(lines[1]);
    expect(second.evt).toBe('task.completed');
    expect(second.ok).toBe(true);
  });

  test('never throws when a field is not serialisable (circular ref)', () => {
    process.env.NODE_ENV = 'development';
    // JSON.stringify throws on a circular structure; the logger's try/catch must
    // swallow it so a bad field can never crash the cycle.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logCycleEvent('pr.created', { task: 1, circular })).not.toThrow();
  });

  test('recovers on the next call after the stream dies mid-day (2026-09-18 incident)', async () => {
    process.env.NODE_ENV = 'development';
    const target = getCycleLogFilePath(todayStamp());
    // Pre-create the file read-only so the stream's own open/write fails async
    // (EPERM) instead of at ensureStream()'s synchronous mkdirSync/createWriteStream
    // try/catch — this is what actually happened in production and is what the
    // reuse check's `stream.destroyed` guard exists to detect.
    mkdirSync(join(dir, 'logs'), { recursive: true });
    closeSync(openSync(target, 'w'));
    chmodSync(target, 0o444);

    expect(() => logCycleEvent('task.enqueued', { theme: 1, task: 1 })).not.toThrow();
    await new Promise((r) => setTimeout(r, 100));

    chmodSync(target, 0o666);
    expect(() => logCycleEvent('task.completed', { theme: 1, task: 1, ok: true })).not.toThrow();
    await new Promise((r) => setTimeout(r, 100));

    const lines = readFileSync(target, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).evt).toBe('task.completed');
  });
});
