/**
 * sqlite-test-db.ts
 *
 * 再利用可能な SQLite テスト環境ヘルパー。
 * 一時 DB / 一時ディレクトリの作成と自動クリーンアップを提供する。
 *
 * 将来の別 DB・外部 API mock も同じ `registerCleanup` パターンで拡張可能。
 * その場合は同じ `tests/helpers/` 配下に別ファイルを追加し、
 * `registerCleanup` を共通接点として使用する。
 */
import { afterAll, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** クリーンアップ関数の型 */
export type CleanupFn = () => void | Promise<void>;

/** クリーンアップ登録スコープ */
export type CleanupScope = 'each' | 'all';

// ---------------------------------------------------------------------------
// Step 1: 汎用プリミティブ
// ---------------------------------------------------------------------------

/**
 * クリーンアップ関数を bun:test のフックに登録する汎用接点。
 *
 * 将来の別 DB・API mock も同じ関数を通じて破棄を登録することで、
 * 「一時環境登録 → 自動破棄」パターンを統一できる。
 *
 * @param fn - テスト後に実行するクリーンアップ処理
 * @param scope - 'each'（afterEach、既定）または 'all'（afterAll）
 */
export function registerCleanup(fn: CleanupFn, scope: CleanupScope = 'each'): void {
  if (scope === 'all') {
    afterAll(fn);
  } else {
    afterEach(fn);
  }
}

/**
 * 一時ディレクトリを作成してそのパスを返す。
 * テスト後（scope 既定: afterEach）に自動削除される。
 *
 * @param prefix - ディレクトリ名プレフィックス（既定: 'rapitas-test-'）
 * @param scope - クリーンアップスコープ（既定: 'each'）
 * @returns 一時ディレクトリの絶対パス
 */
export function withTempDir(prefix?: string, scope: CleanupScope = 'each'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix ?? 'rapitas-test-'));
  registerCleanup(() => rmSync(dir, { recursive: true, force: true }), scope);
  return dir;
}

// ---------------------------------------------------------------------------
// Step 2: SQLite 具象
// ---------------------------------------------------------------------------

/** DB.close() の多重呼び出しを無害化する内部ユーティリティ */
function closeQuietly(db: Database): void {
  try {
    db.close();
  } catch {
    // already closed — ignore
  }
}

/** initSql（文字列または文字列配列）を DB に順番に適用する内部ユーティリティ */
function applyInitSql(db: Database, initSql: string | string[]): void {
  const sqls = Array.isArray(initSql) ? initSql : [initSql];
  for (const sql of sqls) {
    db.exec(sql);
  }
}

/** `withMemoryDb` のオプション */
export interface MemoryDbOptions {
  /** 生成直後に実行する DDL（文字列または配列）。不正 DDL は例外として伝播する */
  initSql?: string | string[];
  /** クリーンアップスコープ（既定: 'each'） */
  scope?: CleanupScope;
}

/**
 * インメモリ SQLite DB を生成して返す。
 * テスト後に自動的に close される（冪等）。
 *
 * @param opts - オプション
 * @returns bun:sqlite の Database インスタンス
 *
 * @example
 * const db = withMemoryDb({ initSql: 'CREATE TABLE "T" ("id" INTEGER PRIMARY KEY)' });
 * db.exec('INSERT INTO "T" VALUES (1)');
 */
export function withMemoryDb(opts?: MemoryDbOptions): Database {
  const db = new Database(':memory:');
  if (opts?.initSql) {
    applyInitSql(db, opts.initSql);
  }
  registerCleanup(() => closeQuietly(db), opts?.scope);
  return db;
}

/** `withTempFileDb` のオプション */
export interface TempFileDbOptions {
  /** 生成直後に実行する DDL */
  initSql?: string | string[];
  /** DB ファイル名（既定: 'test.db'） */
  filename?: string;
  /** クリーンアップスコープ（既定: 'each'） */
  scope?: CleanupScope;
}

/** `withTempFileDb` の返り値 */
export interface TempFileDb {
  /** SQLite DB インスタンス */
  db: Database;
  /** DB ファイルの絶対パス */
  path: string;
}

/**
 * 一時ディレクトリ内にファイルベースの SQLite DB を生成して返す。
 * テスト後に db.close() → ディレクトリ削除の順でクリーンアップされる。
 *
 * NOTE: close と rmSync を単一の cleanup 内で順序固定しているのは
 * Windows の EBUSY エラーを防ぐため（close 前に rmSync するとファイルロックでエラー）。
 * `withTempDir` を経由せず mkdtempSync を直接使うのもこの理由による。
 *
 * @param opts - オプション
 * @returns `{ db, path }` — db は Database インスタンス、path は DB ファイルの絶対パス
 *
 * @example
 * const { db, path } = withTempFileDb();
 * db.exec('CREATE TABLE "T" ("x" INTEGER)');
 */
export function withTempFileDb(opts?: TempFileDbOptions): TempFileDb {
  const dir = mkdtempSync(join(tmpdir(), 'rapitas-test-filedb-'));
  const filename = opts?.filename ?? 'test.db';
  const dbPath = join(dir, filename);
  const db = new Database(dbPath);
  if (opts?.initSql) {
    applyInitSql(db, opts.initSql);
  }
  // close と rmSync を単一 cleanup 内で順序固定（Windows EBUSY 回避）
  registerCleanup(() => {
    closeQuietly(db);
    rmSync(dir, { recursive: true, force: true });
  }, opts?.scope);
  return { db, path: dbPath };
}
