/**
 * test-app.ts
 *
 * Elysia テストアプリケーションファクトリを提供する。
 * 42 ファイルで重複宣言されている `createApp` 関数を一元化する。
 *
 * `AppError` を import しない設計方針:
 * - `middleware/error-handler.ts` は import 時に createLogger を実行する副作用を持つ
 * - ヘルパーが直接 import すると logger モックのタイミング依存が生じる
 * - `statusCode: number` を持つかどうかのダックタイピングで AppError 系を捕捉する
 *
 * 使い方:
 *   import { createTestApp } from '../helpers/test-app';
 *   const app = createTestApp([myRoute1, myRoute2]);
 */
import { Elysia } from 'elysia';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** Elysia のルートプラグイン型 */
export type ElysiaPlugin = Parameters<Elysia['use']>[0];

/** createTestApp のオプション */
export interface TestAppOptions {
  /**
   * onError を上書きしたい場合に指定する独自エラーハンドラー。
   * 省略した場合は AppError 互換 + VALIDATION + 500 fallback のデフォルトを使用する。
   */
  onError?: Parameters<Elysia['onError']>[0];
}

// ---------------------------------------------------------------------------
// 型ガード
// ---------------------------------------------------------------------------

/**
 * オブジェクトが AppError 互換（`statusCode: number` と `message: string` を持つ）か判定する。
 *
 * `AppError` / `NotFoundError` / `ConflictError` 等の import なしに
 * エラーの種類を識別できる。
 *
 * @param e - 判定対象 / value to check
 * @returns true if AppError-like / AppError 互換なら true
 */
export function isAppErrorLike(
  e: unknown,
): e is { statusCode: number; message: string; code?: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'statusCode' in e &&
    typeof (e as Record<string, unknown>).statusCode === 'number' &&
    'message' in e &&
    typeof (e as Record<string, unknown>).message === 'string'
  );
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * テスト用 Elysia アプリケーションを生成する。
 *
 * onError のデフォルト実装は既存テストの最広実装（task-routes.test.ts:140-151）に一致:
 * 1. `isAppErrorLike` → statusCode をそのまま設定
 * 2. `VALIDATION` → 422
 * 3. その他 → 500
 *
 * @param routes - 登録するルートプラグイン（単体 or 配列）/ route plugins
 * @param opts - オプション / options
 * @returns 設定済み Elysia インスタンス / configured Elysia instance
 */
export function createTestApp(
  routes: ElysiaPlugin | ElysiaPlugin[],
  opts?: TestAppOptions,
): Elysia {
  const routeList = Array.isArray(routes) ? routes : [routes];
  let app = new Elysia();

  if (opts?.onError) {
    app = app.onError(opts.onError);
  } else {
    app = app.onError(({ code, error, set }) => {
      if (isAppErrorLike(error)) {
        set.status = error.statusCode;
        return { error: error.message, code: error.code };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Server error' };
    });
  }

  for (const route of routeList) {
    app = app.use(route);
  }

  return app;
}
