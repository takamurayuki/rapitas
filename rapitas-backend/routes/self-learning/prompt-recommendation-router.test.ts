/**
 * prompt-recommendation-router ユニットテスト
 *
 * GET /self-learning/prompt-recommendation の入力検証(400)、未存在タスク(404)、
 * 複雑度未設定(422)、正常系(200: 難度帯と推薦結果の受け渡し)を Elysia handle() で検証する。
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
}));

let taskRow: { complexityScore: number | null } | null = null;
const taskFindUnique = mock(() => Promise.resolve(taskRow));
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: async () => {},
  prisma: { task: { findUnique: taskFindUnique } },
}));

const recommendPromptVersion = mock((_role: string, _model: string, score: number) =>
  Promise.resolve({
    band: score > 70 ? 'comprehensive' : 'standard',
    recommendedVersionId: 7,
    successRate: 0.85,
    sampleSize: 12,
    confidenceScore: 0.6,
    explorationMode: false,
  }),
);
mock.module('../../services/self-learning/comparison/prompt-version-history', () => ({
  recommendPromptVersion,
}));

const { promptRecommendationRoutes } = await import('./prompt-recommendation-router');

const URL_BASE = 'http://localhost/self-learning/prompt-recommendation';
const get = (qs: string) => promptRecommendationRoutes.handle(new Request(`${URL_BASE}?${qs}`));

beforeEach(() => {
  taskRow = null;
  taskFindUnique.mockClear();
  recommendPromptVersion.mockClear();
});

describe('GET /self-learning/prompt-recommendation', () => {
  test('taskId が数値でなければ400を返し、推薦計算を呼ばない', async () => {
    const res = await get('role=implementer&model=m&taskId=abc');
    expect(res.status).toBe(400);
    expect(recommendPromptVersion).not.toHaveBeenCalled();
  });

  test('必須クエリが欠けると入力検証エラーになる', async () => {
    const res = await get('role=implementer&taskId=1');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(recommendPromptVersion).not.toHaveBeenCalled();
  });

  test('タスクが存在しなければ404', async () => {
    taskRow = null;
    const res = await get('role=implementer&model=m&taskId=999');
    expect(res.status).toBe(404);
    expect(recommendPromptVersion).not.toHaveBeenCalled();
  });

  test('complexityScore 未設定のタスクは422', async () => {
    taskRow = { complexityScore: null };
    const res = await get('role=implementer&model=m&taskId=1');
    expect(res.status).toBe(422);
    expect(recommendPromptVersion).not.toHaveBeenCalled();
  });

  test('正常系: タスクの complexityScore で推薦結果を返す', async () => {
    taskRow = { complexityScore: 80 };
    const res = await get('role=implementer&model=claude-sonnet-5&taskId=1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      band: 'comprehensive',
      recommendedVersionId: 7,
      successRate: 0.85,
      sampleSize: 12,
      confidenceScore: 0.6,
      explorationMode: false,
    });
    expect(recommendPromptVersion).toHaveBeenCalledWith('implementer', 'claude-sonnet-5', 80);
  });
});
