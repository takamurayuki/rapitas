/**
 * task-learning-recorder テスト
 *
 * タスク終端時に Experiment / Episode / 知識グラフノードが記録され、taskId で
 * 1実験に upsert されること、confidence がゲート履歴から導出されること、
 * ノードが複数タイプ(concept/technology/pattern/problem/solution)で
 * 書かれることを検証する。Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const experimentFindFirst = mock(async () => null as { id: number } | null);
const experimentCreate = mock(async () => ({ id: 101 }));
const experimentUpdate = mock(async () => ({ id: 101 }));
const transitionFindMany = mock(async () => [] as Array<{ cause: string }>);
const saveEpisode = mock(async () => ({ id: 1 }));
let nodeId = 0;
const addNode = mock(async () => ({ id: ++nodeId }));
const addEdge = mock(async () => ({ id: 1 }));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    experiment: {
      findFirst: experimentFindFirst,
      create: experimentCreate,
      update: experimentUpdate,
    },
    workflowTransition: {
      findMany: transitionFindMany,
    },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./episode-memory', () => ({ saveEpisode }));
mock.module('./knowledge-graph', () => ({ addNode, addEdge }));

const { recordTaskLearningArtifacts } = await import('./task-learning-recorder');

/** All addNode calls of a given nodeType. */
function nodesOfType(type: string) {
  return addNode.mock.calls
    .map((c) => c[0] as unknown as { label: string; nodeType: string })
    .filter((n) => n.nodeType === type);
}

describe('recordTaskLearningArtifacts', () => {
  beforeEach(() => {
    experimentFindFirst.mockClear();
    experimentCreate.mockClear();
    experimentUpdate.mockClear();
    transitionFindMany.mockClear();
    saveEpisode.mockClear();
    addNode.mockClear();
    addEdge.mockClear();
    nodeId = 0;
    experimentFindFirst.mockResolvedValue(null);
    transitionFindMany.mockResolvedValue([]);
  });

  test('completed task → new experiment(status=completed) + success episode + concept node', async () => {
    await recordTaskLearningArtifacts(42, 'completed', {
      title: '[Refactor] cache TTL',
      themeId: 1,
    });
    expect(experimentCreate).toHaveBeenCalledTimes(1);
    expect(experimentCreate.mock.calls[0]![0].data.status).toBe('completed');
    expect(saveEpisode.mock.calls[0]![0].outcome).toBe('success');
    const concepts = nodesOfType('concept');
    expect(concepts).toHaveLength(1);
    expect(concepts[0].label).toBe('Refactor'); // from [Refactor] prefix
  });

  test('clean first-pass success carries HIGH confidence (0.95), not the legacy 0.8', async () => {
    await recordTaskLearningArtifacts(42, 'completed', { title: '[Bug] fix' });
    expect(experimentCreate.mock.calls[0]![0].data.confidence).toBeCloseTo(0.95);
  });

  test('gate rejections lower the derived confidence', async () => {
    transitionFindMany.mockResolvedValue([
      { cause: 'verify_repair' },
      { cause: 'verify_repair' },
      { cause: 'adversarial_review_failed' },
    ]);
    await recordTaskLearningArtifacts(42, 'completed', { title: '[Bug] fix' });
    // 0.95 - 0.15 - 0.15 - 0.12 = 0.53
    expect(experimentCreate.mock.calls[0]![0].data.confidence).toBeCloseTo(0.53);
    // Distinct causes become problem nodes; recovery becomes a solution node.
    expect(
      nodesOfType('problem')
        .map((n) => n.label)
        .sort(),
    ).toEqual(['adversarial_review_failed', 'verify_repair']);
    expect(nodesOfType('solution').map((n) => n.label)).toEqual(['self_repair_recovery']);
    // Edges wire the correlation the pitfall warning reads: concept —causes→
    // each problem, and the solution —solves→ each problem.
    const edgeTypes = addEdge.mock.calls.map(
      (c) => (c[0] as unknown as { edgeType: string }).edgeType,
    );
    expect(edgeTypes.filter((t) => t === 'causes')).toHaveLength(2);
    expect(edgeTypes.filter((t) => t === 'solves')).toHaveLength(2);
  });

  test('blocked task → experiment status=failed + failure episode + failed problem node', async () => {
    await recordTaskLearningArtifacts(43, 'blocked', { title: 'no prefix task' });
    expect(experimentCreate.mock.calls[0]![0].data.status).toBe('failed');
    expect(experimentCreate.mock.calls[0]![0].data.confidence).toBeCloseTo(0.25);
    expect(saveEpisode.mock.calls[0]![0].outcome).toBe('failure');
    expect(nodesOfType('concept')[0].label).toBe('general'); // no [Type] prefix → general
    expect(nodesOfType('problem').map((n) => n.label)).toEqual(['failed:blocked']);
    expect(nodesOfType('solution')).toHaveLength(0);
  });

  test('title keywords become technology nodes; workflow mode becomes a pattern node', async () => {
    await recordTaskLearningArtifacts(44, 'completed', {
      title: '[Feature] Prisma スキーマとReactフォームの追加',
      workflowMode: 'standard',
    });
    expect(
      nodesOfType('technology')
        .map((n) => n.label)
        .sort(),
    ).toEqual(['Prisma', 'React']);
    expect(nodesOfType('pattern').map((n) => n.label)).toEqual(['mode:standard']);
  });

  test('re-run of an existing task UPDATES its experiment (no double-count)', async () => {
    experimentFindFirst.mockResolvedValue({ id: 101 });
    await recordTaskLearningArtifacts(42, 'completed', { title: '[Bug] fix' });
    expect(experimentCreate).not.toHaveBeenCalled();
    expect(experimentUpdate).toHaveBeenCalledTimes(1);
    expect(experimentUpdate.mock.calls[0]![0].data.status).toBe('completed');
  });

  test('transition lookup failure falls back to legacy constants (best-effort)', async () => {
    transitionFindMany.mockRejectedValue(new Error('db down'));
    await recordTaskLearningArtifacts(45, 'completed', { title: '[Bug] fix' });
    expect(experimentCreate.mock.calls[0]![0].data.confidence).toBeCloseTo(0.8);
  });

  test('a DB error never throws (best-effort)', async () => {
    experimentFindFirst.mockRejectedValue(new Error('db down'));
    experimentCreate.mockRejectedValue(new Error('db down'));
    await expect(recordTaskLearningArtifacts(99, 'completed', {})).resolves.toBeUndefined();
  });
});
