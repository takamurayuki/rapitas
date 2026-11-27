/** 再起動待ちの保存・復元と停止操作の競合を固定する回帰テスト。 */
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const previous = process.env.RAPITAS_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), 'restart-concurrent-'));
const events: string[] = [];
mock.module('../../observability/cycle-event-logger', () => ({
  logCycleEvent: (event: string) => events.push(event),
  getCycleLogFilePath: () => join(dir, 'cycle.ndjson'),
  _resetForTests: () => {},
}));
const { tickRestartWait, isRestartWaitActive, resetRestartWaitCache } =
  await import('./restart-wait');
const { readRestartWaitState, writeRestartWaitState, removeThemeFromResumeSet } =
  await import('./restart-wait-store');
const { resumeThemesAfterRestart } = await import('./restart-resume');
const { withRestartGate } = await import('./restart-gate');

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const idle = { enabled: false, status: 'idle', order: 'priority' };
const input = {
  aheadCount: 1,
  changedPaths: ['prisma/schema/a.prisma'],
  lastRestartAt: 0,
  evaluate: async () => false,
};

beforeEach(() => {
  process.env.RAPITAS_DATA_DIR = dir;
  writeRestartWaitState({});
  resetRestartWaitCache();
  events.length = 0;
});
afterAll(() => {
  resetRestartWaitCache();
  if (previous === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});

test('復元失敗の直後に停止したテーマをretry集合へ戻さない', async () => {
  writeRestartWaitState({ phase: 'waiting', waitStartedAt: Date.now(), resumeThemeIds: [1, 49] });
  const failed = signal();
  const release = signal();
  const restoring = resumeThemesAfterRestart({
    findRun: async () => idle,
    start: async (id) => {
      if (id === 1) {
        failed.resolve();
        await release.promise;
        throw new Error('再開失敗');
      }
    },
  });
  await failed.promise;
  const stopping = withRestartGate(async () => removeThemeFromResumeSet(1));
  release.resolve();
  await Promise.all([restoring, stopping]);
  expect(readRestartWaitState().resumeThemeIds ?? []).not.toContain(1);
  const start = mock(async () => {});
  await resumeThemesAfterRestart({ findRun: async () => idle, start });
  expect(start).not.toHaveBeenCalled();
});

test('同時に待機を評価しても最初の復元集合を一度だけ確定する', async () => {
  const collecting = signal();
  const release = signal();
  const first = tickRestartWait({
    ...input,
    listRunningThemeIds: async () => {
      collecting.resolve();
      await release.promise;
      return [1, 49];
    },
  });
  await collecting.promise;
  const secondList = mock(async () => []);
  const second = tickRestartWait({ ...input, listRunningThemeIds: secondList });
  release.resolve();
  await Promise.all([first, second]);
  expect(readRestartWaitState().resumeThemeIds).toEqual([1, 49]);
  expect(secondList).not.toHaveBeenCalled();
  expect(events.filter((event) => event === 'restart.wait_started')).toHaveLength(1);
});

test.each(['collecting', 'waiting'] as const)(
  '%sの保存が失敗したら待機を有効化しない',
  async (phase) => {
    const blockedPath = join(dir, `保存不可-${phase}`);
    writeFileSync(blockedPath, 'ディレクトリではない');
    if (phase === 'collecting') process.env.RAPITAS_DATA_DIR = blockedPath;
    const listRunningThemeIds = mock(async () => {
      process.env.RAPITAS_DATA_DIR = blockedPath;
      return [1, 49];
    });
    try {
      await tickRestartWait({ ...input, listRunningThemeIds });
      expect(isRestartWaitActive()).toBe(false);
      expect(events).not.toContain('restart.wait_started');
      if (phase === 'collecting') expect(listRunningThemeIds).not.toHaveBeenCalled();
    } finally {
      process.env.RAPITAS_DATA_DIR = dir;
    }
  },
);

test('復元成功後は保存ファイルを削除し再開を繰り返さない', async () => {
  const { existsSync } = await import('node:fs');
  writeRestartWaitState({ phase: 'waiting', waitStartedAt: Date.now(), resumeThemeIds: [1] });
  const start = mock(async () => {});
  await resumeThemesAfterRestart({ findRun: async () => idle, start });
  expect(existsSync(join(dir, '.auto-restart-wait.json'))).toBe(false);
  await resumeThemesAfterRestart({ findRun: async () => idle, start });
  expect(start).toHaveBeenCalledTimes(1);
});
