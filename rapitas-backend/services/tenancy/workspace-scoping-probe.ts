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
    // A model with a COMPOUND unique, which every other probe below lacks:
    // they all key on the single scalar `id`. findUnique accepts a compound
    // unique only as a nested shorthand key that findFirst has no equivalent
    // for, so the rewrite has to flatten it — and because nothing here
    // exercised that, #1307 shipped and every task completion 500'd. One row
    // inside the workspace and one outside, so a scoped read has something to
    // find and something it must not.
    raw.run(
      'INSERT INTO "TaskPattern" ("workspaceId","userId","taskTitle","themeId","priority","updatedAt") VALUES (?,?,?,?,?,?)',
      [WS, 1, 'compound-in-99', 0, 'medium', now],
    );
    raw.run(
      'INSERT INTO "TaskPattern" ("workspaceId","userId","taskTitle","themeId","priority","updatedAt") VALUES (?,?,?,?,?,?)',
      [null, 1, 'compound-outside', 0, 'medium', now],
    );
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
      // Whether the GENERATED client is current. The registry is read from its
      // DMMF, so a stale client silently drops Task from the owned set and the
      // two counts below stop meaning anything — hence reporting it.
      taskIsOwned: getOwnedModels().has('Task'),
      // Task now carries the column, so the seeded unowned row is invisible to
      // a scoped read. This is the defect stage 1 left behind: the row was
      // previously returned to every workspace.
      countTaskInWorkspace: await runInWorkspace(WS, () => prisma.task.count()),
      // The control: the row is there, the scoped read just cannot see it.
      countTaskNoWorkspace: await prisma.task.count(),
      /*
       * NOTE: there is deliberately no probe here for "a model with no column
       * is passed through". Reaching one by name from this file would make the
       * schema guard count it as an application query and demand a column —
       * correctly, since the guard scans production source and cannot know a
       * file is a test harness. That case is covered exhaustively instead by
       * workspace-scope.guards.generated.ts, where it is a pure function.
       */
      /*
       * upsert, which Prisma cannot scope. The adapter performs it as a scoped
       * find-then-write, so the three things worth measuring are: it works at
       * all, it cannot reach a row outside the workspace, and a second call on
       * its OWN row updates instead of creating another.
       *
       * id 1 is a seeded row with no workspace. Upserting on it from inside WS
       * must leave it alone and create a row of its own.
       */
      ...(await runInWorkspace(WS, async () => {
        const created = (await prisma.category.upsert({
          where: { id: 1 },
          create: { name: 'upserted-in-99', updatedAt: new Date() },
          update: { name: 'SHOULD-NOT-REACH-THE-SEEDED-ROW' },
        })) as { id: number; name: string; workspaceId: number | null };
        const again = (await prisma.category.upsert({
          where: { id: created.id },
          create: { name: 'should-not-create-twice', updatedAt: new Date() },
          update: { name: 'updated-in-99' },
        })) as { id: number; name: string };
        return {
          upsertCreatedWorkspaceId: created.workspaceId,
          upsertCreatedName: created.name,
          upsertSecondCallSameRow: again.id === created.id,
          upsertSecondCallName: again.name,
          upsertRowsInWorkspace: await prisma.category.count(),
        };
      })),
      // The seeded row the upsert was pointed at: its name must be untouched.
      seededRowNameAfterUpsert: await runAcrossAllWorkspaces(async () => {
        const row = (await prisma.category.findFirst({ where: { id: 1 } })) as {
          name: string;
        } | null;
        return row?.name ?? null;
      }),
      /*
       * A COMPOUND unique, read through findUnique. Every probe above keys on
       * the single scalar `id`, which is why none of them caught #1307: the
       * rewrite to findFirst copied the nested shorthand key across verbatim
       * and Prisma rejected the whole query with "Unknown argument
       * `userId_taskTitle_themeId`". A string here instead of a row means the
       * query was refused, not that the row was missing.
       */
      ...(await (async () => {
        const key = (taskTitle: string) => ({
          userId_taskTitle_themeId: { userId: 1, taskTitle, themeId: 0 },
        });
        const read = async (
          taskTitle: string,
          scoped: boolean,
        ): Promise<string | null | { error: string }> => {
          const run = async () => {
            const row = (await prisma.taskPattern.findUnique({ where: key(taskTitle) })) as {
              taskTitle: string;
            } | null;
            return row?.taskTitle ?? null;
          };
          try {
            return scoped ? await runInWorkspace(WS, run) : await run();
          } catch (error) {
            return { error: error instanceof Error ? error.message.slice(0, 120) : 'non-error' };
          }
        };
        return {
          compoundFindUniqueInWorkspace: await read('compound-in-99', true),
          // The row outside the workspace must be invisible to a scoped read —
          // null here, and NOT an error.
          compoundFindUniqueOutsideHidden: await read('compound-outside', true),
          // Controls: unscoped, both rows are reachable, so a null above means
          // "scoped away" rather than "this client cannot read".
          compoundFindUniqueNoWorkspace: await read('compound-in-99', false),
          compoundFindUniqueOutsideNoWorkspace: await read('compound-outside', false),
        };
      })()),
    };
    writeFileSync(outPath, JSON.stringify(out), 'utf8');
  } finally {
    await base.$disconnect();
    rmSync(dbPath, { force: true });
  }
}

await main();
