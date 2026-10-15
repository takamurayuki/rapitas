/**
 * Task Auto-Generate Route テスト
 * 自動タスク生成エンドポイントのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { loggerModuleFactory } from '../../helpers/mock-logger';

const mockAutoGenerateTasks = mock(() =>
  Promise.resolve({
    generatedTasks: [],
    executionTriggered: false,
    prompt: '',
    ideasUsed: 0,
  }),
);

mock.module('../../../services/ai/auto-task-generator', () => ({
  autoGenerateTasks: mockAutoGenerateTasks,
}));
mock.module('../../../config/logger', loggerModuleFactory);

const { taskAutoGenerateRoutes } = await import('../../../routes/tasks/task-auto-generate');

function createApp() {
  return new Elysia()
    .onError(({ code, set }) => {
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return { error: 'Server error' };
    })
    .use(taskAutoGenerateRoutes);
}

function post(body: unknown) {
  return new Request('http://localhost/tasks/auto-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /tasks/auto-generate', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    mockAutoGenerateTasks.mockReset().mockResolvedValue({
      generatedTasks: [],
      executionTriggered: false,
      prompt: '',
      ideasUsed: 0,
    });
    app = createApp();
  });

  test('空のbodyでデフォルト値を渡して呼び出すこと', async () => {
    const res = await app.handle(post({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockAutoGenerateTasks).toHaveBeenCalledWith({
      autoExecute: false,
      categoryId: undefined,
      force: false,
    });
  });

  test('指定したautoExecute/categoryId/forceを渡して呼び出すこと', async () => {
    await app.handle(post({ autoExecute: true, categoryId: 5, force: true }));

    expect(mockAutoGenerateTasks).toHaveBeenCalledWith({
      autoExecute: true,
      categoryId: 5,
      force: true,
    });
  });

  test('categoryIdがnullの場合はundefinedとして渡ること', async () => {
    await app.handle(post({ categoryId: null }));

    expect(mockAutoGenerateTasks).toHaveBeenCalledWith({
      autoExecute: false,
      categoryId: undefined,
      force: false,
    });
  });

  test('生成結果のフィールドをそのままレスポンスに含めること', async () => {
    mockAutoGenerateTasks.mockResolvedValue({
      generatedTasks: [{ id: 1, taskId: 1, title: 'Generated' } as never],
      executionTriggered: true,
      prompt: 'p',
      ideasUsed: 2,
      insufficientData: false,
      completedTaskCount: 12,
      innovationTriggered: true,
    });

    const res = await app.handle(post({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      tasks: [{ id: 1, taskId: 1, title: 'Generated' }],
      executionTriggered: true,
      count: 1,
      ideasUsed: 2,
      insufficientData: false,
      completedTaskCount: 12,
      innovationTriggered: true,
    });
  });

  test('insufficientData/innovationTriggeredが未指定の場合はfalseで補完すること', async () => {
    mockAutoGenerateTasks.mockResolvedValue({
      generatedTasks: [],
      executionTriggered: false,
      prompt: '',
      ideasUsed: 0,
    });

    const res = await app.handle(post({}));
    const body = await res.json();

    expect(body.insufficientData).toBe(false);
    expect(body.innovationTriggered).toBe(false);
  });

  test('サービスがErrorを投げた場合は500とエラーメッセージを返すこと', async () => {
    mockAutoGenerateTasks.mockRejectedValue(new Error('AI provider unavailable'));

    const res = await app.handle(post({}));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('AI provider unavailable');
  });

  test('サービスが非Errorを投げた場合はデフォルトメッセージを返すこと', async () => {
    mockAutoGenerateTasks.mockImplementation(() => Promise.reject('string failure'));

    const res = await app.handle(post({}));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to auto-generate tasks');
  });
});
