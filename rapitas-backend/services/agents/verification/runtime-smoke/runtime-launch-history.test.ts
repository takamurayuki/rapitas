/**
 * runtime-launch-history.test
 *
 * The history is the only evidence cleanup may stop a process on, so it must
 * survive registry removal, tolerate corruption by yielding nothing, and keep a
 * spawned root a root.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_HISTORY_PER_WORKDIR,
  launchHistoryPath,
  readLaunchHistory,
  recordLaunchLock,
  recordLaunchProcesses,
} from './runtime-launch-history';
import { PERSIST_PATH } from './runtime-server-registry-types';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'launch-history-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const row = (pid: number, command = `"${'C:/w'}/app.exe" --serve`) => ({
  pid,
  parentPid: 1,
  birth: String(1000 + pid),
  command,
});

describe('launch history', () => {
  test('an empty or missing history reads as no evidence', async () => {
    expect(await readLaunchHistory(dir)).toEqual([]);
  });

  test('records survive and carry the split argv', async () => {
    expect(await recordLaunchProcesses(dir, [row(10)], 'root')).toBe(true);
    const [first] = await readLaunchHistory(dir);
    expect(first).toMatchObject({ kind: 'process', pid: 10, birth: '1010', role: 'root' });
    expect(first.argv).toEqual(['C:/w/app.exe', '--serve']);
  });

  test('a later observed sighting never demotes the spawned root', async () => {
    await recordLaunchProcesses(dir, [row(10)], 'root');
    await recordLaunchProcesses(dir, [row(10), row(11)], 'observed');
    const roles = Object.fromEntries((await readLaunchHistory(dir)).map((r) => [r.pid, r.role]));
    expect(roles).toEqual({ 10: 'root', 11: 'observed' });
  });

  test('the lock record keeps its path, holder and birth', async () => {
    await recordLaunchLock(dir, {
      path: join(dir, '.next', 'dev', 'lock'),
      pid: 12,
      birth: '1012',
    });
    const [lock] = await readLaunchHistory(dir);
    expect(lock).toMatchObject({ kind: 'lock', pid: 12, birth: '1012', role: 'lock' });
  });

  test('a corrupt file is treated as no evidence, not as an error', async () => {
    await mkdir(join(dir, '.agent-pids'), { recursive: true });
    await writeFile(launchHistoryPath(dir), '{ not json');
    expect(await readLaunchHistory(dir)).toEqual([]);
    await writeFile(
      launchHistoryPath(dir),
      JSON.stringify({ version: 1, entries: [{ key: 'x' }] }),
    );
    expect(await readLaunchHistory(dir)).toEqual([]);
  });

  test('records of another worktree in the same file are not returned', async () => {
    await recordLaunchProcesses(dir, [row(10)], 'root');
    const other = join(dir, 'sub');
    expect((await readLaunchHistory(other)).length).toBe(0);
  });

  test('only the newest records are kept per worktree', async () => {
    for (let i = 0; i < MAX_HISTORY_PER_WORKDIR + 5; i++) {
      await recordLaunchProcesses(dir, [row(100 + i)], 'observed');
    }
    const kept = await readLaunchHistory(dir);
    expect(kept.length).toBe(MAX_HISTORY_PER_WORKDIR);
    expect(kept.some((r) => r.pid === 100)).toBe(false);
    expect(kept.some((r) => r.pid === 100 + MAX_HISTORY_PER_WORKDIR + 4)).toBe(true);
  });

  test('concurrent writers do not lose records or corrupt the file', async () => {
    await Promise.all(
      [10, 11, 12, 13].map((pid) => recordLaunchProcesses(dir, [row(pid)], 'observed')),
    );
    expect((await readLaunchHistory(dir)).map((r) => r.pid).sort()).toEqual([10, 11, 12, 13]);
  });

  test('lives in its own file, so removing registry entries cannot erase it', () => {
    expect(launchHistoryPath(dir)).not.toBe(PERSIST_PATH);
    expect(launchHistoryPath(dir)).toContain('runtime-launch-history.json');
  });
});
