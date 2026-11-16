// Select before importing the normal graph, which repairs DBs and starts background services.
import { selectServerEntry } from './services/system/task901-maintenance-entry';
import { bootUserDatabase } from './config/user-database-override';
import { runServerEntry } from './services/process-lifecycle';

// NOTE: Wrapped so a failed import exits 1. Unwrapped, the rejection reached the
// uncaughtException listeners, which swallowed it; the process then ended with
// 0 and dev.js did not restart it (2026-11-07, a missing `qrcode` package).
await runServerEntry(async () => {
  // Before anything opens a database: the Prisma client is chosen from
  // DATABASE_URL when it first loads, so a user's own database (#1285) has to be
  // in place by then.
  await bootUserDatabase();
  await selectServerEntry(process.env.RAPITAS_TASK901_MAINTENANCE, {
    normal: () => import('./index'),
    maintenance: () => import('./services/system/task901-maintenance-server'),
  });
});
