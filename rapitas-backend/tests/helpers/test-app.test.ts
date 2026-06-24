/**
 * test-app.test.ts
 *
 * test-app ヘルパーのユニットテスト。
 * isAppErrorLike 型ガードと createTestApp の動作を実証する。
 */
import { describe, test, expect } from 'bun:test';
import { Elysia } from 'elysia';
import { isAppErrorLike, createTestApp } from './test-app';

// ---------------------------------------------------------------------------
// isAppErrorLike テスト
// ---------------------------------------------------------------------------

describe('isAppErrorLike', () => {
  test('statusCode と message を持つオブジェクトで true になること', () => {
    expect(isAppErrorLike({ statusCode: 404, message: 'Not found' })).toBe(true);
  });

  test('code を含む場合も true になること', () => {
    expect(isAppErrorLike({ statusCode: 409, message: 'Conflict', code: 'CONFLICT' })).toBe(true);
  });

  test('素の Error で false になること', () => {
    expect(isAppErrorLike(new Error('plain error'))).toBe(false);
  });

  test('null で false になること', () => {
    expect(isAppErrorLike(null)).toBe(false);
  });

  test('undefined で false になること', () => {
    expect(isAppErrorLike(undefined)).toBe(false);
  });

  test('statusCode が文字列の場合は false になること', () => {
    expect(isAppErrorLike({ statusCode: '404', message: 'nope' })).toBe(false);
  });

  test('message が存在しない場合は false になること', () => {
    expect(isAppErrorLike({ statusCode: 404 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createTestApp テスト
// ---------------------------------------------------------------------------

describe('createTestApp', () => {
  test('AppError 互換エラーで正しい statusCode を返すこと', async () => {
    const route = new Elysia().get('/throw-app-error', () => {
      const err = { statusCode: 404, message: 'Not found here', code: 'NOT_FOUND' };
      throw err;
    });

    const app = createTestApp(route);
    const res = await app.handle(new Request('http://localhost/throw-app-error'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('Not found here');
    expect(body.code).toBe('NOT_FOUND');
  });

  test('VALIDATION エラーで 422 を返すこと', async () => {
    // NOTE: Elysia の VALIDATION は内部フレームワークが注入するため、ルート内からは
    // throw できない。代わりに AppError 互換オブジェクトで statusCode=422 を throw してテスト
    const route422 = new Elysia().get('/throw-422', () => {
      throw { statusCode: 422, message: 'Validation failed' };
    });
    const app422 = createTestApp(route422);
    const res422 = await app422.handle(new Request('http://localhost/throw-422'));
    expect(res422.status).toBe(422);
  });

  test('不明なエラーで 500 を返すこと', async () => {
    const route = new Elysia().get('/throw-unknown', () => {
      throw new Error('unexpected crash');
    });
    const app = createTestApp(route);
    const res = await app.handle(new Request('http://localhost/throw-unknown'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('unexpected crash');
  });

  test('配列でルートを渡せること', async () => {
    const route1 = new Elysia().get('/r1', () => 'one');
    const route2 = new Elysia().get('/r2', () => 'two');
    const app = createTestApp([route1, route2]);
    const res1 = await app.handle(new Request('http://localhost/r1'));
    const res2 = await app.handle(new Request('http://localhost/r2'));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  test('単体ルートを渡せること', async () => {
    const route = new Elysia().get('/single', () => ({ ok: true }));
    const app = createTestApp(route);
    const res = await app.handle(new Request('http://localhost/single'));
    expect(res.status).toBe(200);
  });

  test('opts.onError でカスタムエラーハンドラーを使えること', async () => {
    const route = new Elysia().get('/custom-err', () => {
      throw new Error('custom handled');
    });
    const app = createTestApp(route, {
      onError: ({ error, set }) => {
        set.status = 418; // I'm a teapot
        return { custom: error instanceof Error ? error.message : 'unknown' };
      },
    });
    const res = await app.handle(new Request('http://localhost/custom-err'));
    expect(res.status).toBe(418);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.custom).toBe('custom handled');
  });
});
