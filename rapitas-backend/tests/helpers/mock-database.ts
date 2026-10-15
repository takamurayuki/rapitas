/**
 * mock-database.ts
 *
 * config/database モジュール全体を差し替えるファクトリ関数を提供する。
 * 103 ファイルで重複宣言されている Prisma モック定型を一元化する。
 *
 * 使い方:
 *   import { createPrismaMock, databaseModuleFactory } from '../helpers/mock-database';
 *   const mockPrisma = createPrismaMock({ task, theme, ... });
 *   mock.module('../../config/database', () => databaseModuleFactory(mockPrisma));
 *   const { myRoute } = await import('../../routes/myRoute');
 *
 * このファイル自身は mock.module を呼ばない ─ bun の hoisting 制約に従い、
 * 呼び出しはテストファイル側の責務。
 */
import { mock } from 'bun:test';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/**
 * Prisma モデルの標準 CRUD メソッドを持つ mock オブジェクトの型。
 * `overrides` で個別メソッドの既定値を差し替えられる。
 */
export interface PrismaModelMock {
  findMany: ReturnType<typeof mock>;
  findUnique: ReturnType<typeof mock>;
  findFirst: ReturnType<typeof mock>;
  create: ReturnType<typeof mock>;
  update: ReturnType<typeof mock>;
  updateMany: ReturnType<typeof mock>;
  delete: ReturnType<typeof mock>;
  deleteMany: ReturnType<typeof mock>;
  count: ReturnType<typeof mock>;
  upsert: ReturnType<typeof mock>;
  createMany: ReturnType<typeof mock>;
  aggregate: ReturnType<typeof mock>;
  groupBy: ReturnType<typeof mock>;
}

/** prismaModelMock に渡せるオーバーライドの型 */
export type PrismaModelOverrides = Partial<{
  [K in keyof PrismaModelMock]: ReturnType<typeof mock>;
}>;

/** createPrismaMock に渡すモデル集合の型 */
export type PrismaModels = Record<string, PrismaModelMock>;

/** $transaction を持つ PrismaClient 風オブジェクトの型 */
export interface PrismaMock extends PrismaModels {
  $transaction: ReturnType<typeof mock>;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 標準 CRUD メソッドを持つ Prisma モデルの mock オブジェクトを生成する。
 *
 * 既定の戻り値は既存テストの慣行（task-routes.test.ts）に準拠:
 * - `findMany` → `[]`
 * - `findUnique` / `findFirst` → `null`
 * - `create` → `{ id: 1 }`
 * - `update` / `delete` / `upsert` → `{}`
 * - `count` → `0`
 * - `createMany` / `deleteMany` / `updateMany` → `{ count: 0 }`
 * - `aggregate` / `groupBy` → `{}`
 *
 * @param overrides - 個別メソッドを差し替える場合に指定 / method overrides
 * @returns CRUD mock を持つモデルオブジェクト / model mock object
 */
export function prismaModelMock(overrides?: PrismaModelOverrides): PrismaModelMock {
  return {
    findMany: overrides?.findMany ?? mock(() => Promise.resolve([])),
    findUnique: overrides?.findUnique ?? mock(() => Promise.resolve(null)),
    findFirst: overrides?.findFirst ?? mock(() => Promise.resolve(null)),
    create: overrides?.create ?? mock(() => Promise.resolve({ id: 1 })),
    update: overrides?.update ?? mock(() => Promise.resolve({})),
    updateMany: overrides?.updateMany ?? mock(() => Promise.resolve({ count: 0 })),
    delete: overrides?.delete ?? mock(() => Promise.resolve({})),
    deleteMany: overrides?.deleteMany ?? mock(() => Promise.resolve({ count: 0 })),
    count: overrides?.count ?? mock(() => Promise.resolve(0)),
    upsert: overrides?.upsert ?? mock(() => Promise.resolve({})),
    createMany: overrides?.createMany ?? mock(() => Promise.resolve({ count: 0 })),
    aggregate: overrides?.aggregate ?? mock(() => Promise.resolve({})),
    groupBy: overrides?.groupBy ?? mock(() => Promise.resolve({})),
  };
}

/**
 * モデル集合に `$transaction` を付与した PrismaClient 風オブジェクトを生成する。
 *
 * `$transaction` の既定実装は `fn => fn(self)` ─ コールバックにモック自身を渡す。
 * `resetDeepMocks` でリセット後、必要なら `afterReset` で既定実装を復元すること。
 *
 * @param models - モデル名 → PrismaModelMock のマップ / model map
 * @returns $transaction 付き PrismaClient 風オブジェクト / PrismaClient-like mock
 */
export function createPrismaMock(models: PrismaModels): PrismaMock {
  const self: PrismaMock = {
    ...models,
    $transaction: mock((fn: (tx: PrismaMock) => unknown) => fn(self)),
  };
  return self;
}

/**
 * config/database モジュール全体を差し替えるファクトリ。
 *
 * `config/database` が export する `prisma` と `ensureDatabaseConnection` を mirror する。
 *
 * @param prismaMock - createPrismaMock() が返すオブジェクト / PrismaClient-like mock
 * @returns config/database と同一構造のモジュールオブジェクト / module object
 */
export function databaseModuleFactory(prismaMock: PrismaMock): {
  prisma: PrismaMock;
  ensureDatabaseConnection: () => Promise<void>;
} {
  return {
    prisma: prismaMock,
    ensureDatabaseConnection: () => Promise.resolve(),
  };
}
