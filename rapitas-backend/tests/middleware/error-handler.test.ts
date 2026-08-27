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
  ConflictError,
  AuthenticationError,
  errorHandler,
  parseId,
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

describe('ConflictError', () => {
  test('デフォルトメッセージでステータス409を設定すること', () => {
    const error = new ConflictError();
    expect(error.statusCode).toBe(409);
    expect(error.message).toBe('Resource already exists');
    expect(error.name).toBe('ConflictError');
    expect(error instanceof AppError).toBe(true);
  });

  test('カスタムメッセージを受け入れること', () => {
    const error = new ConflictError('既に存在します', 'DUPLICATE');
    expect(error.message).toBe('既に存在します');
    expect(error.code).toBe('DUPLICATE');
  });
});

describe('AuthenticationError', () => {
  test('デフォルトメッセージでステータス401を設定すること', () => {
    const error = new AuthenticationError();
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Authentication required');
    expect(error.name).toBe('AuthenticationError');
    expect(error instanceof AppError).toBe(true);
  });

  test('カスタムメッセージを受け入れること', () => {
    const error = new AuthenticationError('要認証', 'AUTH_REQUIRED');
    expect(error.message).toBe('要認証');
    expect(error.code).toBe('AUTH_REQUIRED');
  });
});

describe('parseId', () => {
  test('数値文字列をパースすること', () => {
    expect(parseId('42')).toBe(42);
  });

  test('数値をそのまま受け入れること', () => {
    expect(parseId(42)).toBe(42);
  });

  test('デフォルトlabelでValidationErrorを投げること', () => {
    expect(() => parseId('abc')).toThrow(ValidationError);
    try {
      parseId('abc');
    } catch (e) {
      expect((e as ValidationError).message).toContain('Invalid ID');
      expect((e as ValidationError).code).toBe('INVALID_ID');
    }
  });

  test('カスタムlabelをエラーメッセージに含めること', () => {
    try {
      parseId('xyz', 'taskId');
    } catch (e) {
      expect((e as ValidationError).message).toContain('Invalid taskId');
    }
  });

  test('0以下の値を拒否すること', () => {
    expect(() => parseId('0')).toThrow(ValidationError);
    expect(() => parseId('-5')).toThrow(ValidationError);
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

describe('errorHandler plugin propagation (as: global)', () => {
  // The REAL fix: a route on a SEPARATE app that merely `.use(errorHandler)`
  // must have its thrown AppError handled. Before `{ as: 'global' }` the
  // onError was plugin-scoped, so every route's AppError fell through to
  // Elysia's default handler as a raw-message HTTP 500.
  function appUsingPlugin(handler: () => never) {
    return new Elysia().use(errorHandler).get('/test', handler);
  }

  test('use(errorHandler) した別アプリの ValidationError が 400+JSON になること', async () => {
    const app = appUsingPlugin(() => {
      throw new ValidationError('無効なIDです');
    });
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as ErrorResponseBody;
    expect(body.error).toBe('無効なIDです');
  });

  test('AppError の statusCode がそのまま反映されること', async () => {
    const app = appUsingPlugin(() => {
      throw new AppError(422, 'Unprocessable', 'UNPROCESSABLE');
    });
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(422);
  });

  test('NotFoundError が 404 になること', async () => {
    const app = appUsingPlugin(() => {
      throw new NotFoundError('見つかりません');
    });
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(404);
  });

  test('ConflictError が 409 になること', async () => {
    const app = appUsingPlugin(() => {
      throw new ConflictError('重複しています');
    });
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(409);
  });

  test('AuthenticationError が 401 になること', async () => {
    const app = appUsingPlugin(() => {
      throw new AuthenticationError();
    });
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(401);
  });

  test('Prismaクラス名を持つエラーが400 "Database query error" になること', async () => {
    const app = appUsingPlugin(() => {
      const error = new Error('some prisma failure');
      error.name = 'PrismaClientKnownRequestError';
      throw error;
    });
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponseBody;
    expect(body.error).toBe('Database query error');
  });

  test('Prismaメッセージパターン（Invalid `prisma）を持つエラーが400になること', async () => {
    const app = appUsingPlugin(() => {
      throw new Error('Invalid `prisma.task.findMany()` invocation:');
    });
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(400);
  });

  test('Prismaエラーコード（P2002等）を持つエラーが400になること', async () => {
    const app = appUsingPlugin(() => {
      const error = new Error('Unique constraint failed');
      (error as unknown as { code: string }).code = 'P2002';
      throw error;
    });
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(400);
  });

  test('未知のErrorはPrisma扱いされず500 "Server error occurred" になること', async () => {
    const app = appUsingPlugin(() => {
      throw new Error('something totally unrelated broke');
    });
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponseBody;
    expect(body.error).toBe('Server error occurred');
  });

  test('レスポンスのContent-Typeが常にJSONであること', async () => {
    const app = appUsingPlugin(() => {
      throw new NotFoundError();
    });
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  test('不正なJSONボディがステータス500ではなく400で処理されること(#683)', async () => {
    // Elysia's built-in JSON parser throws a ParseError (code: 'PARSE', status: 400)
    // before the route handler ever runs. Before the PARSE branch existed, this
    // fell through to the generic fallback and was overwritten with 500.
    const app = new Elysia().use(errorHandler).post('/test', ({ body }) => body);
    const res = await app.handle(
      new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponseBody;
    expect(body.error).toBe('Invalid JSON in request body');
  });
});
