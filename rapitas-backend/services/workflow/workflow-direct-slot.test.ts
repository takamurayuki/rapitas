/**
 * workflow-direct-slot.test
 *
 * A direct advance of a paused theme's task must hold a real global slot (a `running`
 * WorkflowQueueItem) so dequeue and the selection count see it, and must not start when
 * the slots are full. Uses an in-memory fake of the Prisma delegates involved.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));

type Item = {
  id: number;
  taskId: number;
  themeId: number | null;
  orchestraSessionId: number | null;
  status: string;
  currentPhase: string;
  errorMessage?: string | null;
  completedAt?: Date | null;
};
let items: Item[] = [];
let nextId = 1;
let themeStatus: string | null = 'paused_user';
let txFailures = 0;
let creationDepths: number[] = [];
let themeReadThrows = false;
let limit = 1;
// Serialises transactions like a Serializable isolation level would (one at a time).
let chain: Promise<unknown> = Promise.resolve();
function createItem(data: Omit<Item, 'id'>, transactional: boolean): Item {
  creationDepths.push(Number(transactional));
  const row = { id: nextId++, ...data };
  items.push(row);
  return row;
}

const delegate = {
  workflowQueueItem: {
    findFirst: async ({ where }: { where: { taskId: number; status: { in: string[] } } }) =>
      items.find(
        (i) =>
          i.taskId === where.taskId &&
          i.orchestraSessionId === null &&
          where.status.in.includes(i.status),
      ) ?? null,
    count: async ({ where }: { where: { status: string } }) =>
      items.filter((i) => i.status === where.status).length,
    update: async ({ where, data }: { where: { id: number }; data: Partial<Item> }) => {
      Object.assign(items.find((i) => i.id === where.id)!, data);
    },
    create: async ({ data }: { data: Omit<Item, 'id'> }) => createItem(data, false),
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: number; status: string };
      data: Partial<Item>;
    }) => {
      const row = items.find((i) => i.id === where.id && i.status === where.status);
      if (row) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    },
  },
  task: { findUnique: async () => ({ themeId: 35, workflowStatus: 'in_progress' }) },
  themeAutoRun: {
    findFirst: async () => {
      if (themeReadThrows) throw new Error('theme read failed');
      return themeStatus ? { status: themeStatus } : null;
    },
  },
};
let sqlite: PrismaClient | null = null;
const fakePrisma = {
  ...delegate,
  $transaction: (fn: (tx: typeof delegate) => Promise<unknown>, options: unknown) => {
    expect(options).toEqual({ isolationLevel: 'Serializable' });
    if (txFailures-- > 0) return Promise.reject(new Error('serialization failure'));
    // 別の取引が進行中でも、通常クライアントの書き込みを取引内と誤認しない。
    const tx = {
      ...delegate,
      workflowQueueItem: {
        ...delegate.workflowQueueItem,
        create: async ({ data }: { data: Omit<Item, 'id'> }) => createItem(data, true),
      },
    };
    const run = chain.then(() => fn(tx));
    chain = run.catch(() => {});
    return run;
  },
};
const database = new Proxy(fakePrisma, {
  get(_target, key) {
    const db = sqlite ?? fakePrisma;
    const value = Reflect.get(db, key);
    return typeof value === 'function' ? value.bind(db) : value;
  },
});
mock.module('../../config', () => ({ prisma: database }));
mock.module('./workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ getMaxConcurrency: () => limit }) },
}));
mock.module('../observability', () => ({ logCycleEvent: () => {} }));
mock.module('./workflow-orchestrator-overlap-guard', () => ({ isOverlapHeld: () => false }));
mock.module('../task/task-resolver', () => ({
  resolveTaskWorkflowState: (id: number) => sqlite!.task.findUnique({ where: { id } }),
  taskRowConfirmedAbsent: async () => false,
}));

const {
  acquireDirectSlot,
  releaseDirectSlot,
  runWithDirectSlotIfPaused,
  startWithDirectSlotIfPaused,
} = await import('./workflow-direct-slot');
const { tryDequeueCandidate } = await import('./queue-dequeue-candidate');

const seed = (partial: Partial<Item>): Item => {
  const row: Item = {
    id: nextId++,
    taskId: 1,
    themeId: 35,
    orchestraSessionId: null,
    status: 'queued',
    currentPhase: 'draft',
    ...partial,
  };
  items.push(row);
  return row;
};

beforeEach(() => {
  items = [];
  nextId = 1;
  themeStatus = 'paused_user';
  txFailures = 0;
  creationDepths = [];
  themeReadThrows = false;
  limit = 1;
  chain = Promise.resolve();
});

describe('acquireDirectSlot', () => {
  test('上限1・項目なし・枠空き: running 項目を作って acquired', async () => {
    const r = await acquireDirectSlot(1420, 1);
    expect(r.status).toBe('acquired');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ taskId: 1420, themeId: 35, status: 'running' });
  });

  test('同じ task の queued 項目があれば再利用し、重複を作らない', async () => {
    const queued = seed({ taskId: 1420 });
    const r = await acquireDirectSlot(1420, 1);
    expect(r).toEqual({ status: 'acquired', itemId: queued.id });
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('running');
  });

  test('上限1で別 task が running: slot_unavailable、同じ task は queued を残す', async () => {
    seed({ taskId: 7, status: 'running' });
    expect(await acquireDirectSlot(1420, 1)).toMatchObject({ status: 'slot_unavailable' });
    expect(items.find((i) => i.taskId === 1420)).toMatchObject({ status: 'queued' });
  });

  test('枠が無く queued 項目が既にあるときは増やさず queued のまま', async () => {
    seed({ taskId: 7, status: 'running' });
    seed({ taskId: 1420 });
    expect(await acquireDirectSlot(1420, 1)).toMatchObject({ status: 'slot_unavailable' });
    expect(items.filter((i) => i.taskId === 1420)).toHaveLength(1);
    expect(items.find((i) => i.taskId === 1420)!.status).toBe('queued');
  });

  test('上限2で別 1 件が running なら acquired、3件目は拒否', async () => {
    seed({ taskId: 7, status: 'running' });
    expect((await acquireDirectSlot(1420, 2)).status).toBe('acquired');
    expect(await acquireDirectSlot(1421, 2)).toMatchObject({ status: 'slot_unavailable' });
  });

  test('直接実行中の後続の直接実行は拒否される（予約が running として数えられる）', async () => {
    expect((await acquireDirectSlot(1, 1)).status).toBe('acquired');
    expect(await acquireDirectSlot(2, 1)).toMatchObject({ status: 'slot_unavailable' });
  });

  test('dequeue と同じ基準: 予約中は running 件数が上限に達している', async () => {
    await acquireDirectSlot(1, 1);
    const running = await delegate.workflowQueueItem.count({ where: { status: 'running' } });
    expect(running >= 1).toBe(true);
  });

  test('同じ task が既に running なら取得しない', async () => {
    seed({ taskId: 1420, status: 'running' });
    expect(await acquireDirectSlot(1420, 2)).toMatchObject({ status: 'slot_unavailable' });
    expect(items).toHaveLength(1);
  });

  test('同時取得: 2件を同時に呼んでも acquired は1件だけ', async () => {
    const results = await Promise.all([acquireDirectSlot(1, 1), acquireDirectSlot(2, 1)]);
    expect(results.filter((r) => r.status === 'acquired')).toHaveLength(1);
    expect(items.filter((i) => i.status === 'running')).toHaveLength(1);
  });

  test('トランザクションが失敗したら fail-closed（取得しない）が、待機用の queued を残す', async () => {
    txFailures = 1;
    expect(await acquireDirectSlot(1420, 1)).toEqual({
      status: 'slot_unavailable',
      reason: 'error',
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ taskId: 1420, status: 'queued' });
  });

  test('トランザクション失敗でも、既に項目があれば queued を増やさない', async () => {
    seed({ taskId: 1420 });
    txFailures = 1;
    await acquireDirectSlot(1420, 1);
    expect(items.filter((i) => i.taskId === 1420)).toHaveLength(1);
  });

  test('同じ task が running なら reason は already_running で、既存項目は変更されない', async () => {
    const running = seed({ taskId: 1420, status: 'running', currentPhase: 'verify' });
    expect(await acquireDirectSlot(1420, 2)).toEqual({
      status: 'slot_unavailable',
      reason: 'already_running',
    });
    expect(running).toMatchObject({ status: 'running', currentPhase: 'verify' });
  });

  test('同じ task の同時取得: 満枠でも queued は1件だけ（作成は同一トランザクション内）', async () => {
    seed({ taskId: 7, status: 'running' });
    const results = await Promise.all([acquireDirectSlot(1420, 1), acquireDirectSlot(1420, 1)]);
    expect(results.every((r) => r.status === 'slot_unavailable')).toBe(true);
    expect(items.filter((i) => i.taskId === 1420)).toHaveLength(1);
    expect(creationDepths).toEqual([1]);
  });

  test('取得例外後の同時復帰でも同じ task の queued を重複作成しない', async () => {
    txFailures = 2;
    const results = await Promise.all([acquireDirectSlot(1420), acquireDirectSlot(1420)]);
    expect(results.every((r) => r.status === 'slot_unavailable')).toBe(true);
    expect(items.filter((i) => i.taskId === 1420)).toHaveLength(1);
    expect(creationDepths).toEqual([1]);
  });

  test('復帰トランザクションも失敗した場合は直接実行しない', async () => {
    txFailures = 2;
    const fn = mock(async () => ({ success: true }));
    expect(await runWithDirectSlotIfPaused(1420, fn)).toEqual({ status: 'deferred' });
    expect(fn).not.toHaveBeenCalled();
    expect(items).toHaveLength(0);
  });

  test('空き枠での同じ task の同時取得は片方だけ acquired で、項目は1件', async () => {
    const results = await Promise.all([acquireDirectSlot(1420, 2), acquireDirectSlot(1420, 2)]);
    expect(results.filter((r) => r.status === 'acquired')).toHaveLength(1);
    expect(items.filter((i) => i.taskId === 1420)).toHaveLength(1);
  });

  test('孤児回収（running が終端になった）後は再び取得できる', async () => {
    const orphan = seed({ taskId: 1420, status: 'running' });
    expect(await acquireDirectSlot(1420, 1)).toMatchObject({ reason: 'already_running' });
    orphan.status = 'cancelled'; // workflow-reconciler-queue-stall の stale-running 回収後
    expect((await acquireDirectSlot(1420, 1)).status).toBe('acquired');
  });
});

describe('releaseDirectSlot', () => {
  test('終了後に項目が終端になり、後続が取得できる', async () => {
    const r = await acquireDirectSlot(1, 1);
    if (r.status !== 'acquired') throw new Error('not acquired');
    await releaseDirectSlot(r.itemId);
    expect(items[0]!.status).toBe('completed');
    expect((await acquireDirectSlot(2, 1)).status).toBe('acquired');
  });

  test('すでに別経路で終端になった項目は上書きしない', async () => {
    const row = seed({ taskId: 1, status: 'cancelled' });
    await releaseDirectSlot(row.id, 'failed');
    expect(row.status).toBe('cancelled');
  });
});

describe('runWithDirectSlotIfPaused', () => {
  test('成功: 実行中は枠を握り、終了後に completed で解放する', async () => {
    let during = 0;
    const out = await runWithDirectSlotIfPaused(1420, async () => {
      during = items.filter((i) => i.status === 'running').length;
      return { success: true };
    });
    expect(out.status).toBe('ran');
    expect(during).toBe(1);
    expect(items[0]!.status).toBe('completed');
  });

  test('失敗結果は failed で解放する', async () => {
    await runWithDirectSlotIfPaused(1420, async () => ({ success: false }));
    expect(items[0]!.status).toBe('failed');
  });

  test('例外でも解放し、例外は再送出する', async () => {
    await expect(
      runWithDirectSlotIfPaused(1420, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(items[0]).toMatchObject({ status: 'failed', errorMessage: 'boom' });
  });

  test('枠が無ければ fn を呼ばず deferred', async () => {
    seed({ taskId: 7, status: 'running' });
    const fn = mock(async () => ({ success: true }));
    expect(await runWithDirectSlotIfPaused(1420, fn)).toEqual({ status: 'deferred' });
    expect(fn).not.toHaveBeenCalled();
  });

  test('テーマ状態を読めなければ枠を迂回せず、満枠なら fn を呼ばない（fail-closed）', async () => {
    themeReadThrows = true;
    seed({ taskId: 7, status: 'running' });
    const fn = mock(async () => ({ success: true }));
    expect(await runWithDirectSlotIfPaused(1420, fn)).toEqual({ status: 'deferred' });
    expect(fn).not.toHaveBeenCalled();
  });

  test('テーマ状態を読めなければ空き枠でも実行せず queued に残す', async () => {
    themeReadThrows = true;
    const fn = mock(async () => ({ success: true }));
    expect(await runWithDirectSlotIfPaused(1420, fn)).toEqual({ status: 'deferred' });
    expect(fn).not.toHaveBeenCalled();
    expect(items[0]).toMatchObject({ taskId: 1420, status: 'queued' });
  });

  test.each(['running', 'idle', null])('テーマが %s なら枠を取らずそのまま実行する', async (st) => {
    themeStatus = st;
    seed({ taskId: 7, status: 'running' });
    const out = await runWithDirectSlotIfPaused(1420, async () => ({ success: true }));
    expect(out.status).toBe('ran');
    expect(items.filter((i) => i.taskId === 1420)).toHaveLength(0);
  });
});

describe('startWithDirectSlotIfPaused', () => {
  test('枠を取ってから started を返し、done の完了で解放する（待たずに返る）', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const r = await startWithDirectSlotIfPaused(1420, async () => {
      await gate;
      return { success: true };
    });
    expect(r.status).toBe('started');
    expect(items[0]!.status).toBe('running'); // held while fn is still pending
    finish();
    if (r.status === 'started') await r.done;
    expect(items[0]!.status).toBe('completed');
  });

  test('枠が無ければ fn を起動せず deferred を即座に返す', async () => {
    seed({ taskId: 7, status: 'running' });
    const fn = mock(async () => ({ success: true }));
    expect(await startWithDirectSlotIfPaused(1420, fn)).toEqual({ status: 'deferred' });
    expect(fn).not.toHaveBeenCalled();
  });
});

// 本物の SQLite クライアントを共有し、予約と dequeue の状態遷移を接続する。
async function withSqlite(fn: (db: PrismaClient) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'task1535-slot-'));
  const path = join(dir, 'test.db');
  const init = new Database(path);
  init.exec(SQLITE_INIT_SQL);
  init.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${path}` } } });
  sqlite = db;
  try {
    await fn(db);
  } finally {
    sqlite = null;
    await db.$disconnect();
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      // Windows のクライアント切断直後はファイルハンドルの解放が遅れることがある。
      for (let attempt = 0; ; attempt++) {
        try {
          rmSync(path + suffix, { force: true });
          break;
        } catch (err) {
          if (
            attempt === 4 ||
            !['EBUSY', 'EPERM'].includes((err as NodeJS.ErrnoException).code ?? '')
          )
            throw err;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
    rmdirSync(dir);
  }
}

describe('SQLite での枠共有', () => {
  test.each([true, false])(
    '同じ task=%s の同時取得でも最後の枠は1件だけ',
    async (same) => {
      await withSqlite(async (db) => {
        const a = await db.task.create({ data: { title: '予約A' } });
        const b = same ? a : await db.task.create({ data: { title: '予約B' } });
        const results = await Promise.all([acquireDirectSlot(a.id, 1), acquireDirectSlot(b.id, 1)]);
        expect(results.filter((r) => r.status === 'acquired')).toHaveLength(1);
        expect(await db.workflowQueueItem.count({ where: { status: 'running' } })).toBe(1);
        if (same) expect(await db.workflowQueueItem.count({ where: { taskId: a.id } })).toBe(1);
      });
    },
    30000,
  );

  test('直接予約中は実 dequeue が待機し、解放後に同じ候補を取得する', async () => {
    await withSqlite(async (db) => {
      const a = await db.task.create({ data: { title: '直接実行', workflowStatus: 'draft' } });
      const b = await db.task.create({
        data: { title: '他テーマの候補', workflowStatus: 'draft' },
      });
      const candidate = await db.workflowQueueItem.create({
        data: { taskId: b.id, status: 'queued', currentPhase: 'draft', dependencies: '[]' },
      });
      const slot = await acquireDirectSlot(a.id, 1);
      expect(slot.status).toBe('acquired');
      expect(await tryDequeueCandidate(candidate, 1)).toBeNull();
      expect(
        (await db.workflowQueueItem.findUniqueOrThrow({ where: { id: candidate.id } })).status,
      ).toBe('queued');
      if (slot.status !== 'acquired') throw new Error('予約失敗');
      await releaseDirectSlot(slot.itemId);
      expect(await tryDequeueCandidate(candidate, 1)).toMatchObject({
        id: candidate.id,
        status: 'running',
      });
      expect(await acquireDirectSlot(a.id, 1)).toMatchObject({ reason: 'full' });
    });
  }, 30000);
});
