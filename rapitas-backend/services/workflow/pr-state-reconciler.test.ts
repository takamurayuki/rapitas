/**
 * pr-state-reconciler.test
 *
 * Fixtures follow the 2026-09-28 finding: PR #690 (task 885) had been CLOSED on
 * GitHub for weeks while the local row still read `state: 'open'`, so the
 * auto-merge watcher re-admitted the task every tick and rejected it with a WARN.
 *
 * Run this file on its own (as the verification gate does): bun's mock.module is
 * process-global and this file replaces the logger.
 *
 * `auto-merge-checks` is deliberately NOT mocked: `ghPath()` is pure, and a
 * partial mock of that module is process-global too — mirroring only `ghPath`
 * broke stale-pr-reaper.test.ts's `readHeadSha` import in the same run.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { reconcilePrStates, RECHECK_INTERVAL_MS, MAX_CHECKS_PER_TICK } =
  await import('./pr-state-reconciler');

const NOW = 1_800_000_000_000;

interface PrRow {
  id: number;
  prNumber: number;
  integrationId: number;
  linkedTaskId: number | null;
  state: string;
  lastSyncedAt: Date;
}

let rows: PrRow[] = [];
let updates: Array<{ id: number; data: Record<string, unknown> }> = [];
let ghAnswers: Record<number, { state?: string; mergedAt?: string | null } | Error> = {};
let updateFails = false;
let integration: { ownerName: string; repositoryName: string } | null = null;
let ghCommands: string[] = [];

/** Minimal Prisma stand-in honouring the where/orderBy/take the module uses. */
function makePrisma() {
  return {
    gitHubPullRequest: {
      findMany: async (args: {
        where: { state: string; lastSyncedAt: { lt: Date } };
        take: number;
      }) =>
        rows
          .filter(
            (r) => r.state === args.where.state && r.lastSyncedAt < args.where.lastSyncedAt.lt,
          )
          .sort((a, b) => a.lastSyncedAt.valueOf() - b.lastSyncedAt.valueOf())
          .slice(0, args.take),
      update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        if (updateFails) throw new Error('db down');
        updates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },
    gitHubIntegration: { findUnique: async () => integration },
  } as unknown as Parameters<typeof reconcilePrStates>[0];
}

const deps = {
  execGh: async (command: string) => {
    ghCommands.push(command);
    const prNumber = Number(/pr view (\d+)/.exec(command)?.[1]);
    const answer = ghAnswers[prNumber];
    if (answer instanceof Error) throw answer;
    return JSON.stringify(answer ?? { state: 'OPEN', mergedAt: null });
  },
  now: () => NOW,
};

/** A row last synced `hoursAgo` hours ago. */
function row(
  id: number,
  prNumber: number,
  hoursAgo: number,
  linkedTaskId: number | null = 885,
): PrRow {
  return {
    id,
    prNumber,
    integrationId: 1,
    linkedTaskId,
    state: 'open',
    lastSyncedAt: new Date(NOW - hoursAgo * 60 * 60 * 1000),
  };
}

beforeEach(() => {
  rows = [];
  updates = [];
  ghAnswers = {};
  updateFails = false;
  integration = { ownerName: 'takamurayuki', repositoryName: 'rapitas' };
  ghCommands = [];
});

describe('reconcilePrStates', () => {
  // The finding itself: task 885's PR #690 is CLOSED on GitHub, open locally.
  test('GitHub が CLOSED と答えた行はローカルも closed にする（#690 / task 885 事例）', async () => {
    rows = [row(1, 690, 48)];
    ghAnswers[690] = { state: 'CLOSED', mergedAt: null };

    const result = await reconcilePrStates(makePrisma(), deps);

    expect(result.syncedPrNumbers).toEqual([690]);
    expect(updates).toEqual([{ id: 1, data: { state: 'closed', lastSyncedAt: new Date(NOW) } }]);
  });

  test('MERGED は merged として記録する', async () => {
    rows = [row(1, 828, 48)];
    ghAnswers[828] = { state: 'MERGED', mergedAt: '2026-09-27T02:32:00Z' };

    await reconcilePrStates(makePrisma(), deps);

    expect(updates[0]?.data.state).toBe('merged');
  });

  // The cost control: a genuinely open PR must not be re-asked every tick.
  test('まだ open なら state は変えず lastSyncedAt だけ進める', async () => {
    rows = [row(1, 829, 48)];
    ghAnswers[829] = { state: 'OPEN', mergedAt: null };

    const result = await reconcilePrStates(makePrisma(), deps);

    expect(result.syncedPrNumbers).toEqual([]);
    expect(result.checked).toBe(1);
    expect(updates).toEqual([{ id: 1, data: { lastSyncedAt: new Date(NOW) } }]);
  });

  test('再確認間隔の内側にある行は問い合わせない', async () => {
    rows = [row(1, 829, RECHECK_INTERVAL_MS / (60 * 60 * 1000) - 1)];
    ghAnswers[829] = { state: 'CLOSED', mergedAt: null };

    const result = await reconcilePrStates(makePrisma(), deps);

    expect(result.checked).toBe(0);
    expect(updates).toEqual([]);
  });

  test('1パスの問い合わせ数は上限で打ち切る（古い順）', async () => {
    rows = Array.from({ length: MAX_CHECKS_PER_TICK + 3 }, (_, i) => row(i + 1, 700 + i, 100 - i));
    for (let i = 0; i < MAX_CHECKS_PER_TICK + 3; i++) {
      ghAnswers[700 + i] = { state: 'CLOSED', mergedAt: null };
    }

    const result = await reconcilePrStates(makePrisma(), deps);

    expect(result.checked).toBe(MAX_CHECKS_PER_TICK);
    // Oldest lastSyncedAt first: hoursAgo 100 is row id 1.
    expect(result.syncedPrNumbers[0]).toBe(700);
  });

  // Fail-open: a transient gh failure must leave the row for the next pass, not
  // get recorded as "still open" (which would hide it for another 6 hours).
  test('gh が失敗した行は lastSyncedAt を進めず次パスに残す', async () => {
    rows = [row(1, 690, 48)];
    ghAnswers[690] = new Error('gh: network unreachable');

    const result = await reconcilePrStates(makePrisma(), deps);

    expect(result.checked).toBe(0);
    expect(result.syncedPrNumbers).toEqual([]);
    expect(updates).toEqual([]);
  });

  // 2026-09-28: 70件のローカル open 行のうち 42 件が linkedTaskId=null で、
  // lastSyncedAt 最古の4件(=このパスが最初に見る行)がまさにそれだった。タスク経由で
  // 作業ディレクトリを借りる実装では 1 件も処理できず、打刻もしないため先頭で
  // 永久に詰まる。リポジトリを --repo で明示して参照する。
  test('linkedTaskId が null でも --repo で照会して同期する（42/70件の事例）', async () => {
    rows = [row(1, 145, 48, null)];
    ghAnswers[145] = { state: 'CLOSED', mergedAt: null };

    const result = await reconcilePrStates(makePrisma(), deps);

    expect(result.syncedPrNumbers).toEqual([145]);
    expect(ghCommands[0]).toContain('--repo takamurayuki/rapitas');
  });

  // 先頭詰まりの防止: 解決できない行は打刻して後ろの行に順番を譲る。
  test('リポジトリが解決できない行は打刻して先頭を譲る', async () => {
    rows = [row(1, 690, 48)];
    integration = null;

    const result = await reconcilePrStates(makePrisma(), deps);

    expect(result.checked).toBe(0);
    expect(ghCommands).toEqual([]);
    expect(updates).toEqual([{ id: 1, data: { lastSyncedAt: new Date(NOW) } }]);
  });

  test('書き込みが失敗しても同期済みとは報告しない', async () => {
    rows = [row(1, 690, 48)];
    ghAnswers[690] = { state: 'CLOSED', mergedAt: null };
    updateFails = true;

    expect((await reconcilePrStates(makePrisma(), deps)).syncedPrNumbers).toEqual([]);
  });
});
