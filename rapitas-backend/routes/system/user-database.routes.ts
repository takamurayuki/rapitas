/**
 * User Database Routes
 *
 * Settings endpoints for using one's own PostgreSQL database (#1285): save the
 * connection string, measure it, initialize it (explicitly, once), or go back
 * to local. Switching takes effect on the next start — the database is chosen
 * at boot (config/user-database-override.ts).
 *
 * The connection string is a secret: responses carry the masked form only, and
 * an error message is scrubbed of the URL before it leaves.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  createUserDatabaseStore,
  defaultDataDir,
  validateDatabaseUrl,
  maskDatabaseUrl,
  measureLatency,
  initializeUserDatabase,
  type SecretOps,
  type PgClientFactory,
} from '../../services/system/user-database';
import {
  saveSecret,
  resolveStoredSecret,
  deleteStoredSecret,
} from '../../utils/common/secret-store';

const log = createLogger('routes:user-database');

/** Remove the URL and its password from a message before it is returned or logged. */
export function scrubSecret(message: string, url: string): string {
  let out = message.split(url).join(maskDatabaseUrl(url));
  try {
    const pw = new URL(url).password;
    if (pw) out = out.split(decodeURIComponent(pw)).join('***').split(pw).join('***');
  } catch {
    // unparseable URL: nothing more to strip
  }
  return out;
}

/**
 * Build the routes over a given store location and client factory.
 *
 * @param deps - dataDir / secrets / factory (tests inject) / 依存
 * @returns The Elysia plugin / ルート
 */
export function createUserDatabaseRoutes(
  deps: { dataDir?: string; secrets?: SecretOps; factory?: PgClientFactory } = {},
) {
  const store = () =>
    createUserDatabaseStore(
      deps.dataDir ?? defaultDataDir(),
      deps.secrets ?? {
        save: saveSecret,
        resolve: resolveStoredSecret,
        remove: deleteStoredSecret,
      },
    );

  return new Elysia({ prefix: '/system/user-database' })
    .get('/', () => {
      const record = store().read();
      return {
        configured: record !== null,
        url: record ? maskDatabaseUrl(record.url) : null,
        initializedAt: record?.initializedAt ?? null,
        // Whether THIS process is running on it (switching needs a restart).
        active: record !== null && process.env.DATABASE_URL === record.url,
      };
    })
    .put(
      '/',
      ({ body, set }) => {
        const checked = validateDatabaseUrl(body.url);
        if (!checked.ok) {
          set.status = 400;
          return { success: false, error: checked.error };
        }
        store().save(checked.url);
        return { success: true, url: maskDatabaseUrl(checked.url), initializedAt: null };
      },
      { body: t.Object({ url: t.String({ maxLength: 2000 }) }) },
    )
    .post('/measure', async ({ set }) => {
      const record = store().read();
      if (!record) {
        set.status = 404;
        return { success: false, error: 'not_configured' };
      }
      try {
        return { success: true, ...(await measureLatency(record.url, deps.factory)) };
      } catch (err) {
        const message = scrubSecret(err instanceof Error ? err.message : String(err), record.url);
        log.warn({ error: message }, 'User database measurement failed');
        set.status = 502;
        return { success: false, error: message };
      }
    })
    .post(
      '/initialize',
      async ({ body, set }) => {
        if (!body.confirmed) {
          set.status = 400;
          return { success: false, error: 'confirmation_required' };
        }
        const s = store();
        const record = s.read();
        if (!record) {
          set.status = 404;
          return { success: false, error: 'not_configured' };
        }
        try {
          const r = await initializeUserDatabase(record.url, deps.factory);
          if (!r.ok) {
            set.status = 409;
            return { success: false, error: r.reason };
          }
          s.markInitialized();
          return { success: true, statements: r.statements, restartRequired: true };
        } catch (err) {
          const message = scrubSecret(err instanceof Error ? err.message : String(err), record.url);
          log.warn({ error: message }, 'User database initialization failed');
          set.status = 502;
          return { success: false, error: message };
        }
      },
      { body: t.Object({ confirmed: t.Boolean() }) },
    )
    .delete('/', () => {
      store().clear();
      return { success: true, restartRequired: true };
    });
}

export default createUserDatabaseRoutes();
