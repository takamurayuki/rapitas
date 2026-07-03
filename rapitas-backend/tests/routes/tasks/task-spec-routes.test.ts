/**
 * Task Spec Routes テスト
 * 自由記述からのタスク仕様抽出エンドポイントのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { loggerModuleFactory } from '../../helpers/mock-logger';

const mockDeriveTaskSpec = mock(() =>
  Promise.resolve({
    spec: { goals: [], constraints: [], acceptanceCriteria: [] },
    source: 'empty' as const,
  }),
);

mock.module('../../../services/task/task-spec-deriver', () => ({
  deriveTaskSpec: mockDeriveTaskSpec,
}));
mock.module('../../../config/logger', loggerModuleFactory);

const { taskSpecRoutes } = await import('../../../routes/tasks/task-spec-routes');

function createApp() {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Server error' };
    })
    .use(taskSpecRoutes);
}

function post(body: unknown) {
  return new Request('http://localhost/tasks/derive-spec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /tasks/derive-spec', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    mockDeriveTaskSpec.mockReset().mockResolvedValue({
      spec: { goals: [], constraints: [], acceptanceCriteria: [] },
      source: 'empty',
    });
    app = createApp();
  });

  test('source=aiの場合はsuccess:trueで抽出結果を返すこと', async () => {
    mockDeriveTaskSpec.mockResolvedValue({
      spec: {
        goals: ['goal1'],
        constraints: ['constraint1'],
        acceptanceCriteria: ['ac1'],
      },
      source: 'ai',
    });

    const res = await app.handle(post({ description: '認証機能を追加する' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      source: 'ai',
      goals: ['goal1'],
      constraints: ['constraint1'],
      acceptanceCriteria: ['ac1'],
    });
    expect(mockDeriveTaskSpec).toHaveBeenCalledWith('認証機能を追加する');
  });

  test('source=emptyの場合もsuccess:trueを返すこと', async () => {
    mockDeriveTaskSpec.mockResolvedValue({
      spec: { goals: [], constraints: [], acceptanceCriteria: [] },
      source: 'empty',
    });

    const res = await app.handle(post({ description: '' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.source).toBe('empty');
  });

  test('source=fallback等ai/empty以外はsuccess:falseを返すこと', async () => {
    mockDeriveTaskSpec.mockResolvedValue({
      spec: { goals: [], constraints: [], acceptanceCriteria: [] },
      source: 'fallback',
    });

    const res = await app.handle(post({ description: 'テスト' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.source).toBe('fallback');
  });

  test('descriptionが無い場合はバリデーションエラーを返すこと', async () => {
    const res = await app.handle(post({}));
    expect(res.status).toBe(422);
    expect(mockDeriveTaskSpec).not.toHaveBeenCalled();
  });

  test('deriveTaskSpecがエラーを投げた場合はエラーハンドラに伝播すること', async () => {
    mockDeriveTaskSpec.mockRejectedValue(new Error('AI unavailable'));

    const res = await app.handle(post({ description: 'テスト' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('AI unavailable');
  });
});
