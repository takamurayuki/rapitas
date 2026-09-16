/**
 * prompt-evolution-tree.routes.test
 *
 * Route-level tests via Elysia handle(): GET tree (empty/non-empty/500 on
 * failure) and POST :id/revalidate (200/404/409/400).
 */
import { describe, expect, it, mock } from 'bun:test';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
};

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

let findManyResult: unknown[] = [];
let findManyError: Error | null = null;

mock.module('../../config/database', () => ({
  prisma: {
    promptEvolution: {
      findMany: () =>
        findManyError ? Promise.reject(findManyError) : Promise.resolve(findManyResult),
    },
  },
}));

const revalidateSingleEvolution = mock(async (_prisma: unknown, id: number) => {
  if (id === 404) return { status: 'not_found' as const };
  if (id === 409) return { status: 'not_applicable' as const };
  return { status: 'ok' as const, treeConfidence: 'high' as const, lastRevalidatedAt: new Date(0) };
});
mock.module('../../services/self-learning/prompt-evolution-revalidation-job', () => ({
  revalidateSingleEvolution,
}));

const promptEvolutionTreeRoutes = (await import('./prompt-evolution-tree.routes')).default;

const BASE = 'http://localhost/learning';

describe('GET /learning/prompt-evolution/tree', () => {
  it('returns an empty roots array when no rows exist', async () => {
    findManyResult = [];
    findManyError = null;
    const res = await promptEvolutionTreeRoutes.handle(
      new Request(`${BASE}/prompt-evolution/tree`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roots: [] });
  });

  it('builds a nested tree from parentId-linked rows', async () => {
    findManyResult = [
      {
        id: 1,
        parentId: null,
        status: 'completed',
        basePromptKey: 'workflow_role_planner',
        taskType: 'planner',
        performanceDelta: 0.1,
        significanceLevel: 'low',
        applicableConditionsJson: null,
        failureCasesJson: null,
        abTested: true,
        abComparisonRef: '1',
        createdAt: new Date(2026, 0, 1).toISOString(),
      },
      {
        id: 2,
        parentId: 1,
        status: 'pending',
        basePromptKey: 'workflow_role_planner',
        taskType: 'planner',
        performanceDelta: 0,
        significanceLevel: null,
        applicableConditionsJson: null,
        failureCasesJson: null,
        abTested: false,
        abComparisonRef: null,
        createdAt: new Date(2026, 0, 2).toISOString(),
      },
    ];
    findManyError = null;
    const res = await promptEvolutionTreeRoutes.handle(
      new Request(`${BASE}/prompt-evolution/tree`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roots: Array<{ id: number; children: Array<{ id: number }> }>;
    };
    expect(body.roots).toHaveLength(1);
    expect(body.roots[0].id).toBe(1);
    expect(body.roots[0].children).toHaveLength(1);
    expect(body.roots[0].children[0].id).toBe(2);
  });

  it('500s and returns empty roots when the query fails', async () => {
    findManyResult = [];
    findManyError = new Error('db down');
    const res = await promptEvolutionTreeRoutes.handle(
      new Request(`${BASE}/prompt-evolution/tree`),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ roots: [] });
  });
});

describe('POST /learning/prompt-evolution/:id/revalidate', () => {
  it('400s on a non-integer id', async () => {
    const res = await promptEvolutionTreeRoutes.handle(
      new Request(`${BASE}/prompt-evolution/not-a-number/revalidate`, { method: 'POST' }),
    );
    expect(res.status).toBe(400);
  });

  it('404s when the row does not exist', async () => {
    const res = await promptEvolutionTreeRoutes.handle(
      new Request(`${BASE}/prompt-evolution/404/revalidate`, { method: 'POST' }),
    );
    expect(res.status).toBe(404);
  });

  it('409s when the row is not in completed status', async () => {
    const res = await promptEvolutionTreeRoutes.handle(
      new Request(`${BASE}/prompt-evolution/409/revalidate`, { method: 'POST' }),
    );
    expect(res.status).toBe(409);
  });

  it('200s with the recomputed confidence on success', async () => {
    const res = await promptEvolutionTreeRoutes.handle(
      new Request(`${BASE}/prompt-evolution/5/revalidate`, { method: 'POST' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      treeConfidence: 'high',
      lastRevalidatedAt: new Date(0).toISOString(),
    });
  });
});
