// Select before importing the normal graph, which repairs DBs and starts background services.
import { selectServerEntry } from './services/system/task901-maintenance-entry';
import { bootUserDatabase } from './config/user-database-override';

// Before anything opens a database: the Prisma client is chosen from
// DATABASE_URL when it first loads, so a user's own database (#1285) has to be
// in place by then.
await bootUserDatabase();
await selectServerEntry(process.env.RAPITAS_TASK901_MAINTENANCE, {
  normal: () => import('./index'),
  maintenance: () => import('./services/system/task901-maintenance-server'),
});
