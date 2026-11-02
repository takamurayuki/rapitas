/**
 * sqlite-boot-order.test (#1000)
 *
 * The desktop SQLite initializer opens the database with bun:sqlite — a second
 * SQLite library in the same process as Prisma's engine. POSIX record locks
 * belong to the process, not the connection, so when bun:sqlite closes it drops
 * the locks Prisma's connections hold and, believing it is the last connection,
 * deletes the WAL under them. Every later query then fails with
 * SQLITE_IOERR_SHORT_READ (522) — the Fault Injection E2E's "task creation
 * failed: HTTP 500".
 *
 * That only happens when a Prisma query has already started the engine, and
 * ES imports are evaluated before the importing module's body runs, so a
 * query fired at import time anywhere in the server graph raced the
 * initializer. These tests pin both halves: the entrypoint loads the server
 * graph only after the initializer finished, and the module that used to
 * query at import time no longer does.
 */
import { describe, it, expect, mock } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..', '..');

/** Static `import ... from '<spec>'` specifiers of a source file, in order. */
function staticImports(source: string): string[] {
  return [...source.matchAll(/^import\s[^;]*?from\s+['"]([^'"]+)['"]/gms)].map((m) => m[1]);
}

describe('index.ts boot order', () => {
  const source = readFileSync(join(ROOT, 'index.ts'), 'utf8');

  it('statically imports nothing that can reach the database', () => {
    // Every module here is evaluated before the initializer runs. None of them
    // may issue a Prisma query; anything that does belongs in server-main.
    expect(staticImports(source).sort()).toEqual(
      [
        './config/desktop-sqlite',
        './services/system/api-recovery-mode',
        './services/system/error-capture',
        './middleware/error-handler',
      ].sort(),
    );
  });

  it('loads the server graph only after the SQLite initializer has finished', () => {
    const init = source.indexOf('await ensureDesktopSqliteDatabase()');
    const load = source.indexOf("await import('./server-main')");
    expect(init).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(init);
  });
});

describe('labels routes module', () => {
  it('issues no query when imported', async () => {
    const findMany = mock(() => Promise.resolve([]));
    const update = mock(() => Promise.resolve({}));
    mock.module('../../config/database', () => ({
      ensureDatabaseConnection: () => Promise.resolve(),
      prisma: { label: { findMany, update } },
    }));
    await import('../../routes/organization/labels');
    await new Promise((r) => setTimeout(r, 0));
    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
