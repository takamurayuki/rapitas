/**
 * dag-query.test.ts
 *
 * Unit tests for getDecisionDag: normal DAG reconstruction, unknown-parent
 * pruning, corrupt parentKeys tolerance, and defensive cycle handling.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockFindMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;

mock.module('../../../config/database', () => ({
  prisma: {
    agentDecisionTrace: { findMany: mockFindMany },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../../config/logger', () => {
  const noopLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { getDecisionDag } = await import('./dag-query');

/** Minimal row factory — only the fields dag-query reads. */
function row(id: number, nodeKey: string, parentKeys: string[] | string): Record<string, unknown> {
  return {
    id,
    taskId: 1,
    executionId: null,
    sessionId: null,
    nodeKey,
    parentKeys: typeof parentKeys === 'string' ? parentKeys : JSON.stringify(parentKeys),
    kind: 'param_select',
    summary: nodeKey,
    stage: 'lite',
    inputMasked: '{}',
    candidatesMasked: '[]',
    adoptedId: 'x',
    adoptedReason: 'r',
    rejectedReasons: '{}',
    consistency: 'pending',
    consistencyNote: null,
    createdAt: new Date(0),
    verifiedAt: null,
  };
}

beforeEach(() => {
  mockFindMany.mockReset();
  mockFindMany.mockResolvedValue([]);
});

describe('getDecisionDag', () => {
  it('throws when neither taskId nor executionId is given', async () => {
    await expect(getDecisionDag({})).rejects.toThrow('taskId or executionId');
  });

  it('reconstructs nodes and parent→child edges', async () => {
    mockFindMany.mockResolvedValueOnce([row(1, 'A', []), row(2, 'B', ['A']), row(3, 'C', ['A', 'B'])]);
    const dag = await getDecisionDag({ taskId: 1 });
    expect(dag.nodes).toHaveLength(3);
    expect(dag.edges).toEqual([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
    ]);
  });

  it('drops edges to parents outside the result set', async () => {
    mockFindMany.mockResolvedValueOnce([row(1, 'B', ['ghost'])]);
    const dag = await getDecisionDag({ executionId: 9 });
    expect(dag.nodes).toHaveLength(1);
    expect(dag.edges).toEqual([]);
  });

  it('tolerates corrupt parentKeys JSON', async () => {
    mockFindMany.mockResolvedValueOnce([row(1, 'A', 'not-json'), row(2, 'B', '{"o":1}')]);
    const dag = await getDecisionDag({ taskId: 1 });
    expect(dag.nodes).toHaveLength(2);
    expect(dag.edges).toEqual([]);
  });

  it('drops cyclic edges but keeps the nodes, without throwing', async () => {
    mockFindMany.mockResolvedValueOnce([
      row(1, 'A', ['B']),
      row(2, 'B', ['A']),
      row(3, 'C', ['A']),
    ]);
    const dag = await getDecisionDag({ taskId: 1 });
    expect(dag.nodes).toHaveLength(3);
    // A↔B edges removed; the A→C edge survives (C is not on the cycle).
    expect(dag.edges).toEqual([{ from: 'A', to: 'C' }]);
  });

  it('handles a self-loop defensively', async () => {
    mockFindMany.mockResolvedValueOnce([row(1, 'A', ['A'])]);
    const dag = await getDecisionDag({ taskId: 1 });
    expect(dag.nodes).toHaveLength(1);
    expect(dag.edges).toEqual([]);
  });
});
