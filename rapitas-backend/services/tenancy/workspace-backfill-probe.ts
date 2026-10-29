/**
 * WorkspaceBackfillProbe
 *
 * Measures what claimUnownedRows actually does to a REAL database and writes
 * the measurements as JSON to the path given in argv[2]. Judges nothing — the
 * expectations live in workspace-backfill.integration.test.ts, which spawns
 * this.
 *
 * A subprocess for the same reason as workspace-scoping-probe: DATABASE_URL
 * has to be set before `config/database` builds its singleton, and `bun test`
 * shares one process across files, so doing this in-process would hand
 * whichever file ran next a client pointed at a throwaway database.
 *
 * Uses a throwaway SQLite file built from the GENERATED init SQL, so the
 * fixture cannot drift from the schema it was generated from.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { Database } from 'bun:sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

/** The workspace the backfill hands the unowned rows to. */
const WS = 55;
/** A second workspace that already owns a row, to prove nothing moves. */
const OTHER_WS = 77;
/** Rows seeded with workspaceId NULL, i.e. the pre-tenancy data. */
const SEEDED_UNOWNED = 2;
/** 2023-11-14T22:13:20Z — far enough back that "now" is unmistakable. */
const OLD_UPDATED_AT = 1_700_000_000_000;

/**
 * Build the throwaway database: two workspaces, two unowned rows and one that
 * already belongs to OTHER_WS.
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
    for (const [id, slug] of [
      [WS, 'probe-target'],
      [OTHER_WS, 'probe-other'],
    ] as const) {
      raw.run('INSERT INTO "Workspace" ("id","slug","name","updatedAt") VALUES (?,?,?,?)', [
        id,
        slug,
        slug,
        OLD_UPDATED_AT,
      ]);
    }
    for (const name of ['pre-tenancy-a', 'pre-tenancy-b']) {
      raw.run('INSERT INTO "Category" ("name","updatedAt") VALUES (?,?)', [name, OLD_UPDATED_AT]);
    }
    raw.run('INSERT INTO "Category" ("name","updatedAt","workspaceId") VALUES (?,?,?)', [
      'already-owned',
      OLD_UPDATED_AT,
      OTHER_WS,
    ]);
  } finally {
    raw.close();
  }
}

/**
 * Read one Category's stored updatedAt straight from SQLite.
 *
 * Deliberately not through Prisma: the question is what is ON DISK, and a
 * second client is one more thing that could be answering from a cache.
 *
 * @param dbPath - The throwaway SQLite file / 対象のSQLiteファイル
 * @param name - Category.name to look up / 検索する Category.name
 * @returns Stored epoch ms, or null when the row is gone / 保存値(epoch ms)
 */
function readUpdatedAt(dbPath: string, name: string): number | null {
  const raw = new Database(dbPath, { readonly: true });
  try {
    const row = raw.query('SELECT "updatedAt" AS t FROM "Category" WHERE "name" = ?').get(name) as
      | { t: number }
      | undefined;
    return row ? row.t : null;
  } finally {
    raw.close();
  }
}

async function main(): Promise<void> {
  const outPath = process.argv[2];
  if (!outPath) throw new Error('usage: workspace-backfill-probe.ts <output.json>');
  const dbPath = join(dirname(outPath), 'backfill-probe.db');
  seed(dbPath);
  process.env.DATABASE_URL = `file:${dbPath.split(sep).join('/')}`;

  const { claimUnownedRows, countUnownedRows } = await import('./workspace-backfill');
  const { prisma } = await import('../../config/database');

  try {
    const before = await countUnownedRows();
    const updatedAtBefore = readUpdatedAt(dbPath, 'pre-tenancy-a');

    const first = await claimUnownedRows(WS);
    const updatedAtAfter = readUpdatedAt(dbPath, 'pre-tenancy-a');

    // Re-running must find nothing: the rows it looks for are exactly the ones
    // it just gave an owner.
    const second = await claimUnownedRows(WS);

    const ownedByOther = await prisma.$queryRawUnsafe<{ c: number | bigint }[]>(
      'SELECT COUNT(*) AS c FROM "Category" WHERE "workspaceId" = ' + OTHER_WS,
    );

    writeFileSync(
      outPath,
      JSON.stringify({
        seededUnowned: SEEDED_UNOWNED,
        oldUpdatedAt: OLD_UPDATED_AT,
        // Proves the fixture really had unowned Category rows to claim.
        unownedCategoryBefore: before.models.find((m) => m.model === 'Category')?.claimed ?? 0,
        claimedCategory: first.models.find((m) => m.model === 'Category')?.claimed ?? 0,
        firstFailed: first.failed.map((f) => `${f.model}: ${f.error ?? ''}`),
        secondTotalClaimed: second.totalClaimed,
        updatedAtBefore,
        updatedAtAfter,
        // A row another workspace owns must still be theirs afterwards.
        categoriesStillOwnedByOther: Number(ownedByOther[0]?.c ?? -1),
      }),
      'utf8',
    );
  } finally {
    await prisma.$disconnect();
    rmSync(dbPath, { force: true });
  }
}

await main();
