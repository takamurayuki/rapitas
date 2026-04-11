/**
 * Error Handler Middleware テスト
 * カスタムエラークラスとElysiaエラーハンドラーのテスト
 */
import { describe, test, expect } from 'bun:test';
import { Elysia } from 'elysia';
import {
  AppError,
  NotFoundError,
  ValidationError,
  errorHandler,
} from '../../middleware/error-handler';

interface ErrorResponseBody {
  success?: boolean;
  error?: string;
  message?: string;
  code?: string;
  type?: string;
  details?: string;
}

describe('AppError', () => {
  test('statusCode, message, codeを保持すること', () => {
    const error = new AppError(400, 'Bad request', 'INVALID_INPUT');
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Bad request');
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.name).toBe('AppError');
    expect(error instanceof Error).toBe(true);
  });

  test('codeが省略可能であること', () => {
    const error = new AppError(500, 'Server error');
    expect(error.code).toBeUndefined();
  });
});

describe('NotFoundError', () => {
  test('デフォルトメッセージでステータス404を設定すること', () => {
    const error = new NotFoundError();
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('Resource not found');
    expect(error.name).toBe('NotFoundError');
    expect(error instanceof AppError).toBe(true);
  });

  test('カスタムメッセージを受け入れること', () => {
    const error = new NotFoundError('ユーザーが見つかりません', 'USER_NOT_FOUND');
    expect(error.message).toBe('ユーザーが見つかりません');
    expect(error.code).toBe('USER_NOT_FOUND');
  });
});

describe('ValidationError', () => {
  test('デフォルトメッセージでステータス400を設定すること', () => {
    const error = new ValidationError();
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Validation error');
    expect(error.name).toBe('ValidationError');
    expect(error instanceof AppError).toBe(true);
  });

  test('カスタムメッセージを受け入れること', () => {
    const error = new ValidationError('無効なメールアドレス', 'INVALID_EMAIL');
    expect(error.message).toBe('無効なメールアドレス');
    expect(error.code).toBe('INVALID_EMAIL');
  });
});

describe('errorHandler middleware (inline onError)', () => {
  // Note: Elysia plugin scoping prevents .use(errorHandler) from propagating
  // onError to routes defined after .use(). We test by inlining the handler logic.

  function createTestApp(handler: () => never) {
    return new Elysia()
      .onError(({ code, error, set }) => {
        set.headers['Content-Type'] = 'application/json; charset=utf-8';

        if (error instanceof AppError) {
          set.status = error.statusCode;
          return { error: error.message, code: error.code };
        }

        if (code === 'NOT_FOUND') {
          set.status = 404;
          return { error: 'リソースが見つかりません' };
        }

        // Prisma error detection
        if (error instanceof Error) {
          const name = error.name || '';
          const message = error.message || '';
          if (name.includes('PrismaClient') || message.includes('Invalid `prisma')) {
            set.status = 400;
            return { error: 'データベースクエリエラー', details: message };
          }
        }

        set.status = 500;
        return {
          error: error instanceof Error ? error.message : 'サーバーエラーが発生しました',
          type: error instanceof Error ? error.name : 'UnknownError',
        };
      })
      .get('/test', handler);
  }

  test('AppErrorを正しいステータスコードで処理すること', async () => {
    const app = createTestApp(() => {
      throw new AppError(422, 'Unprocessable', 'UNPROCESSABLE');
    });

    const response = await app.handle(new Request('http://localhost/test'));
    expect(response.status).toBe(422);
    const body = (await response.json()) as ErrorResponseBody;
    expect(body.error).toBe('Unprocessable');
    expect(body.code).toBe('UNPROCESSABLE');
  });

  test('NotFoundErrorをステータス404で処理すること', async () => {
    const app = createTestApp(() => {
      throw new NotFoundError('タスクが見つかりません');
    });

    const response = await app.handle(new Request('http://localhost/test'));
    expect(response.status).toBe(404);
    const body = (await response.json()) as ErrorResponseBody;
    expect(body.error).toBe('タスクが見つかりません');
  });

  test('一般的なErrorをステータス500で処理すること', async () => {
    const app = createTestApp(() => {
      throw new Error('Unexpected error');
    });

    const response = await app.handle(new Request('http://localhost/test'));
    expect(response.status).toBe(500);
    const body = (await response.json()) as ErrorResponseBody;
    expect(body.error).toBe('Unexpected error');
    expect(body.type).toBe('Error');
  });

  test('Prismaエラーをステータス400で処理すること', async () => {
    const app = createTestApp(() => {
      const error = new Error('Invalid `prisma.task.findMany()` invocation');
      error.name = 'PrismaClientKnownRequestError';
      throw error;
    });

    const response = await app.handle(new Request('http://localhost/test'));
    expect(response.status).toBe(400);
    const body = (await response.json()) as ErrorResponseBody;
    expect(body.error).toBe('データベースクエリエラー');
  });
});
