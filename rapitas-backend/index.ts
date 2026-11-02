/**
 * Backend entrypoint
 *
 * Installs the process-wide error handlers, initializes the desktop SQLite
 * database, and only then loads the server graph (server-main.ts).
 * Not responsible for routes or the listener — those live in server-main.
 */
import { isApiRecoveryMode } from './services/system/api-recovery-mode';
import { setupGlobalErrorHandlers } from './middleware/error-handler';
import { initErrorCapture } from './services/system/error-capture';
import { ensureDesktopSqliteDatabase } from './config/desktop-sqlite';

setupGlobalErrorHandlers();
// Unified error capture (local ring buffer + optional Sentry) must be live
// before the server graph is evaluated, so an import-time throw is recorded.
initErrorCapture();

// NOTE: The initializer opens the database with bun:sqlite, a second SQLite
// library in this process beside Prisma's engine. POSIX record locks belong to
// the process, so its close() drops the locks Prisma's connections hold and,
// seeing no other holder, deletes the WAL under them: every later query fails
// with SQLITE_IOERR_SHORT_READ (522). It is safe only while no Prisma query has
// started the engine. Static imports are all evaluated before this body runs,
// and a route module that queried at import time made that a race the Fault
// Injection E2E lost on ~1 run in 10 (#1000). Keep every static import above
// free of database access and load the rest dynamically, after this line.
if (!isApiRecoveryMode()) await ensureDesktopSqliteDatabase();

await import('./server-main');
