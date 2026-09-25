/**
 * learning.test
 *
 * Route-level tests via Elysia handle() for the prompt-comparison endpoints:
 * GET .../comparison (null vs a stored record) and POST .../stage (404 when
 * no comparison exists yet, 200 + persisted stagedTaskIds otherwise).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ComparisonRecord } from '../../services/self-learning/comparison/prompt-comparison-types';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

interface EvoRow {
  id: number;
  basePromptKey: string | null;
  afterPrompt: string;
  status: string;
}
let evoRows: EvoRow[] = [
  {
    id: 1,
    basePromptKey: 'workflow_role_implementer',
    afterPrompt: '改善指示',
    status: 'proposed',
  },
  { id: 2, basePromptKey: 'workflow_role_planner', afterPrompt: '改善指示B', status: 'approved' },
];

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: mock(async () => {}),
  prisma: {
    promptEvolution: {
      findUnique: mock((args: { where: { id: number } }) =>
        Promise.resolve(evoRows.find((r) => r.id === args.where.id) ?? null),
      ),
    },
  },
}));

const { learningRoutes } = await import('./learning');
const { writeComparisonRecord } =
  await import('../../services/self-learning/comparison/prompt-comparison-store');

const BASE = 'http://localhost/learning';

function comparisonRecord(overrides: Partial<ComparisonRecord> = {}): ComparisonRecord {
  return {
    promptEvolutionId: 1,
    role: 'implementer',
    modelName: 'claude-sonnet-5',
    budgetUsd: 2.5,
    createdAt: new Date(0).toISOString(),
    status: 'done',
    sampleTaskIds: [810, 812],
    arms: [],
    summary: null,
    knowledgeSnapshotHash: null,
    stagedTaskIds: null,
    stagedComplexityBands: null,
    ...overrides,
  };
}

let tmpDir: string;
let savedDataDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rapitas-learning-route-'));
  savedDataDir = process.env.RAPITAS_DATA_DIR;
  process.env.RAPITAS_DATA_DIR = tmpDir;
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = savedDataDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /learning/prompt-evolution/:id/comparison', () => {
  it('returns comparison: null when no record has been stored', async () => {
    const res = await learningRoutes.handle(new Request(`${BASE}/prompt-evolution/42/comparison`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comparison: null });
  });

  it('returns the stored record', async () => {
    writeComparisonRecord(comparisonRecord({ promptEvolutionId: 42 }));
    const res = await learningRoutes.handle(new Request(`${BASE}/prompt-evolution/42/comparison`));
    const body = (await res.json()) as { comparison: ComparisonRecord | null };
    expect(body.comparison?.promptEvolutionId).toBe(42);
  });

  it('400s on a non-integer id', async () => {
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/not-a-number/comparison`),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /learning/prompt-evolution/:id/compare', () => {
  it('400s on a non-integer id', async () => {
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/not-a-number/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleTaskIds: [810] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('404s when the candidate does not exist', async () => {
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/999/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleTaskIds: [810] }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('400s when the candidate is not in the proposed state', async () => {
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/2/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleTaskIds: [810] }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_proposed' });
  });

  it('202s and seeds a running record for a proposed candidate', async () => {
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/1/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleTaskIds: [810] }),
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: number; status: string };
    expect(body.status).toBe('running');
    expect(typeof body.runId).toBe('number');

    const { releaseComparisonLock } =
      await import('../../services/self-learning/comparison/prompt-comparison-store');
    releaseComparisonLock(1);
  });

  it('409s when a comparison for the same candidate is already in progress', async () => {
    const { acquireComparisonLock, releaseComparisonLock } =
      await import('../../services/self-learning/comparison/prompt-comparison-store');
    expect(acquireComparisonLock(1)).toBe(true);
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/1/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleTaskIds: [810] }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'comparison_locked' });
    releaseComparisonLock(1);
  });
});

describe('POST /learning/prompt-evolution/:id/stage', () => {
  it('404s when no comparison record exists yet', async () => {
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/42/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: [810, 812] }),
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'comparison_not_run' });
  });

  it('persists stagedTaskIds when a comparison record exists', async () => {
    writeComparisonRecord(comparisonRecord({ promptEvolutionId: 42 }));
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/42/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: [810, 812] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'staged', taskIds: [810, 812] });

    const check = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/42/comparison`),
    );
    const body = (await check.json()) as { comparison: ComparisonRecord | null };
    expect(body.comparison?.stagedTaskIds).toEqual([810, 812]);
  });

  it('persists stagedComplexityBands (task #970) without touching stagedTaskIds', async () => {
    writeComparisonRecord(comparisonRecord({ promptEvolutionId: 43, stagedTaskIds: [5] }));
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/43/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ complexityBands: ['light', 'standard'] }),
      }),
    );
    expect(res.status).toBe(200);

    const check = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/43/comparison`),
    );
    const body = (await check.json()) as { comparison: ComparisonRecord | null };
    expect(body.comparison?.stagedComplexityBands).toEqual(['light', 'standard']);
    expect(body.comparison?.stagedTaskIds).toEqual([5]);
  });

  it('400s on an unknown complexity band', async () => {
    writeComparisonRecord(comparisonRecord({ promptEvolutionId: 44 }));
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/44/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ complexityBands: ['trivial'] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('400s when neither taskIds nor complexityBands is given', async () => {
    writeComparisonRecord(comparisonRecord({ promptEvolutionId: 45 }));
    const res = await learningRoutes.handle(
      new Request(`${BASE}/prompt-evolution/45/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});
