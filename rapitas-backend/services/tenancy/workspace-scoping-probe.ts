/**
 * WorkspaceScopingProbe
 *
 * Measures what the workspace extension actually does to a REAL Prisma client
 * and writes the measurements as JSON to the path given in argv[2]. Judges
 * nothing — the expectations live in workspace-scoping.integration.test.ts,
 * which spawns this.
 *
 * Runs as a subprocess on purpose. It has to set DATABASE_URL before the
 * client resolver is imported, and `bun test` shares one process across files
 * unless --isolate is passed, so doing this in-process would hand whichever
 * file ran next a client pointed at a throwaway database.
 *
 * Reports through a file rather than stdout so the contract does not depend on
 * nothing else writing there — Prisma's own logging shares that stream.
 *
 * Uses a throwaway SQLite file built from the GENERATED init SQL rather than
 * the live database: the point is to prove the plumbing, and the generated SQL
 * cannot drift from the schema it was generated from.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { Database } from 'bun:sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

const WS = 99;
const SEEDED = 3;

/**
 * Build the throwaway database and put a few known rows in it.
 *
 * @param dbPath - Where to create the SQLite file / SQLiteファイルの作成先
 */
function seed(dbPath: string): void {
  const raw = new Database(dbPath);
  try {
    // The init SQL creates tables in an order that references not-yet-created
    // ones; this fixture only needs a handful of rows, so sidestep FKs rather
    // than reorder generated SQL.
    raw.exec('PRAGMA foreign_keys = OFF;');
    raw.exec(SQLITE_INIT_SQL);
    const now = Date.now();
    for (const name of ['alpha', 'beta', 'gamma']) {
      raw.run('INSERT INTO "Category" ("name","updatedAt") VALUES (?,?)', [name, now]);
    }
    raw.run('INSERT INTO "Task" ("title","updatedAt") VALUES (?,?)', ['probe', now]);
  } finally {
    raw.close();
  }
}

async function main(): Promise<void> {
  const outPath = process.argv[2];
  if (!outPath) throw new Error('usage: workspace-scoping-probe.ts <output.json>');
  // Beside the report, so the caller's temp dir owns the cleanup and a crash
  // here cannot leave a stray database in the source tree.
  const dbPath = join(dirname(outPath), 'probe.db');
  seed(dbPath);
  process.env.DATABASE_URL = `file:${dbPath.split(sep).join('/')}`;

  const { resolvePrismaClientCtor } = await import('../../config/prisma-client-resolver');
  const { getOwnedModels } = await import('./owned-models');
  const { createWorkspaceExtension } = await import('./workspace-extension');
  const { runInWorkspace, runAcrossAllWorkspaces } = await import('./workspace-context');
  type BaseClientLike = Parameters<typeof createWorkspaceExtension>[1];

  const PrismaClient = resolvePrismaClientCtor();
  const base = new PrismaClient();
  const prisma = base.$extends(
    createWorkspaceExtension(getOwnedModels(), base as unknown as BaseClientLike),
  ) as unknown as typeof base;

  try {
    const created = await runInWorkspace(WS, () =>
      prisma.category.create({ data: { name: 'made-in-99', updatedAt: new Date() } }),
    );
    const out = {
      seeded: SEEDED,
      // The seeded rows plus the one create() just stamped with WS.
      countNoWorkspace: await prisma.category.count(),
      // Only the created row belongs to WS; the seeded rows are NULL.
      countInWorkspace: await runInWorkspace(WS, () => prisma.category.count()),
      countEscaped: await runInWorkspace(WS, () =>
        runAcrossAllWorkspaces(() => prisma.category.count()),
      ),
      findManyInWorkspace: (await runInWorkspace(WS, () => prisma.category.findMany({ take: 10 })))
        .length,
      // id 1 is a seeded NULL row, so a scoped unique read must miss it...
      findUniqueInWorkspace:
        (await runInWorkspace(WS, () => prisma.category.findUnique({ where: { id: 1 } }))) === null
          ? null
          : 'found',
      // ...and the same read with no workspace must find it. Without this
      // control the line above would also read null on a client that simply
      // could not read at all.
      findUniqueNoWorkspace:
        (await prisma.category.findUnique({ where: { id: 1 } })) === null ? null : 'found',
      createdWorkspaceId: (created as { workspaceId: number | null }).workspaceId,
      // Task has no workspaceId of its own; it inherits through its FK.
      countDerivedModel: await runInWorkspace(WS, () => prisma.task.count()),
      upsertRejected: await runInWorkspace(WS, async () => {
        try {
          await prisma.category.upsert({
            where: { id: 1 },
            create: { name: 'u', updatedAt: new Date() },
            update: {},
          });
          return false;
        } catch {
          return true;
        }
      }),
    };
    writeFileSync(outPath, JSON.stringify(out), 'utf8');
  } finally {
    await base.$disconnect();
    rmSync(dbPath, { force: true });
  }
}

await main();
