/** 実際の復元・停止・状態照会を接続し、外部DBとエージェントだけを代替する。 */
import { afterAll, beforeEach, expect, mock, test, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'deferred-restore-'));
const previous = process.env.RAPITAS_DATA_DIR;
let status = 'running';
let taskStatus = 'in-progress';
let workflowStatus = 'research_done';
let haltReason: string | null = null;
let enabled = true;
let live = 0;
let failWrite = false;
let checking: (() => Promise<void>) | undefined;
let writing: (() => Promise<void>) | undefined;
let advance: () => Promise<unknown> = async () => ({ success: true });
const calls: number[] = [];
const row = () => ({
  id: 1,
  themeId: 42,
  status,
  enabled,
  order: 'priority',
  updatedAt: new Date(),
  currentTaskId: null,
  processedCount: 0,
  lastError: null,
  lastRunAt: null,
  startedAt: null,
});
const prisma = {
  task: {
    findUnique: async () => ({ themeId: 42, status: taskStatus, workflowStatus, haltReason }),
  },
  workflowQueueItem: { count: async () => live },
  themeAutoRun: {
    findFirst: async () => {
      await checking?.();
      return row();
    },
    update: async ({ data }: { data: { status?: string; enabled?: boolean } }) => {
      await writing?.();
      if (failWrite) throw new Error('DB書き込み失敗');
      status = data.status ?? status;
      enabled = data.enabled ?? enabled;
      return row();
    },
    updateMany: async ({ data }: { data: { status?: string; enabled?: boolean } }) => {
      if (failWrite) throw new Error('DB書き込み失敗');
      status = data.status ?? status;
      enabled = data.enabled ?? enabled;
      return { count: 1 };
    },
  },
};
mock.module('../../../config', () => ({ prisma }));
mock.module('../../../config/database', () => ({ prisma }));
mock.module('../../workflow/workflow-orchestrator', () => ({
  WorkflowOrchestrator: {
    getInstance: () => ({
      advanceWorkflow: async (id: number) => {
        calls.push(id);
        return advance();
      },
    }),
  },
}));
mock.module('../../observability/cycle-event-logger', () => ({
  logCycleEvent: () => {},
  getCycleLogFilePath: () => '',
  _resetForTests: () => {},
}));
const store = await import('./restart-wait-store');
const { resetRestartWaitCache } = await import('./restart-wait');
const { resumeThemesAfterRestart } = await import('./restart-resume');
const { pauseAutoRun, stopAutoRun, finalizeStop } =
  await import('../../workflow/auto-run/theme-auto-run-mutations');
const { getLedgerTaskIds } = await import('./execution-ledger');
const operations = [
  ['一時停止', pauseAutoRun],
  ['停止', stopAutoRun],
  ['停止確定', finalizeStop],
] as const;

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function save(withTheme = false) {
  store.writeRestartWaitState({
    phase: 'waiting',
    waitStartedAt: Date.now(),
    resumeThemeIds: withTheme ? [42] : undefined,
    deferredAdvance: [{ taskId: 51, themeId: 42 }],
  });
  resetRestartWaitCache();
}
beforeEach(() => {
  process.env.RAPITAS_DATA_DIR = dir;
  store.writeRestartWaitState({});
  resetRestartWaitCache();
  status = 'running';
  enabled = true;
  taskStatus = 'in-progress';
  workflowStatus = 'research_done';
  haltReason = null;
  live = 0;
  failWrite = false;
  checking = undefined;
  writing = undefined;
  advance = async () => ({ success: true });
  calls.length = 0;
});
afterAll(() => {
  resetRestartWaitCache();
  if (previous === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});

test.each(operations)('%sが先ならテーマも保留advanceも復元しない', async (_name, stop) => {
  save(true);
  await Promise.all([stop(42), resumeThemesAfterRestart()]);
  expect(calls).toEqual([]);
  expect(status).not.toBe('running');
  expect(store.readRestartWaitState()).toEqual({});
});

test.each(operations)('テーマ復元中の%sが後続の保留advanceを取り消す', async (_name, stop) => {
  status = 'idle';
  enabled = false;
  save(true);
  const entered = signal(),
    release = signal();
  writing = async () => {
    entered.resolve();
    await release.promise;
  };
  const restoring = resumeThemesAfterRestart();
  await entered.promise;
  const stopping = stop(42);
  release.resolve();
  await Promise.all([restoring, stopping]);
  expect(calls).toEqual([]);
  expect(status).not.toBe('running');
});

test.each(operations)(
  '保留の確認と登録の間に%sが割り込まない、完了はロック外',
  async (_name, stop) => {
    save();
    const entered = signal(),
      release = signal(),
      finishing = signal();
    checking = async () => {
      entered.resolve();
      await release.promise;
    };
    advance = async () => {
      await finishing.promise;
      return { success: true };
    };
    const restoring = resumeThemesAfterRestart();
    await entered.promise;
    let stopped = false;
    const stopping = stop(42).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release.resolve();
    try {
      await stopping;
      expect(calls).toEqual([51]);
      expect(getLedgerTaskIds()).toContain(51);
    } finally {
      finishing.resolve();
      await restoring;
    }
    expect(getLedgerTaskIds()).toEqual([]);
    expect(store.readRestartWaitState()).toEqual({});
  },
);

test.each(operations)('%sの取消後にDB書込が失敗しても保留を復活させない', async (_name, stop) => {
  save(true);
  failWrite = true;
  await expect(stop(42)).rejects.toThrow('DB書き込み失敗');
  failWrite = false;
  await resumeThemesAfterRestart();
  expect(calls).toEqual([]);
});

test.each(['done', 'halted', 'completed', 'paused_user', 'stopping', 'idle', 'queued'])(
  '%sの実状態を読み保留を除外する',
  async (state) => {
    save();
    if (state === 'done') taskStatus = 'done';
    else if (state === 'halted') haltReason = 'iteration_budget';
    else if (state === 'completed') workflowStatus = 'completed';
    else if (state === 'queued') live = 1;
    else status = state;
    await resumeThemesAfterRestart();
    expect(calls).toEqual([]);
    expect(store.readRestartWaitState()).toEqual({});
  },
);

test('二重復元中でも実行は一度だけ、失敗結果はretryに残る', async () => {
  save();
  const entered = signal(),
    release = signal();
  advance = async () => {
    entered.resolve();
    await release.promise;
    return { success: false };
  };
  const first = resumeThemesAfterRestart();
  await entered.promise;
  await resumeThemesAfterRestart();
  expect(calls).toEqual([51]);
  release.resolve();
  await first;
  expect(store.readRestartWaitState()).toEqual({
    phase: 'retry',
    deferredAdvance: [{ taskId: 51, themeId: 42 }],
  });
  advance = async () => ({ success: true });
  await resumeThemesAfterRestart();
  await resumeThemesAfterRestart();
  expect(calls).toEqual([51, 51]);
  expect(store.readRestartWaitState()).toEqual({});
});

test('待機解除の保存が失敗したら実行せず復元意図を保持する', async () => {
  save();
  const write = spyOn(store, 'writeRestartWaitState').mockImplementation(() => false);
  try {
    await resumeThemesAfterRestart();
  } finally {
    write.mockRestore();
  }
  expect(calls).toEqual([]);
  expect(store.readRestartWaitState().deferredAdvance).toEqual([{ taskId: 51, themeId: 42 }]);
  await resumeThemesAfterRestart();
  expect(calls).toEqual([51]);
});

test('保存後に次のフェーズへ進んでいるタスクを再実行しない', async () => {
  store.writeRestartWaitState({
    phase: 'retry',
    deferredAdvance: [{ taskId: 51, themeId: 42, workflowStatus: 'draft' }],
  });
  await resumeThemesAfterRestart();
  expect(calls).toEqual([]);
  expect(store.readRestartWaitState()).toEqual({});
});
