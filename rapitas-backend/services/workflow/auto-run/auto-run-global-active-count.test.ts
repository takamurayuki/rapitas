/**
 * auto-run-global-active-count.test.ts
 *
 * Verifies that items of non-progressing themes do not hold the global auto-run slot.
 * Uses a small in-memory fake of the two Prisma delegates involved.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { getGlobalAutoRunActiveCount } from './auto-run-global-active-count';
import { selectNextTask } from './auto-run-selection';

type Item = { themeId: number | null; status: string; taskId?: number };
type Run = { themeId: number; status: string };

type Clause = { status?: string | { in: string[] }; themeId?: { notIn: number[] } };

let liveTaskIds: number[] = [];
let failLookups = false;
/** Runs right after the paused theme's running items were read, before liveness is queried. */
let afterHeldRead: (() => void) | null = null;
let configuredLimit = 1;
let candidateTasks: unknown[] = [];

function fakePrisma(items: Item[], runs: Run[]): PrismaClient {
  const matches = (i: Item, c: Clause) => {
    const s = c.status;
    const okStatus =
      s === undefined || (typeof s === 'string' ? i.status === s : s.in.includes(i.status));
    return okStatus && (!c.themeId || !c.themeId.notIn.includes(i.themeId as number));
  };
  return {
    themeAutoRun: {
      findMany: async () => runs.filter((r) => r.status !== 'running'),
    },
    workflowQueueItem: {
      findMany: async ({ where }: { where: { themeId: { in: number[] } } }) => {
        if (failLookups) throw new Error('db down');
        const held = items.filter(
          (i) => i.status === 'running' && where.themeId.in.includes(i.themeId as number),
        );
        afterHeldRead?.();
        return held;
      },
      count: async ({ where }: { where: { themeId: { not: null }; OR: Clause[] } }) =>
        items.filter((i) => i.themeId !== null && where.OR.some((c) => matches(i, c))).length,
    },
    agentExecution: {
      findMany: async () => {
        if (failLookups) throw new Error('db down');
        return liveTaskIds.map((taskId) => ({ session: { config: { taskId } } }));
      },
    },
    userSettings: {
      findFirst: async () => ({
        workflowDisabledGlobally: false,
        autoRunMaxConcurrency: configuredLimit,
      }),
    },
    task: { findMany: async () => candidateTasks },
  } as unknown as PrismaClient;
}

describe('getGlobalAutoRunActiveCount', () => {
  beforeEach(() => {
    liveTaskIds = [];
    failLookups = false;
    afterHeldRead = null;
    configuredLimit = 1;
    candidateTasks = [];
  });

  it.each(['paused', 'paused_user', 'paused_approval', 'idle', 'stopping'])(
    'AC1: %s テーマの queued item のみなら 0 件',
    async (status) => {
      const prisma = fakePrisma([{ themeId: 35, status: 'queued' }], [{ themeId: 35, status }]);
      expect(await getGlobalAutoRunActiveCount(prisma)).toBe(0);
    },
  );

  it('AC2: running テーマの queued item は 1 件として数える', async () => {
    const prisma = fakePrisma(
      [{ themeId: 1, status: 'queued' }],
      [{ themeId: 1, status: 'running' }],
    );
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(1);
  });

  it('AC1: paused テーマの running item は、生きたエージェントが無ければ枠に数えない', async () => {
    liveTaskIds = [];
    const prisma = fakePrisma(
      [{ themeId: 35, status: 'running', taskId: 1420 }],
      [{ themeId: 35, status: 'paused_user' }],
    );
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(0);
  });

  it('paused テーマの running item でも、生きたエージェントがあれば数える', async () => {
    liveTaskIds = [1420];
    const prisma = fakePrisma(
      [{ themeId: 35, status: 'running', taskId: 1420 }],
      [{ themeId: 35, status: 'paused_user' }],
    );
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(1);
  });

  it('stopping テーマの running item も、生きたエージェントが無ければ数えない', async () => {
    liveTaskIds = [];
    const prisma = fakePrisma(
      [{ themeId: 35, status: 'running', taskId: 1420 }],
      [{ themeId: 35, status: 'stopping' }],
    );
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(0);
  });

  it('paused テーマの waiting_approval item は数え続ける', async () => {
    liveTaskIds = [];
    const prisma = fakePrisma(
      [{ themeId: 35, status: 'waiting_approval', taskId: 1 }],
      [{ themeId: 35, status: 'paused_user' }],
    );
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(1);
  });

  it('idle テーマの running item は（修復受領で走りうるので）数える', async () => {
    liveTaskIds = [];
    const prisma = fakePrisma(
      [{ themeId: 35, status: 'running', taskId: 1420 }],
      [{ themeId: 35, status: 'idle' }],
    );
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(1);
  });

  it('確認クエリが失敗したら従来どおり数える（上限超過を避ける）', async () => {
    liveTaskIds = [];
    failLookups = true;
    const prisma = fakePrisma(
      [{ themeId: 35, status: 'running', taskId: 1420 }],
      [{ themeId: 35, status: 'paused_user' }],
    );
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(1);
  });

  it.each([1, 2])(
    '組み合わせ: 上限 %i で、paused テーマの非生存 running item だけなら他テーマが選定される',
    async (limit) => {
      configuredLimit = limit;
      candidateTasks = [
        {
          id: 501,
          status: 'todo',
          workflowStatus: null,
          priority: 'medium',
          createdAt: new Date(),
          complexityScore: null,
        },
      ];
      const prisma = fakePrisma(
        [{ themeId: 35, status: 'running', taskId: 1420 }],
        [{ themeId: 35, status: 'paused_user' }],
      );
      const active = await getGlobalAutoRunActiveCount(prisma);
      expect(active).toBe(0);
      const result = await selectNextTask(prisma, 1, 'priority', [], active);
      expect(result).toMatchObject({ found: true, taskId: 501 });
    },
  );

  it('組み合わせ: 上限 2 で別テーマが 1 枠使用中でも、paused テーマの非生存 item は枠を握らず選定できる', async () => {
    configuredLimit = 2;
    candidateTasks = [
      {
        id: 501,
        status: 'todo',
        workflowStatus: null,
        priority: 'medium',
        createdAt: new Date(),
        complexityScore: null,
      },
    ];
    const prisma = fakePrisma(
      [
        { themeId: 35, status: 'running', taskId: 1420 },
        { themeId: 7, status: 'running', taskId: 700 },
      ],
      [
        { themeId: 35, status: 'paused_user' },
        { themeId: 7, status: 'running' },
      ],
    );
    const active = await getGlobalAutoRunActiveCount(prisma);
    expect(active).toBe(1);
    expect(await selectNextTask(prisma, 1, 'priority', [], active)).toMatchObject({ found: true });
  });

  it('対照: 上限 2 で別テーマ 1 枠 + paused テーマの生きた実行 1 枠なら concurrency_limit', async () => {
    configuredLimit = 2;
    liveTaskIds = [1420];
    candidateTasks = [
      {
        id: 501,
        status: 'todo',
        workflowStatus: null,
        priority: 'medium',
        createdAt: new Date(),
        complexityScore: null,
      },
    ];
    const prisma = fakePrisma(
      [
        { themeId: 35, status: 'running', taskId: 1420 },
        { themeId: 7, status: 'running', taskId: 700 },
      ],
      [
        { themeId: 35, status: 'paused_user' },
        { themeId: 7, status: 'running' },
      ],
    );
    const active = await getGlobalAutoRunActiveCount(prisma);
    expect(active).toBe(2);
    expect(await selectNextTask(prisma, 1, 'priority', [], active)).toEqual({
      found: false,
      reason: 'concurrency_limit',
    });
  });

  it('割り込み: running 取得の直後（生存照会の前）に実行が起動したら、その枠は数えられる', async () => {
    const prisma = fakePrisma(
      [{ themeId: 35, status: 'running', taskId: 1420 }],
      [{ themeId: 35, status: 'paused_user' }],
    );
    afterHeldRead = () => {
      liveTaskIds = [1420]; // the agent starts between the two reads
    };
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(1);
  });

  it('割り込み: 取得後に起動しなければ従来どおり 0（照会は後段で行われる）', async () => {
    const prisma = fakePrisma(
      [{ themeId: 35, status: 'running', taskId: 1420 }],
      [{ themeId: 35, status: 'paused_user' }],
    );
    let reads = 0;
    afterHeldRead = () => {
      reads++;
    };
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(0);
    expect(reads).toBe(1);
  });

  it('ThemeAutoRun 行が無いテーマの queued item は従来どおり数える', async () => {
    const prisma = fakePrisma([{ themeId: 9, status: 'queued' }], []);
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(1);
  });

  it('AC3: paused テーマの item だけでは他テーマの selectNextTask が concurrency_limit にならない', async () => {
    const prisma = fakePrisma(
      [{ themeId: 35, status: 'queued' }],
      [{ themeId: 35, status: 'paused_user' }],
    );
    const active = await getGlobalAutoRunActiveCount(prisma);
    const result = await selectNextTask(prisma, 1, 'priority', [], active);
    expect(result).toEqual({ found: false, reason: 'all_done' });
  });
});
