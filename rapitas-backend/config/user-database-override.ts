/**
 * user-database-override
 *
 * Points the backend at the user's own PostgreSQL database (#1285) by setting
 * DATABASE_URL / RAPITAS_DB_PROVIDER before anything reads them — the Prisma
 * client choice is fixed when config/prisma-client-resolver.ts loads, so this
 * runs first in server-entry.ts. Not responsible for storing the URL
 * (services/system/user-database) or applying the schema (its initialize).
 *
 * Only an INITIALIZED database is switched to: a saved URL whose schema was
 * never applied would boot into "table does not exist" on every request.
 * RAPITAS_USER_DATABASE=off always wins, so a bad configuration can be backed
 * out without editing files.
 */
import { createLogger } from './logger';
import { maskDatabaseUrl } from '../services/system/user-database/user-database-url';
import type { UserDatabaseRecord } from '../services/system/user-database/user-database-store';

const log = createLogger('user-database');

/** What happened at boot. */
export type OverrideOutcome =
  | { applied: true; masked: string }
  | { applied: false; reason: 'disabled' | 'not_configured' | 'not_initialized' | 'unreadable' };

/**
 * Apply the stored user database to `env`, if one is configured and initialized.
 *
 * @param env - Environment to modify (process.env at boot) / 書き換える環境変数
 * @param read - Reads the stored record / 保存済み設定の読み出し
 * @returns Whether the switch happened, and why not / 切り替えの有無と理由
 */
export function applyUserDatabaseOverride(
  env: NodeJS.ProcessEnv,
  read: () => UserDatabaseRecord | null,
): OverrideOutcome {
  if (env.RAPITAS_USER_DATABASE === 'off') return { applied: false, reason: 'disabled' };
  let record: UserDatabaseRecord | null;
  try {
    record = read();
  } catch (err) {
    // A locked keychain must not take the app down: stay on local data.
    log.warn({ err }, 'User database settings unreadable; staying on the local database');
    return { applied: false, reason: 'unreadable' };
  }
  if (!record) return { applied: false, reason: 'not_configured' };
  if (!record.initializedAt) {
    log.warn('A user database is saved but not initialized; staying on the local database');
    return { applied: false, reason: 'not_initialized' };
  }
  env.DATABASE_URL = record.url;
  env.RAPITAS_DB_PROVIDER = 'postgresql';
  const masked = maskDatabaseUrl(record.url);
  log.info({ database: masked }, 'Using the user-configured database');
  return { applied: true, masked };
}

/**
 * Boot entry: the real store under the data dir, the real secret store.
 *
 * @returns The outcome / 結果
 */
export async function bootUserDatabase(): Promise<OverrideOutcome> {
  const { createUserDatabaseStore, defaultDataDir } =
    await import('../services/system/user-database/user-database-store');
  const { saveSecret, resolveStoredSecret, deleteStoredSecret } =
    await import('../utils/common/secret-store');
  const store = createUserDatabaseStore(defaultDataDir(), {
    save: saveSecret,
    resolve: resolveStoredSecret,
    remove: deleteStoredSecret,
  });
  return applyUserDatabaseOverride(process.env, () => store.read());
}
