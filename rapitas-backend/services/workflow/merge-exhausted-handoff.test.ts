/**
 * merge-exhausted-handoff ユニットテスト (task 1258)
 *
 * 実測: PR #912 の自動マージが 13:06 に枯渇（CI 2件赤・ci_repair は差分ゼロ）した
 * あと、スケジューラが 10.5 時間で 16 件のキュー項目を発行し、どれも実行ゼロのまま
 * テーマ1の唯一の枠を占有し続けた。枠を手で解放しても 11 秒後に再投入された。
 * ここで検証するのは「所有者が居なくなった verify_done を選定から外す」判定が
 * (1) 枯渇していなければ何もせず、(2) 進行中の正当なマージ待ちを外さず、
 * (3) 読み取り競合では書き込まないこと。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

// config/database is imported transitively by auto-merge-exhaustion and
// transition-recorder; a real import here would construct a SECOND PrismaClient
// and block the test run indefinitely.
mock.module('../../config/database', () => ({ prisma: {} }));

const recordTransition = mock(() => Promise.resolve(undefined));
mock.module('./transition-recorder', () => ({ recordTransition }));

const logCycleEvent = mock(() => {});
mock.module('../observability', () => ({
  logCycleEvent,
  getCycleLogFilePath: () => '/tmp/cycle.ndjson',
}));

let exhaustion = {
  exhausted: true,
  headSha: 'b3d67d01497abdd2bbd571ac7ce32ee4722d2499',
  exhaustedAt: new Date('2026-10-14T13:06:23Z'),
};
const readExhaustionRecord = mock(() => Promise.resolve(exhaustion));
mock.module('./auto-merge-exhaustion', () => ({
  EXHAUSTED_CAUSE: 'auto_merge_exhausted',
  readExhaustionRecord,
  markExhausted: mock(() => Promise.resolve(undefined)),
  decideTerminalState: mock(() => Promise.resolve({ skip: false })),
  resetExhaustedRecheckCooldowns: () => {},
}));

const { needsOperatorMergeHandoff, handOffExhaustedMerge, MERGE_OPERATOR_HANDOFF_CAUSE } =
  await import('./merge-exhausted-handoff');

/** The shape task 1258 was actually found in. */
const parkedAtVerifyDone = {
  status: 'in-progress',
  workflowStatus: 'verify_done',
  autoRunExcluded: false,
};

type PrismaStub = Parameters<typeof handOffExhaustedMerge>[0];

function stubPrisma(p: {
  task?: Record<string, unknown> | null;
  updateCount?: number;
  findThrows?: boolean;
  updateThrows?: boolean;
}) {
  const findUnique = mock(() =>
    p.findThrows ? Promise.reject(new Error('db down')) : Promise.resolve(p.task ?? null),
  );
  const updateMany = mock(() =>
    p.updateThrows
      ? Promise.reject(new Error('db down'))
      : Promise.resolve({ count: p.updateCount ?? 1 }),
  );
  return {
    prisma: { task: { findUnique, updateMany } } as unknown as PrismaStub,
    findUnique,
    updateMany,
  };
}

beforeEach(() => {
  recordTransition.mockClear();
  logCycleEvent.mockClear();
  readExhaustionRecord.mockClear();
  exhaustion = {
    exhausted: true,
    headSha: 'b3d67d01497abdd2bbd571ac7ce32ee4722d2499',
    exhaustedAt: new Date('2026-10-14T13:06:23Z'),
  };
});

describe('needsOperatorMergeHandoff', () => {
  test('task 1258 の実形（枯渇×verify_done×in-progress×未除外）を引き渡し対象とする', () => {
    expect(needsOperatorMergeHandoff({ ...parkedAtVerifyDone, exhausted: true })).toBe(true);
  });

  test('枯渇していなければ対象外 — 正当なマージ待ちを外してはいけない', () => {
    expect(needsOperatorMergeHandoff({ ...parkedAtVerifyDone, exhausted: false })).toBe(false);
  });

  test('verify_done 以外は対象外 — まだ投入できるフェーズが残っている', () => {
    for (const workflowStatus of ['in_progress', 'plan_approved', 'research_done', null]) {
      expect(
        needsOperatorMergeHandoff({ ...parkedAtVerifyDone, workflowStatus, exhausted: true }),
      ).toBe(false);
    }
  });

  test('既に選定除外済みなら対象外 — 毎tickの再書き込みを避ける', () => {
    expect(
      needsOperatorMergeHandoff({ ...parkedAtVerifyDone, autoRunExcluded: true, exhausted: true }),
    ).toBe(false);
  });

  test('選定対象でない status は対象外 — blocked/done は既に選ばれない', () => {
    for (const status of ['blocked', 'done', 'completed', 'cancelled', null]) {
      expect(needsOperatorMergeHandoff({ ...parkedAtVerifyDone, status, exhausted: true })).toBe(
        false,
      );
    }
  });
});

describe('handOffExhaustedMerge', () => {
  test('枯渇した verify_done を選定除外し、遷移とサイクルログを残す', async () => {
    const { prisma, updateMany } = stubPrisma({ task: parkedAtVerifyDone });

    expect(await handOffExhaustedMerge(prisma, 1258, 1)).toBe(true);

    expect(updateMany).toHaveBeenCalledTimes(1);
    const write = updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // CAS on the shape the predicate judged, so a concurrent completion wins.
    expect(write.where).toMatchObject({
      id: 1258,
      workflowStatus: 'verify_done',
      autoRunExcluded: false,
    });
    expect(write.data.autoRunExcluded).toBe(true);
    // status / workflowStatus stay untouched: the task must remain a watcher
    // candidate so a human pushing a fix still completes it the ordinary way.
    expect(write.data).not.toHaveProperty('status');
    expect(write.data).not.toHaveProperty('workflowStatus');

    expect(recordTransition).toHaveBeenCalledTimes(1);
    const transition = recordTransition.mock.calls[0][0] as {
      cause: string;
      metadata: Record<string, unknown>;
    };
    expect(transition.cause).toBe(MERGE_OPERATOR_HANDOFF_CAUSE);
    expect(transition.metadata.headSha).toBe('b3d67d01497abdd2bbd571ac7ce32ee4722d2499');
    expect(logCycleEvent).toHaveBeenCalledTimes(1);
  });

  test('枯渇していなければ書き込まない', async () => {
    exhaustion = { exhausted: false, headSha: null, exhaustedAt: null };
    const { prisma, updateMany } = stubPrisma({ task: parkedAtVerifyDone });

    expect(await handOffExhaustedMerge(prisma, 1258, 1)).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('verify_done でないタスクでは枯渇を読みにも行かない（tick ごとの無駄読みを避ける）', async () => {
    const { prisma } = stubPrisma({
      task: { ...parkedAtVerifyDone, workflowStatus: 'in_progress' },
    });

    expect(await handOffExhaustedMerge(prisma, 1258, 1)).toBe(false);
    expect(readExhaustionRecord).not.toHaveBeenCalled();
  });

  test('CAS が負けたら（並行して完了・除外された）遷移を記録しない', async () => {
    const { prisma } = stubPrisma({ task: parkedAtVerifyDone, updateCount: 0 });

    expect(await handOffExhaustedMerge(prisma, 1258, 1)).toBe(false);
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('書き込みが失敗しても例外を投げず false を返す', async () => {
    const { prisma } = stubPrisma({ task: parkedAtVerifyDone, updateThrows: true });

    expect(await handOffExhaustedMerge(prisma, 1258, 1)).toBe(false);
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('タスク行が読めなければ何もしない — 読み取り障害で待機中のマージを外さない', async () => {
    const missing = stubPrisma({ task: null });
    expect(await handOffExhaustedMerge(missing.prisma, 1258, 1)).toBe(false);

    const broken = stubPrisma({ findThrows: true });
    expect(await handOffExhaustedMerge(broken.prisma, 1258, 1)).toBe(false);
    expect(broken.updateMany).not.toHaveBeenCalled();
  });
});
