/**
 * activity-store.test
 *
 * The self-verification marker files must be readable from a process that
 * did not write them (the agent-worker reads what the server wrote), must
 * stop counting as running after the limit or once the owner is gone, and
 * must match a worktree regardless of how its path is spelled.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createActivityStore,
  normalizeWorktreeKey,
  resolveActivityDir,
  SELF_VERIFICATION_ACTIVE_LIMIT_MS,
  FINISHED_TTL_MS,
} from './activity-store';

let dir: string;
let now = 1_000_000;
const alive = new Set<number>([111]);

function store(ownerPid = 111) {
  return createActivityStore({
    dir,
    now: () => now,
    isPidAlive: (pid) => alive.has(pid),
    ownerPid,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sv-activity-'));
  now = 1_000_000;
  alive.clear();
  alive.add(111);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('normalizeWorktreeKey', () => {
  test('treats separators, case and a trailing separator as the same worktree', () => {
    expect(normalizeWorktreeKey('C:\\X\\.worktrees\\Task-1\\')).toBe(
      normalizeWorktreeKey('c:/x/.worktrees/task-1'),
    );
  });
  test('an empty path has an empty key', () => {
    expect(normalizeWorktreeKey('')).toBe('');
  });
});

describe('createActivityStore', () => {
  test('終了記録の書き込み途中とrename直前でも読者には完全な開始記録だけが見える', () => {
    const writer = store();
    const reader = store(222);
    const ref = { runId: 'r1', taskId: 7, worktreePath: 'C:/x' };
    writer.markStarted(ref);
    const write = fs.writeFileSync;
    const observed: unknown[] = [];
    const spy = spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      write(file, '{');
      observed.push(reader.listForTask(7));
      write(file, data, options);
      observed.push(reader.listForTask(7));
    });
    try {
      writer.markFinished({ ...ref, ok: false, unverifiable: false, passed: 3, failed: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(observed).toHaveLength(2);
    for (const snapshot of observed) {
      expect(snapshot).toEqual([expect.objectContaining({ runId: 'r1', state: 'running' })]);
    }
    expect(reader.listForTask(7)).toEqual([
      expect.objectContaining({ state: 'finished', ok: false, passed: 3, failed: 1 }),
    ]);
    expect(readdirSync(dir)).toEqual(['r1.json']);
  });

  test('a second store sharing only the directory sees the run as running', () => {
    store().markStarted({ runId: 'r1', taskId: 7, worktreePath: 'C:\\X\\.worktrees\\t-7\\' });
    const reader = store(222);
    expect(reader.isActiveForWorktree('c:/x/.worktrees/t-7')).toBe(true);
    expect(reader.listForTask(7).map((r) => r.runId)).toEqual(['r1']);
    expect(reader.isActiveForWorktree('c:/x/.worktrees/t-8')).toBe(false);
  });

  test('終了記録の書き込みに失敗しても開始記録を保持し、一時ファイルを片付ける', () => {
    const writer = store();
    const ref = { runId: 'r1', taskId: 7, worktreePath: 'C:/x' };
    writer.markStarted(ref);
    const write = fs.writeFileSync;
    const spy = spyOn(fs, 'writeFileSync').mockImplementation((file) => {
      write(file, '{');
      throw new Error('書き込み途中の失敗を注入');
    });
    try {
      expect(() =>
        writer.markFinished({ ...ref, ok: true, unverifiable: false, passed: 1, failed: 0 }),
      ).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(store(222).listForTask(7)).toEqual([
      expect.objectContaining({ runId: 'r1', state: 'running' }),
    ]);
    expect(readdirSync(dir)).toEqual(['r1.json']);
  });

  test('no marker means nothing is running', () => {
    expect(store().isActiveForWorktree('C:/x/.worktrees/t-7')).toBe(false);
    expect(store().listForWorktree('C:/x/.worktrees/t-7')).toEqual([]);
  });

  test('a missing directory reads as empty instead of throwing', () => {
    const missing = createActivityStore({ dir: join(dir, 'nope'), now: () => now });
    expect(missing.listForWorktree('C:/x')).toEqual([]);
  });

  test('stops counting as running once the limit has passed', () => {
    const s = store();
    s.markStarted({ runId: 'r1', taskId: 7, worktreePath: 'C:/x/.worktrees/t-7' });
    now += SELF_VERIFICATION_ACTIVE_LIMIT_MS - 1;
    expect(s.isActiveForWorktree('C:/x/.worktrees/t-7')).toBe(true);
    now += 1;
    expect(s.isActiveForWorktree('C:/x/.worktrees/t-7')).toBe(false);
  });

  test('stops counting as running when the owning process is gone, and removes the marker', () => {
    const s = store();
    s.markStarted({ runId: 'r1', taskId: 7, worktreePath: 'C:/x/.worktrees/t-7' });
    alive.delete(111);
    expect(s.isActiveForWorktree('C:/x/.worktrees/t-7')).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  test('markFinished records the verdict and counts, and is no longer running', () => {
    const s = store();
    s.markStarted({ runId: 'r1', taskId: 7, worktreePath: 'C:/x/.worktrees/t-7' });
    now += 5_000;
    s.markFinished({
      runId: 'r1',
      taskId: 7,
      worktreePath: 'C:/x/.worktrees/t-7',
      ok: false,
      unverifiable: false,
      passed: 3,
      failed: 1,
    });
    const [rec] = store(222).listForWorktree('C:/x/.worktrees/t-7');
    expect(rec).toMatchObject({ state: 'finished', ok: false, passed: 3, failed: 1 });
    expect(rec.startedAt).toBe(1_000_000);
    expect(rec.finishedAt).toBe(1_005_000);
    expect(s.isActiveForWorktree('C:/x/.worktrees/t-7')).toBe(false);
    // tmp file from the atomic write is not left behind
    expect(readdirSync(dir)).toEqual(['r1.json']);
  });

  test('markFinished without a start marker still records the result', () => {
    store().markFinished({
      runId: 'r9',
      taskId: 7,
      worktreePath: 'C:/x/.worktrees/t-7',
      ok: true,
      unverifiable: false,
      passed: 2,
      failed: 0,
    });
    expect(store().listForWorktree('C:/x/.worktrees/t-7')[0]).toMatchObject({
      runId: 'r9',
      state: 'finished',
      ok: true,
    });
  });

  test('a second markStarted for the same runId keeps the first marker (exclusive create)', () => {
    const s = store();
    s.markStarted({ runId: 'r1', taskId: 7, worktreePath: 'C:/x/.worktrees/t-7' });
    now += 1000;
    expect(() =>
      s.markStarted({ runId: 'r1', taskId: 7, worktreePath: 'C:/x/.worktrees/t-7' }),
    ).not.toThrow();
    expect(s.listForWorktree('C:/x/.worktrees/t-7')[0].startedAt).toBe(1_000_000);
  });

  test('finished markers are removed after the retention window', () => {
    const s = store();
    s.markFinished({
      runId: 'r1',
      taskId: 7,
      worktreePath: 'C:/x/.worktrees/t-7',
      ok: true,
      unverifiable: false,
      passed: 1,
      failed: 0,
    });
    now += FINISHED_TTL_MS + 1;
    expect(s.listForWorktree('C:/x/.worktrees/t-7')).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  test('a broken marker file is ignored', () => {
    writeFileSync(join(dir, 'bad.json'), '{not json');
    store().markStarted({ runId: 'r1', taskId: 7, worktreePath: 'C:/x/.worktrees/t-7' });
    expect(
      store()
        .listForWorktree('C:/x/.worktrees/t-7')
        .map((r) => r.runId),
    ).toEqual(['r1']);
  });

  test('a marker rewritten between the stale check and the delete is kept', () => {
    const s = createActivityStore({
      dir,
      now: () => now,
      isPidAlive: () => false,
      ownerPid: 111,
      beforeDelete: (file) => {
        // Simulates markFinished landing in the gap: newer updatedAt on re-read.
        writeFileSync(
          file,
          JSON.stringify({
            runId: 'r1',
            taskId: 7,
            worktreeKey: normalizeWorktreeKey('C:/x/.worktrees/t-7'),
            worktreePath: 'C:/x/.worktrees/t-7',
            ownerPid: 111,
            startedAt: 1_000_000,
            updatedAt: 1_000_500,
            state: 'finished',
            finishedAt: 1_000_500,
            ok: true,
            unverifiable: false,
            passed: 1,
            failed: 0,
          }),
        );
      },
    });
    s.markStarted({ runId: 'r1', taskId: 7, worktreePath: 'C:/x/.worktrees/t-7' });
    s.listForWorktree('C:/x/.worktrees/t-7');
    expect(readdirSync(dir)).toEqual(['r1.json']);
  });
});

describe('resolveActivityDir', () => {
  test('honours RAPITAS_SELF_VERIFY_ACTIVE_DIR, else sits under the process cwd', () => {
    const prev = process.env.RAPITAS_SELF_VERIFY_ACTIVE_DIR;
    try {
      process.env.RAPITAS_SELF_VERIFY_ACTIVE_DIR = dir;
      expect(resolveActivityDir()).toBe(dir);
      delete process.env.RAPITAS_SELF_VERIFY_ACTIVE_DIR;
      expect(resolveActivityDir()).toBe(join(process.cwd(), '.self-verification-active'));
    } finally {
      if (prev === undefined) delete process.env.RAPITAS_SELF_VERIFY_ACTIVE_DIR;
      else process.env.RAPITAS_SELF_VERIFY_ACTIVE_DIR = prev;
    }
  });
});
