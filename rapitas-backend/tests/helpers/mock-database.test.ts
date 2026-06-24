/**
 * mock-database.test.ts
 *
 * mock-database ヘルパーのユニットテスト。
 * prismaModelMock / createPrismaMock / databaseModuleFactory の動作と、
 * mock.module + await import の実利用フローを実証する。
 */
import { describe, test, expect, mock } from 'bun:test';
import {
  prismaModelMock,
  createPrismaMock,
  databaseModuleFactory,
} from './mock-database';

// ---------------------------------------------------------------------------
// prismaModelMock のテスト
// ---------------------------------------------------------------------------

describe('prismaModelMock', () => {
  test('全 CRUD メソッドが存在すること', () => {
    const m = prismaModelMock();
    const methods = [
      'findMany', 'findUnique', 'findFirst', 'create', 'update',
      'updateMany', 'delete', 'deleteMany', 'count', 'upsert',
      'createMany', 'aggregate', 'groupBy',
    ];
    for (const method of methods) {
      expect(typeof (m as Record<string, unknown>)[method]).toBe('function');
    }
  });

  test('findMany() が [] を resolve すること', async () => {
    const m = prismaModelMock();
    const result = await m.findMany();
    expect(result).toEqual([]);
  });

  test('findUnique() が null を resolve すること', async () => {
    const m = prismaModelMock();
    const result = await m.findUnique();
    expect(result).toBeNull();
  });

  test('findFirst() が null を resolve すること', async () => {
    const m = prismaModelMock();
    const result = await m.findFirst();
    expect(result).toBeNull();
  });

  test('create() が { id: 1 } を resolve すること', async () => {
    const m = prismaModelMock();
    const result = await m.create();
    expect(result).toEqual({ id: 1 });
  });

  test('count() が 0 を resolve すること', async () => {
    const m = prismaModelMock();
    const result = await m.count();
    expect(result).toBe(0);
  });

  test('createMany / deleteMany / updateMany が { count: 0 } を resolve すること', async () => {
    const m = prismaModelMock();
    expect(await m.createMany()).toEqual({ count: 0 });
    expect(await m.deleteMany()).toEqual({ count: 0 });
    expect(await m.updateMany()).toEqual({ count: 0 });
  });

  test('overrides が反映されること', async () => {
    const customFind = mock(() => Promise.resolve([{ id: 99 }]));
    const m = prismaModelMock({ findMany: customFind });
    const result = await m.findMany();
    expect(result).toEqual([{ id: 99 }]);
    expect(customFind).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// createPrismaMock のテスト
// ---------------------------------------------------------------------------

describe('createPrismaMock', () => {
  test('渡したモデルが含まれること', () => {
    const task = prismaModelMock();
    const theme = prismaModelMock();
    const p = createPrismaMock({ task, theme });
    expect(p.task).toBe(task);
    expect(p.theme).toBe(theme);
  });

  test('$transaction が存在すること', () => {
    const p = createPrismaMock({ task: prismaModelMock() });
    expect(typeof p.$transaction).toBe('function');
  });

  test('$transaction(cb) が cb を自身を引数に呼び出すこと', async () => {
    const p = createPrismaMock({ task: prismaModelMock() });
    let received: unknown;
    await p.$transaction((tx: unknown) => {
      received = tx;
      return Promise.resolve();
    });
    expect(received).toBe(p);
  });
});

// ---------------------------------------------------------------------------
// databaseModuleFactory のテスト
// ---------------------------------------------------------------------------

describe('databaseModuleFactory', () => {
  test('prisma と ensureDatabaseConnection を返すこと', () => {
    const p = createPrismaMock({ task: prismaModelMock() });
    const mod = databaseModuleFactory(p);
    expect(mod.prisma).toBe(p);
    expect(typeof mod.ensureDatabaseConnection).toBe('function');
  });

  test('ensureDatabaseConnection() が resolve すること', async () => {
    const p = createPrismaMock({ task: prismaModelMock() });
    const mod = databaseModuleFactory(p);
    await expect(mod.ensureDatabaseConnection()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mock.module + await import の実利用フロー実証テスト
// ---------------------------------------------------------------------------

describe('mock.module + await import フロー', () => {
  test('databaseModuleFactory を mock.module に渡すと prisma が差し替えられること', async () => {
    const { prismaModelMock: pmm, createPrismaMock: cpm, databaseModuleFactory: dbf } =
      await import('./mock-database');

    const task = pmm();
    const mockPrisma = cpm({ task });
    mock.module('../../config/database', () => dbf(mockPrisma));

    const { prisma, ensureDatabaseConnection } = await import('../../config/database');

    // 差し替えた mock が返されること
    expect(typeof prisma.task).toBe('object');
    await expect(ensureDatabaseConnection()).resolves.toBeUndefined();
  });
});
