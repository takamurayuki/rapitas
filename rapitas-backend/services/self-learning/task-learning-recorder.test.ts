/**
 * task-learning-recorder テスト
 *
 * タスク終端時に Experiment / Episode / 概念ノードが記録され、taskId で
 * 1実験に upsert されることを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const experimentFindFirst = mock(async () => null as { id: number } | null);
const experimentCreate = mock(async () => ({ id: 101 }));
const experimentUpdate = mock(async () => ({ id: 101 }));
const saveEpisode = mock(async () => ({ id: 1 }));
const addNode = mock(async () => ({ id: 1 }));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    experiment: {
      findFirst: experimentFindFirst,
      create: experimentCreate,
      update: experimentUpdate,
    },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./episode-memory', () => ({ saveEpisode }));
mock.module('./knowledge-graph', () => ({ addNode }));

const { recordTaskLearningArtifacts } = await import('./task-learning-recorder');

describe('recordTaskLearningArtifacts', () => {
  beforeEach(() => {
    experimentFindFirst.mockClear();
    experimentCreate.mockClear();
    experimentUpdate.mockClear();
    saveEpisode.mockClear();
    addNode.mockClear();
    experimentFindFirst.mockResolvedValue(null);
  });

  test('completed task → new experiment(status=completed) + success episode + concept node', async () => {
    await recordTaskLearningArtifacts(42, 'completed', {
      title: '[Refactor] cache TTL',
      themeId: 1,
    });
    expect(experimentCreate).toHaveBeenCalledTimes(1);
    expect(experimentCreate.mock.calls[0]![0].data.status).toBe('completed');
    expect(saveEpisode.mock.calls[0]![0].outcome).toBe('success');
    expect(addNode.mock.calls[0]![0].label).toBe('Refactor'); // from [Refactor] prefix
    expect(addNode.mock.calls[0]![0].nodeType).toBe('concept');
  });

  test('blocked task → experiment status=failed + failure episode', async () => {
    await recordTaskLearningArtifacts(43, 'blocked', { title: 'no prefix task' });
    expect(experimentCreate.mock.calls[0]![0].data.status).toBe('failed');
    expect(saveEpisode.mock.calls[0]![0].outcome).toBe('failure');
    expect(addNode.mock.calls[0]![0].label).toBe('general'); // no [Type] prefix → general
  });

  test('re-run of an existing task UPDATES its experiment (no double-count)', async () => {
    experimentFindFirst.mockResolvedValue({ id: 101 });
    await recordTaskLearningArtifacts(42, 'completed', { title: '[Bug] fix' });
    expect(experimentCreate).not.toHaveBeenCalled();
    expect(experimentUpdate).toHaveBeenCalledTimes(1);
    expect(experimentUpdate.mock.calls[0]![0].data.status).toBe('completed');
  });

  test('a DB error never throws (best-effort)', async () => {
    experimentFindFirst.mockRejectedValue(new Error('db down'));
    experimentCreate.mockRejectedValue(new Error('db down'));
    await expect(recordTaskLearningArtifacts(99, 'completed', {})).resolves.toBeUndefined();
  });
});
