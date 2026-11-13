/**
 * categories-delete.sqlite.test
 *
 * Pins that the seeded default categories (開発・学習) can really be deleted
 * and stay deleted, against a real SQLite database built from the production
 * init SQL: themes and labels survive via onDelete: SetNull, seed-defaults only
 * seeds an empty table, and the scaffold fallback does not re-create 開発.
 *
 * Mocked-Prisma tests cannot show either property — SetNull lives in the
 * schema and "comes back after delete" is a sequence of real writes.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { PrismaClient } from '../../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../../src/generated/sqlite-init-sql';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-category-delete-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
const createLogger = () => ({ info() {}, warn() {}, error() {}, debug() {} });
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: db,
}));
mock.module('../../../config/logger', () => ({ createLogger }));

const { categoriesRoutes } = await import('../../../routes/organization/categories');
const { resolveThemeCategory, NO_FALLBACK_CATEGORY_ERROR } =
  await import('../../../routes/organization/theme-category-resolver');

const app = new Elysia().use(categoriesRoutes);
const call = (path: string, method: string) =>
  app.handle(new Request(`http://localhost/categories${path}`, { method }));
const seed = async () => (await call('/seed-defaults', 'POST')).json();
const names = async () =>
  (await db.category.findMany({ orderBy: { id: 'asc' } })).map((c) => c.name);

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.label.deleteMany();
  await db.theme.deleteMany();
  await db.userSettings.deleteMany();
  await db.category.deleteMany();
});

describe('deleting default categories', () => {
  test('a seeded default category deletes and its themes/labels survive uncategorized', async () => {
    await seed();
    const dev = await db.category.findFirstOrThrow({ where: { name: '開発' } });
    expect(dev.isDefault).toBe(true);
    const theme = await db.theme.create({
      data: { name: 'app', categoryId: dev.id, isDevelopment: true },
    });
    const label = await db.label.create({ data: { name: 'bug', categoryId: dev.id } });
    await db.userSettings.create({ data: { defaultCategoryId: dev.id } });

    const res = await call(`/${dev.id}`, 'DELETE');

    expect(res.status).toBe(200);
    expect(await names()).toEqual(['学習']);
    const after = await db.theme.findUniqueOrThrow({ where: { id: theme.id } });
    expect(after.categoryId).toBeNull();
    // isDevelopment is the theme's own flag; deleting its category must not flip it.
    expect(after.isDevelopment).toBe(true);
    expect((await db.label.findUniqueOrThrow({ where: { id: label.id } })).categoryId).toBeNull();
    expect((await db.userSettings.findFirstOrThrow()).defaultCategoryId).toBeNull();
  });

  test('re-running seed-defaults after deleting both defaults does not bring them back', async () => {
    await seed();
    await db.category.create({ data: { name: '仕事', mode: 'development' } });
    for (const c of await db.category.findMany({ where: { isDefault: true } })) {
      expect((await call(`/${c.id}`, 'DELETE')).status).toBe(200);
    }
    const orphan = await db.theme.create({ data: { name: 'dev theme', isDevelopment: true } });

    await seed();
    await seed();

    expect(await names()).toEqual(['仕事']);
    // The dev-theme auto-assign targets 開発 only; with 開発 gone it does nothing.
    expect((await db.theme.findUniqueOrThrow({ where: { id: orphan.id } })).categoryId).toBeNull();
  });

  test('deleting only 開発 keeps it deleted while 学習 is still backfilled', async () => {
    await seed();
    await db.category.updateMany({ where: { name: '学習' }, data: { icon: null } });
    const dev = await db.category.findFirstOrThrow({ where: { name: '開発' } });
    await call(`/${dev.id}`, 'DELETE');

    await seed();

    expect(await names()).toEqual(['学習']);
    expect((await db.category.findFirstOrThrow({ where: { name: '学習' } })).icon).toBe('BookOpen');
  });
});

describe('seed-defaults on first run', () => {
  test('seeds both defaults into an empty table, once, and files orphan dev themes under 開発', async () => {
    const orphan = await db.theme.create({ data: { name: 'dev theme', isDevelopment: true } });

    await seed();
    await seed();

    expect(await names()).toEqual(['開発', '学習']);
    const dev = await db.category.findFirstOrThrow({ where: { name: '開発' } });
    expect((await db.theme.findUniqueOrThrow({ where: { id: orphan.id } })).categoryId).toBe(
      dev.id,
    );
  });
});

describe('scaffold fallback with the real category table', () => {
  test('uses another development-mode category once 開発 is deleted', async () => {
    await seed();
    const mine = await db.category.create({ data: { name: '仕事', mode: 'development' } });
    const dev = await db.category.findFirstOrThrow({ where: { name: '開発' } });
    await call(`/${dev.id}`, 'DELETE');

    const result = await resolveThemeCategory(db.category);

    expect(result).toEqual({
      ok: true,
      category: expect.objectContaining({ id: mine.id }),
      isDevelopment: true,
    });
    expect(await names()).toEqual(['学習', '仕事']);
  });

  test('rejects rather than re-creating 開発 when no development category is left', async () => {
    await seed();
    const dev = await db.category.findFirstOrThrow({ where: { name: '開発' } });
    await call(`/${dev.id}`, 'DELETE');

    const result = await resolveThemeCategory(db.category);

    expect(result).toEqual({
      ok: false,
      error: NO_FALLBACK_CATEGORY_ERROR,
      code: 'category_required',
    });
    expect(await names()).toEqual(['学習']);
  });
});
