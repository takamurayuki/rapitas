/**
 * prompt-comparison-runner.test
 *
 * Verifies lock acquire/release, budget-truncated partial completion, sample
 * task not-found skipping (no crash, remaining samples proceed), and the
 * pending-proposals scheduler hook. Own file — mock.module is process-global.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  workingDirectory: string | null;
  status: string;
  completedAt: Date | null;
  theme: { workingDirectory: string | null; repositoryUrl: string | null } | null;
}
interface EvoRow {
  id: number;
  basePromptKey: string | null;
  afterPrompt: string;
  status: string;
}

let taskRows: TaskRow[] = [];
let evoRows: EvoRow[] = [];

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: mock(async () => {}),
  prisma: {
    task: {
      findUnique: mock((args: { where: { id: number } }) =>
        Promise.resolve(taskRows.find((r) => r.id === args.where.id) ?? null),
      ),
      findMany: mock((args: { where?: { status?: string }; take?: number }) => {
        const filtered = taskRows.filter(
          (r) => !args?.where?.status || r.status === args.where.status,
        );
        const sorted = [...filtered].sort(
          (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
        );
        return Promise.resolve(args?.take ? sorted.slice(0, args.take) : sorted);
      }),
    },
    promptEvolution: {
      findUnique: mock((args: { where: { id: number } }) =>
        Promise.resolve(evoRows.find((r) => r.id === args.where.id) ?? null),
      ),
      findMany: mock((args: { where?: { status?: string } }) =>
        Promise.resolve(
          evoRows.filter((r) => !args?.where?.status || r.status === args.where.status),
        ),
      ),
    },
  },
}));

mock.module('../../workflow/workflow-cli-executor-helpers', () => ({
  resolveGitRoot: mock(async () => '/repo'),
}));

interface CellCallArgs {
  sampleTaskId: number;
  arm: string;
  knowledge: string;
}
let cellResults: Map<string, { success: boolean; costUsd: number }> = new Map();
let cellCalls: CellCallArgs[] = [];
const runComparisonCellMock = mock(async (args: CellCallArgs) => {
  cellCalls.push({ sampleTaskId: args.sampleTaskId, arm: args.arm, knowledge: args.knowledge });
  const key = `${args.arm}:${args.knowledge}:${args.sampleTaskId}`;
  const outcome = cellResults.get(key) ?? { success: true, costUsd: 0.1 };
  return {
    taskId: args.sampleTaskId,
    executionId: -1,
    success: outcome.success,
    costUsd: outcome.costUsd,
    durationMs: 100,
    failureCause: outcome.success ? null : ('implementation_error' as const),
  };
});
mock.module('./prompt-comparison-cell-executor', () => ({
  runComparisonCell: (args: CellCallArgs) => runComparisonCellMock(args),
}));

const {
  runPromptComparison,
  beginComparisonRun,
  finishComparisonRun,
  triggerComparisonsForPendingProposals,
  ComparisonLockedError,
} = await import('./prompt-comparison-runner');
const { readComparisonRecord, acquireComparisonLock, releaseComparisonLock } =
  await import('./prompt-comparison-store');

let tmpDir: string;
let savedDataDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rapitas-comparison-runner-'));
  savedDataDir = process.env.RAPITAS_DATA_DIR;
  process.env.RAPITAS_DATA_DIR = tmpDir;
  taskRows = [
    {
      id: 810,
      title: 'サンプルタスクA',
      description: '説明A',
      workingDirectory: null,
      status: 'done',
      completedAt: new Date('2026-01-02'),
      theme: { workingDirectory: '/repo', repositoryUrl: null },
    },
    {
      id: 811,
      title: 'サンプルタスクB',
      description: '説明B',
      workingDirectory: null,
      status: 'done',
      completedAt: new Date('2026-01-01'),
      theme: { workingDirectory: '/repo', repositoryUrl: null },
    },
  ];
  evoRows = [
    {
      id: 7,
      basePromptKey: 'workflow_role_implementer',
      afterPrompt: '改善指示テキスト',
      status: 'proposed',
    },
  ];
  cellResults = new Map();
  cellCalls = [];
  runComparisonCellMock.mockClear();
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = savedDataDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runPromptComparison — lock', () => {
  it('rejects when a run for the same candidate is already in progress', async () => {
    expect(acquireComparisonLock(7)).toBe(true);
    await expect(runPromptComparison({ evolutionId: 7, sampleTaskIds: [810] })).rejects.toThrow(
      ComparisonLockedError,
    );
    releaseComparisonLock(7);
  });

  it('releases the lock after a successful run (a second call can proceed)', async () => {
    await runPromptComparison({ evolutionId: 7, sampleTaskIds: [810] });
    expect(acquireComparisonLock(7)).toBe(true);
    releaseComparisonLock(7);
  });

  it('releases the lock even when cell execution throws', async () => {
    runComparisonCellMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(runPromptComparison({ evolutionId: 7, sampleTaskIds: [810] })).rejects.toThrow(
      'boom',
    );
    expect(acquireComparisonLock(7)).toBe(true);
    releaseComparisonLock(7);
  });
});

describe('runPromptComparison — completion', () => {
  it('writes a done record readable via readComparisonRecord', async () => {
    await runPromptComparison({ evolutionId: 7, sampleTaskIds: [810, 811] });
    const record = readComparisonRecord(7);
    expect(record?.status).toBe('done');
    expect(record?.arms).toHaveLength(4);
  });

  it('runs all 4 cells x 2 samples = 8 shadow executions by default', async () => {
    await runPromptComparison({ evolutionId: 7, sampleTaskIds: [810, 811], budgetUsd: 100 });
    expect(cellCalls).toHaveLength(8);
  });
});

describe('runPromptComparison — sample task not found', () => {
  it('skips a missing sample task id and still completes with the remaining sample', async () => {
    await runPromptComparison({ evolutionId: 7, sampleTaskIds: [810, 99999], budgetUsd: 100 });
    expect(cellCalls.every((c) => c.sampleTaskId === 810)).toBe(true);
    expect(cellCalls).toHaveLength(4);
    const record = readComparisonRecord(7);
    expect(record?.status).toBe('done');
  });
});

describe('runPromptComparison — budget exhaustion', () => {
  it('stops issuing new cell executions once the cumulative cost reaches budgetUsd', async () => {
    cellResults.set('current:with:810', { success: true, costUsd: 10 });
    await runPromptComparison({ evolutionId: 7, sampleTaskIds: [810], budgetUsd: 5 });
    // Order is arm(current) -> knowledge(with) -> knowledge(without) -> arm(candidate)...
    // current:with costs 10 >= budget 5, so nothing after it should run.
    expect(cellCalls.length).toBeLessThan(4);
  });

  it('keeps the already-completed cell results in the final record', async () => {
    cellResults.set('current:with:810', { success: true, costUsd: 10 });
    await runPromptComparison({ evolutionId: 7, sampleTaskIds: [810], budgetUsd: 5 });
    const record = readComparisonRecord(7);
    const currentWith = record?.arms.find((c) => c.arm === 'current' && c.knowledge === 'with');
    expect(currentWith?.runs).toHaveLength(1);
  });
});

describe('beginComparisonRun / finishComparisonRun split (route usage)', () => {
  it('beginComparisonRun seeds an in_progress record synchronously', () => {
    const seeded = beginComparisonRun({
      evolutionId: 42,
      role: 'implementer',
      modelName: 'claude-sonnet-5',
      sampleTaskIds: [810],
      budgetUsd: 3,
    });
    expect(seeded.status).toBe('in_progress');
    expect(readComparisonRecord(42)).toBeNull(); // in_progress reads as absent (store contract)
    releaseComparisonLock(42);
  });

  it('beginComparisonRun throws ComparisonLockedError when already locked', () => {
    expect(acquireComparisonLock(43)).toBe(true);
    expect(() =>
      beginComparisonRun({
        evolutionId: 43,
        role: 'implementer',
        modelName: 'claude-sonnet-5',
        sampleTaskIds: [810],
        budgetUsd: 3,
      }),
    ).toThrow(ComparisonLockedError);
    releaseComparisonLock(43);
  });

  it('finishComparisonRun completes and releases a lock begun separately', async () => {
    beginComparisonRun({
      evolutionId: 44,
      role: 'implementer',
      modelName: 'claude-sonnet-5',
      sampleTaskIds: [810],
      budgetUsd: 3,
    });
    await finishComparisonRun({
      evolutionId: 44,
      role: 'implementer',
      modelName: 'claude-sonnet-5',
      afterPrompt: '',
      sampleTaskIds: [810],
      budgetUsd: 3,
    });
    expect(readComparisonRecord(44)?.status).toBe('done');
    expect(acquireComparisonLock(44)).toBe(true);
    releaseComparisonLock(44);
  });
});

describe('triggerComparisonsForPendingProposals', () => {
  it('runs a comparison for a proposed candidate with no existing record', async () => {
    await triggerComparisonsForPendingProposals(2);
    expect(readComparisonRecord(7)?.status).toBe('done');
  });

  it('skips a proposed candidate that already has a completed comparison', async () => {
    await runPromptComparison({ evolutionId: 7, sampleTaskIds: [810] });
    runComparisonCellMock.mockClear();
    await triggerComparisonsForPendingProposals(2);
    expect(runComparisonCellMock).toHaveBeenCalledTimes(0);
  });

  it('continues to the next candidate when one candidate fails', async () => {
    evoRows.push({
      id: 8,
      basePromptKey: 'workflow_role_planner',
      afterPrompt: '改善指示B',
      status: 'proposed',
    });
    runComparisonCellMock.mockImplementationOnce(() => {
      throw new Error('shadow run crashed');
    });
    await triggerComparisonsForPendingProposals(2);
    expect(readComparisonRecord(8)?.status).toBe('done');
  });
});
