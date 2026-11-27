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
  type LaunchHistoryDependencies,
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

function memoryHistory() {
  const files = new Map<string, string>();
  const operations: string[] = [];
  const deps: LaunchHistoryDependencies = {
    read: async (path) => {
      if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files.get(path)!;
    },
    mkdir: async () => {},
    write: async (path, content) => {
      operations.push(`write:${path}`);
      files.set(path, content);
    },
    rename: async (from, to) => {
      operations.push(`rename:${from}:${to}`);
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    unlink: async (path) => {
      files.delete(path);
    },
    now: () => Date.parse('2026-11-25T00:00:00Z'),
    snapshot: async () => ({ processes: [], protectedPids: new Set() }),
  };
  return { files, operations, deps };
}

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

  test('ファイル操作を注入して一時ファイルからのrenameと固定ポートを確認する', async () => {
    const { deps, files, operations } = memoryHistory();
    expect(await recordLaunchProcesses(dir, [row(10)], 'root', { fixedPorts: [8090], deps })).toBe(
      true,
    );
    const records = await readLaunchHistory(dir, deps);
    expect(records[0]).toMatchObject({
      pid: 10,
      fixedPorts: [8090],
      recordedAt: '2026-11-25T00:00:00.000Z',
    });
    expect([...files.keys()]).toEqual([launchHistoryPath(dir)]);
    expect(operations[0]).toStartWith(`write:${launchHistoryPath(dir)}.`);
    expect(operations[1]).toStartWith(`rename:${launchHistoryPath(dir)}.`);
  });

  test('rename失敗でも以前の履歴が残り失敗した起動の証拠は返さない', async () => {
    const { deps, files } = memoryHistory();
    await recordLaunchProcesses(dir, [row(10)], 'root', { deps });
    deps.rename = async () => {
      throw new Error('rename拒否');
    };
    expect(await recordLaunchProcesses(dir, [row(11)], 'root', { deps })).toBe(false);
    expect((await readLaunchHistory(dir, deps)).map((r) => r.pid)).toEqual([10]);
    expect([...files.keys()]).toEqual([launchHistoryPath(dir)]);
  });

  test('新規履歴の書込失敗は証拠なしになり再試行を妨げない', async () => {
    const { deps } = memoryHistory();
    const originalWrite = deps.write;
    deps.write = async () => {
      throw new Error('書込拒否');
    };
    expect(await recordLaunchProcesses(dir, [row(10)], 'root', { deps })).toBe(false);
    expect(await readLaunchHistory(dir, deps)).toEqual([]);
    deps.write = originalWrite;
    expect(await recordLaunchProcesses(dir, [row(11)], 'root', { deps })).toBe(true);
    expect((await readLaunchHistory(dir, deps)).map((r) => r.pid)).toEqual([11]);
  });

  test('7日超かつ死亡確認済みの記録を生存中の古い記録より先に間引く', async () => {
    const { deps } = memoryHistory();
    let now = Date.parse('2026-11-01T00:00:00Z');
    deps.now = () => now;
    await recordLaunchProcesses(dir, [row(10)], 'root', { deps });
    now += 1000;
    await recordLaunchProcesses(dir, [row(11)], 'observed', { deps });
    now = Date.parse('2026-11-25T00:00:00Z');
    deps.snapshot = async () => ({ processes: [row(10)], protectedPids: new Set() });
    await recordLaunchProcesses(
      dir,
      Array.from({ length: 49 }, (_, i) => row(100 + i)),
      'observed',
      { deps },
    );
    const records = await readLaunchHistory(dir, deps);
    expect(records).toHaveLength(50);
    expect(records.some((r) => r.pid === 10)).toBe(true);
    expect(records.some((r) => r.pid === 11)).toBe(false);
  });

  test('7日ちょうどは死亡確認による優先間引きの対象外とする', async () => {
    const { deps } = memoryHistory();
    let now = Date.parse('2026-11-18T00:00:00Z');
    deps.now = () => now;
    await recordLaunchProcesses(dir, [row(10), row(11)], 'observed', { deps });
    now += 7 * 24 * 60 * 60 * 1000;
    deps.snapshot = async () => ({ processes: [row(10)], protectedPids: new Set() });
    await recordLaunchProcesses(
      dir,
      Array.from({ length: 49 }, (_, i) => row(100 + i)),
      'observed',
      { deps },
    );
    const records = await readLaunchHistory(dir, deps);
    expect(records.some((r) => r.pid === 10)).toBe(false);
    expect(records.some((r) => r.pid === 11)).toBe(true);
  });

  test('一覧取得失敗は死亡と見なさず最新50件の上限を維持する', async () => {
    const { deps } = memoryHistory();
    let now = Date.parse('2026-11-01T00:00:00Z');
    deps.now = () => now;
    await recordLaunchProcesses(dir, [row(10)], 'root', { deps });
    now = Date.parse('2026-11-25T00:00:00Z');
    deps.snapshot = async () => {
      throw new Error('一覧取得失敗');
    };
    expect(
      await recordLaunchProcesses(
        dir,
        Array.from({ length: 50 }, (_, i) => row(100 + i)),
        'observed',
        { deps },
      ),
    ).toBe(true);
    expect(await readLaunchHistory(dir, deps)).toHaveLength(50);
  });

  test('所有記録を実際に削除しても根とロックの起動履歴は保持する', async () => {
    const { deps, files } = memoryHistory();
    const ownershipPath = join(dir, '.agent-pids', 'runtime-servers.json');
    files.set(ownershipPath, JSON.stringify({ entries: [{ pid: 10 }] }));
    await recordLaunchProcesses(dir, [row(10)], 'root', { deps });
    await recordLaunchLock(
      dir,
      { path: join(dir, '.next', 'dev', 'lock'), pid: 10, birth: '1010' },
      { deps },
    );
    await deps.unlink(ownershipPath);
    expect(files.has(ownershipPath)).toBe(false);
    expect((await readLaunchHistory(dir, deps)).map((r) => r.kind)).toEqual(['process', 'lock']);
  });

  test('processとlockの種別や役割が矛盾する履歴は証拠として返さない', async () => {
    const { deps, files } = memoryHistory();
    await recordLaunchProcesses(dir, [row(10)], 'root', { deps });
    const original = await readLaunchHistory(dir, deps);
    for (const invalid of [
      { ...original[0], role: 'lock' },
      { ...original[0], kind: 'lock', lockPath: join(dir, '.next', 'lock') },
      { ...original[0], recordedAt: 'invalid' },
    ]) {
      files.set(launchHistoryPath(dir), JSON.stringify({ version: 1, entries: [invalid] }));
      expect(await readLaunchHistory(dir, deps)).toEqual([]);
    }
  });
});
