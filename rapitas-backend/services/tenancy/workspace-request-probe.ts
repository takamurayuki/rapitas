/**
 * WorkspaceRequestProbe
 *
 * Measures the whole stage-3 chain end to end against a REAL Elysia server and
 * a REAL Prisma client: cookie → session → membership → AsyncLocalStorage →
 * client extension → rows. Judges nothing; the expectations live in
 * workspace-request.integration.test.ts, which spawns this.
 *
 * End to end on purpose. Every link here is one that has already been seen to
 * pass its own unit test while being disconnected from the next one, and the
 * failure mode of this particular chain is not an error — it is one account
 * quietly reading another's data.
 *
 * Subprocess, for the same reason as workspace-scoping-probe: DATABASE_URL has
 * to be set before the client resolver loads, and `bun test` shares a process
 * across files.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { Database } from 'bun:sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

const TOKEN_A = 'tok-aaaaaaaaaaaaaaaa';
const TOKEN_B = 'tok-bbbbbbbbbbbbbbbb';
const TOKEN_DEAD = 'tok-expired-session';
const PORT = 3398;

/**
 * Two accounts, two workspaces, and one category each — plus an unowned one
 * that predates tenancy, which is the case the backfill exists for.
 *
 * @param dbPath - Where to create the SQLite file / SQLiteファイルの作成先
 */
function seed(dbPath: string): void {
  const raw = new Database(dbPath);
  try {
    raw.exec('PRAGMA foreign_keys = OFF;');
    raw.exec(SQLITE_INIT_SQL);
    const now = Date.now();
    const future = now + 60 * 60 * 1000;
    const past = now - 60 * 60 * 1000;

    for (const name of ['alice', 'bob']) {
      raw.run('INSERT INTO "User" ("username","updatedAt") VALUES (?,?)', [name, now]);
    }
    for (const [slug, label] of [
      ['ws-alice', 'Alice'],
      ['ws-bob', 'Bob'],
    ]) {
      raw.run('INSERT INTO "Workspace" ("slug","name","updatedAt") VALUES (?,?,?)', [
        slug,
        label,
        now,
      ]);
    }
    for (const [workspaceId, userId] of [
      [1, 1],
      [2, 2],
    ]) {
      raw.run('INSERT INTO "WorkspaceMember" ("workspaceId","userId","role") VALUES (?,?,?)', [
        workspaceId,
        userId,
        'owner',
      ]);
    }
    for (const [token, userId, expiresAt] of [
      [TOKEN_A, 1, future],
      [TOKEN_B, 2, future],
      [TOKEN_DEAD, 1, past],
    ] as [string, number, number][]) {
      raw.run(
        'INSERT INTO "UserSession" ("userId","sessionToken","expiresAt","updatedAt") VALUES (?,?,?,?)',
        [userId, token, expiresAt, now],
      );
    }
    for (const [name, workspaceId] of [
      ['alice-only', 1],
      ['bob-only', 2],
      ['pre-tenancy', null],
    ] as [string, number | null][]) {
      raw.run('INSERT INTO "Category" ("name","workspaceId","updatedAt") VALUES (?,?,?)', [
        name,
        workspaceId,
        now,
      ]);
    }
  } finally {
    raw.close();
  }
}

async function main(): Promise<void> {
  const outPath = process.argv[2];
  if (!outPath) throw new Error('usage: workspace-request-probe.ts <output.json>');
  const dbPath = join(dirname(outPath), 'request-probe.db');
  seed(dbPath);
  process.env.DATABASE_URL = `file:${dbPath.split(sep).join('/')}`;

  const { Elysia } = await import('elysia');
  const { prisma } = await import('../../config/database');
  const { wrapAppWithWorkspaceScope } = await import('./workspace-request-wrapper');
  const { claimUnownedRows } = await import('./workspace-backfill');

  const app = new Elysia();
  app.get('/categories', async () => {
    const rows = await prisma.category.findMany({ orderBy: { id: 'asc' } });
    return rows.map((r: { name: string }) => r.name);
  });
  // Exactly how index.ts serves it: the real app behind the wrapper.
  const listener = wrapAppWithWorkspaceScope(app);
  listener.listen(PORT);

  /** One request, optionally carrying a session cookie. */
  const names = async (cookie: string | null): Promise<string[]> => {
    const res = await fetch(`http://127.0.0.1:${PORT}/categories`, {
      headers: cookie === null ? {} : { cookie },
    });
    return (await res.json()) as string[];
  };

  try {
    const out = {
      alice: await names(`sessionToken=${TOKEN_A}`),
      bob: await names(`sessionToken=${TOKEN_B}`),
      // The agent's own calls: no cookie at all. Must stay unscoped.
      noCookie: await names(null),
      // An expired session resolves to nothing, so it must behave like no
      // cookie rather than like its former owner.
      expired: await names(`sessionToken=${TOKEN_DEAD}`),
      unknown: await names('sessionToken=never-issued'),
      // Realistic header with other cookies around it, since the parser is
      // hand-rolled.
      aliceAmongOthers: await names(`theme=dark; sessionToken=${TOKEN_A}; locale=ja`),
      // A cookieless request issued right after a scoped one.
      noCookieAfterAlice: [] as string[],
      // The case that caught the first implementation: overlapping requests.
      // A sequential check passed while concurrent ones leaked — the
      // cookieless request came back holding a neighbour's workspace.
      concurrent: [] as string[][],
      backfill: { claimed: 0, aliceAfter: [] as string[], bobAfter: [] as string[] },
    };
    out.noCookieAfterAlice = await names(null);
    out.concurrent = await Promise.all([
      names(`sessionToken=${TOKEN_A}`),
      names(`sessionToken=${TOKEN_B}`),
      names(null),
      names(`sessionToken=${TOKEN_A}`),
      names(`sessionToken=${TOKEN_B}`),
    ]);

    const result = await claimUnownedRows(1);
    out.backfill.claimed = result.totalClaimed;
    out.backfill.aliceAfter = await names(`sessionToken=${TOKEN_A}`);
    out.backfill.bobAfter = await names(`sessionToken=${TOKEN_B}`);

    writeFileSync(outPath, JSON.stringify(out), 'utf8');
  } finally {
    listener.stop();
    await prisma.$disconnect();
    rmSync(dbPath, { force: true });
  }
}

await main();
// A listening Elysia server keeps the loop alive even after stop(), and a
// probe that never exits reads to the caller exactly like a hang.
process.exit(0);
