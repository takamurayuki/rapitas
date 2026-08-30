/**
 * conflict-pr-merge-state.test
 *
 * Run this file on its own (as the verification gate does): bun's mock.module
 * is process-global and this file replaces config/prisma and auto-merge-checks.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let themeDir: string | null = 'C:/repo';
mock.module('../../../../config', () => ({
  prisma: {
    task: {
      findUnique: () => Promise.resolve({ theme: { workingDirectory: themeDir } }),
    },
  },
}));

const readCalls: Array<{ cwd: string; prNumber: number }> = [];
let states: Array<string | null> = [];
mock.module('../../../../services/workflow/auto-merge-checks', () => ({
  readMergeState: (cwd: string, prNumber: number) => {
    readCalls.push({ cwd, prNumber });
    return Promise.resolve(states.length > 0 ? states.shift()! : null);
  },
}));

const { readConflictPrVerdict, UNKNOWN_STATE_RETRIES } = await import('./conflict-pr-merge-state');

const sleeps: number[] = [];
const sleep = (ms: number) => {
  sleeps.push(ms);
  return Promise.resolve();
};

beforeEach(() => {
  themeDir = 'C:/repo';
  readCalls.length = 0;
  sleeps.length = 0;
  states = [];
});

describe('readConflictPrVerdict', () => {
  test('DIRTY ならテーマの作業ディレクトリと PR 番号で照会し dirty=true', async () => {
    states = ['DIRTY'];
    const v = await readConflictPrVerdict(762, 534, { sleep });
    expect(v).toEqual({ dirty: true, state: 'DIRTY' });
    expect(readCalls).toEqual([{ cwd: 'C:/repo', prNumber: 534 }]);
  });

  test('CLEAN / BLOCKED / BEHIND は競合なし', async () => {
    for (const s of ['CLEAN', 'BLOCKED', 'BEHIND']) {
      states = [s];
      expect(await readConflictPrVerdict(762, 534, { sleep })).toEqual({ dirty: false, state: s });
    }
  });

  test('UNKNOWN は再試行し、途中で DIRTY になれば dirty=true', async () => {
    states = ['UNKNOWN', 'UNKNOWN', 'DIRTY'];
    const v = await readConflictPrVerdict(762, 534, { sleep });
    expect(v.dirty).toBe(true);
    expect(readCalls.length).toBe(3);
    expect(sleeps.length).toBe(2);
  });

  test('UNKNOWN のまま再試行を使い切ったら fail open（dirty=false）', async () => {
    states = Array.from({ length: UNKNOWN_STATE_RETRIES + 1 }, () => 'UNKNOWN');
    const v = await readConflictPrVerdict(762, 534, { sleep });
    expect(v).toEqual({ dirty: false, state: 'UNKNOWN' });
    expect(readCalls.length).toBe(UNKNOWN_STATE_RETRIES + 1);
    expect(sleeps.length).toBe(UNKNOWN_STATE_RETRIES);
  });

  test('gh が答えられなければ fail open（state=null）', async () => {
    states = [null];
    expect(await readConflictPrVerdict(762, 534, { sleep })).toEqual({ dirty: false, state: null });
  });

  test('テーマに作業ディレクトリが無ければ process.cwd() で照会', async () => {
    themeDir = null;
    states = ['DIRTY'];
    await readConflictPrVerdict(762, 534, { sleep });
    expect(readCalls[0]?.cwd).toBe(process.cwd());
  });
});
