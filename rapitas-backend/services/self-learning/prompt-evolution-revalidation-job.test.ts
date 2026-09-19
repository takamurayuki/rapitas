/**
 * prompt-evolution-revalidation-job.test
 *
 * Fixture-driven tests for the monthly/model-drift revalidation pass: the
 * enable flag, the two triggers, the regression verdict, and the
 * always-updates-lastRevalidatedAt contract.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => {
  const noop = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const createNotification = mock(async () => ({}));
mock.module('../communication/notification-service', () => ({
  createNotification,
}));
mock.module('../communication/notification-i18n', () => ({
  buildNotificationI18n: (key: string, params?: Record<string, unknown>) => ({ key, params }),
}));

const { revalidateCompletedEvolutions, revalidateSingleEvolution } =
  await import('./prompt-evolution-revalidation-job');

interface Row {
  id: number;
  basePromptKey: string | null;
  evidenceJson: string | null;
  lastRevalidatedModelVersion: string | null;
}

function makePrisma(rows: Row[], currentModelVersion: string | null = 'claude-sonnet-5') {
  const updates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
  return {
    updates,
    prisma: {
      promptEvolution: {
        findMany: () => Promise.resolve(rows),
        update: (args: { where: { id: number }; data: Record<string, unknown> }) => {
          updates.push(args);
          return Promise.resolve(args);
        },
      },
      agentExecution: {
        findFirst: () => Promise.resolve({ modelName: currentModelVersion }),
      },
    },
  };
}

describe('revalidateCompletedEvolutions', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED;
    createNotification.mockClear();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED;
    else process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED = saved;
  });

  test('does nothing when disabled (default)', async () => {
    delete process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED;
    const { prisma, updates } = makePrisma([
      {
        id: 1,
        basePromptKey: 'workflow_role_implementer',
        evidenceJson: null,
        lastRevalidatedModelVersion: null,
      },
    ]);
    const summary = await revalidateCompletedEvolutions(prisma, true);
    expect(summary).toEqual({ checked: 0, skipped: 0, regressions: 0 });
    expect(updates).toHaveLength(0);
  });

  test('regression detected: notifies and always updates lastRevalidatedAt', async () => {
    process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED = 'true';
    const { prisma, updates } = makePrisma([
      {
        id: 2,
        basePromptKey: 'workflow_role_implementer',
        evidenceJson: '{"beforeRate":0.8}',
        lastRevalidatedModelVersion: 'claude-sonnet-5',
      },
    ]);
    const evaluate = mock(() => Promise.resolve({ totalRuns: 6, successRate: 0.5 }));
    const summary = await revalidateCompletedEvolutions(prisma, true, evaluate);
    expect(summary).toEqual({ checked: 1, skipped: 0, regressions: 1 });
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.lastRevalidatedAt).toBeInstanceOf(Date);
    expect(updates[0].data.lastRevalidatedModelVersion).toBe('claude-sonnet-5');
  });

  test('no regression: updates lastRevalidatedAt but does not notify', async () => {
    process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED = 'true';
    const { prisma, updates } = makePrisma([
      {
        id: 3,
        basePromptKey: 'workflow_role_planner',
        evidenceJson: '{"beforeRate":0.5}',
        lastRevalidatedModelVersion: 'claude-sonnet-5',
      },
    ]);
    const evaluate = mock(() => Promise.resolve({ totalRuns: 6, successRate: 0.8 }));
    const summary = await revalidateCompletedEvolutions(prisma, true, evaluate);
    expect(summary).toEqual({ checked: 1, skipped: 0, regressions: 0 });
    expect(createNotification).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
  });

  test('insufficient sample: no notification, no verdict, still counted as checked', async () => {
    process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED = 'true';
    const { prisma, updates } = makePrisma([
      {
        id: 4,
        basePromptKey: 'workflow_role_verifier',
        evidenceJson: '{"beforeRate":0.5}',
        lastRevalidatedModelVersion: 'claude-sonnet-5',
      },
    ]);
    const evaluate = mock(() => Promise.resolve({ totalRuns: 2, successRate: 0.1 }));
    const summary = await revalidateCompletedEvolutions(prisma, true, evaluate);
    expect(summary).toEqual({ checked: 1, skipped: 0, regressions: 0 });
    expect(createNotification).not.toHaveBeenCalled();
    // lastRevalidatedAt updates every attempted check per plan.md ("毎回更新").
    expect(updates).toHaveLength(1);
  });

  test('forceAll=false + unchanged model: skips the row without evaluating', async () => {
    process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED = 'true';
    const { prisma, updates } = makePrisma(
      [
        {
          id: 5,
          basePromptKey: 'workflow_role_implementer',
          evidenceJson: '{"beforeRate":0.5}',
          lastRevalidatedModelVersion: 'claude-sonnet-5',
        },
      ],
      'claude-sonnet-5',
    );
    const evaluate = mock(() => Promise.resolve({ totalRuns: 6, successRate: 0.9 }));
    const summary = await revalidateCompletedEvolutions(prisma, false, evaluate);
    expect(summary).toEqual({ checked: 0, skipped: 1, regressions: 0 });
    expect(evaluate).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  test('forceAll=false + model drift: evaluates despite not being the monthly trigger', async () => {
    process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED = 'true';
    const { prisma, updates } = makePrisma(
      [
        {
          id: 6,
          basePromptKey: 'workflow_role_implementer',
          evidenceJson: '{"beforeRate":0.5}',
          lastRevalidatedModelVersion: 'claude-sonnet-4',
        },
      ],
      'claude-sonnet-5',
    );
    const evaluate = mock(() => Promise.resolve({ totalRuns: 6, successRate: 0.9 }));
    const summary = await revalidateCompletedEvolutions(prisma, false, evaluate);
    expect(summary).toEqual({ checked: 1, skipped: 0, regressions: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0].data.lastRevalidatedModelVersion).toBe('claude-sonnet-5');
  });
});

describe('revalidateSingleEvolution', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED;
    process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED = 'false';
    createNotification.mockClear();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED;
    else process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED = saved;
  });

  function makeSinglePrisma(
    row: {
      id: number;
      basePromptKey: string | null;
      evidenceJson: string | null;
      lastRevalidatedModelVersion: string | null;
      abTested: boolean;
      significanceLevel: string | null;
      status: string;
    } | null,
    currentModelVersion: string | null = 'claude-sonnet-5',
  ) {
    const updates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
    return {
      updates,
      prisma: {
        promptEvolution: {
          findMany: () => Promise.resolve([]),
          findUnique: () => Promise.resolve(row),
          update: (args: { where: { id: number }; data: Record<string, unknown> }) => {
            updates.push(args);
            return Promise.resolve(args);
          },
        },
        agentExecution: {
          findFirst: () => Promise.resolve({ modelName: currentModelVersion }),
        },
      },
    };
  }

  test('id not found: returns not_found and writes nothing', async () => {
    const { prisma, updates } = makeSinglePrisma(null);
    const result = await revalidateSingleEvolution(prisma, 999);
    expect(result).toEqual({ status: 'not_found' });
    expect(updates).toHaveLength(0);
  });

  test('non-completed row: returns not_applicable, bypassing the disabled flag', async () => {
    const { prisma, updates } = makeSinglePrisma({
      id: 7,
      basePromptKey: 'workflow_role_implementer',
      evidenceJson: '{"beforeRate":0.5}',
      lastRevalidatedModelVersion: 'claude-sonnet-5',
      abTested: false,
      significanceLevel: null,
      status: 'approved',
    });
    const result = await revalidateSingleEvolution(prisma, 7);
    expect(result).toEqual({ status: 'not_applicable' });
    expect(updates).toHaveLength(0);
  });

  test('regression detected: manual trigger runs even while the automated flag is disabled', async () => {
    const { prisma, updates } = makeSinglePrisma({
      id: 8,
      basePromptKey: 'workflow_role_implementer',
      evidenceJson: '{"beforeRate":0.8}',
      lastRevalidatedModelVersion: 'claude-sonnet-5',
      abTested: true,
      significanceLevel: 'low',
      status: 'completed',
    });
    const evaluate = mock(() => Promise.resolve({ totalRuns: 6, successRate: 0.5 }));
    const result = await revalidateSingleEvolution(prisma, 8, evaluate);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.treeConfidence).toBe('low');
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.treeConfidence).toBe('low');
  });

  test('no regression: treeConfidence recomputed from abTested/significanceLevel/status', async () => {
    const { prisma, updates } = makeSinglePrisma({
      id: 9,
      basePromptKey: 'workflow_role_planner',
      evidenceJson: '{"beforeRate":0.5}',
      lastRevalidatedModelVersion: 'claude-sonnet-5',
      abTested: true,
      significanceLevel: 'low',
      status: 'completed',
    });
    const evaluate = mock(() => Promise.resolve({ totalRuns: 6, successRate: 0.8 }));
    const result = await revalidateSingleEvolution(prisma, 9, evaluate);
    expect(result).toEqual({
      status: 'ok',
      treeConfidence: 'high',
      lastRevalidatedAt: updates[0]?.data.lastRevalidatedAt,
    });
    expect(createNotification).not.toHaveBeenCalled();
  });

  test('insufficient sample: reports insufficient_data without a verdict', async () => {
    const { prisma, updates } = makeSinglePrisma({
      id: 10,
      basePromptKey: 'workflow_role_verifier',
      evidenceJson: '{"beforeRate":0.5}',
      lastRevalidatedModelVersion: 'claude-sonnet-5',
      abTested: false,
      significanceLevel: null,
      status: 'completed',
    });
    const evaluate = mock(() => Promise.resolve({ totalRuns: 2, successRate: 0.1 }));
    const result = await revalidateSingleEvolution(prisma, 10, evaluate);
    expect(result.status).toBe('insufficient_data');
    expect(createNotification).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
  });
});
