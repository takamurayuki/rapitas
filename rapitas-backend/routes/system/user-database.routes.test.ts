/**
 * user-database routes tests (#1285)
 *
 * The settings contract: the secret never comes back unmasked (not even inside
 * an error), initialization needs confirmation and refuses a non-empty
 * database, and every change says a restart is needed.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserDatabaseRoutes, scrubSecret } from './user-database.routes';
import type { PgClient } from '../../services/system/user-database';

const URL_A = 'postgresql://alice:s3cr3t@db.example.co:5432/postgres';
const vault = new Map<string, string>();
const secrets = {
  save: (a: string, s: string) => (vault.set(a, s), `keychain:${a}`),
  resolve: (r: string | null | undefined) => (r ? (vault.get(r.slice(9)) ?? null) : null),
  remove: (r: string | null | undefined) => void (r && vault.delete(r.slice(9))),
};
let dir: string;
let hasTask = false;
let connectError: Error | null = null;
const factory = () =>
  ({
    $queryRawUnsafe: async (sql: string) => {
      if (connectError) throw connectError;
      return sql.includes('to_regclass') ? [{ exists: hasTask ? 'Task' : null }] : [{}];
    },
    $executeRawUnsafe: async () => 0,
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    $disconnect: mock(async () => {}),
  }) as unknown as PgClient;

let app: ReturnType<typeof createUserDatabaseRoutes>;
async function call(method: string, path = '', body?: unknown) {
  const res = await app.handle(
    new Request(`http://localhost/system/user-database${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'udb-routes-'));
  vault.clear();
  hasTask = false;
  connectError = null;
  app = createUserDatabaseRoutes({ dataDir: dir, secrets, factory });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('user-database routes', () => {
  test('saving returns the masked URL; reading never returns the password', async () => {
    const put = await call('PUT', '', { url: URL_A });
    expect(put.status).toBe(200);
    expect(put.text).not.toContain('s3cr3t');
    const get = await call('GET');
    expect(get.body).toMatchObject({ configured: true, initializedAt: null, active: false });
    expect(get.text).not.toContain('s3cr3t');
  });

  test('a non-postgres URL is a 400', async () => {
    expect((await call('PUT', '', { url: 'file:./x.db' })).status).toBe(400);
  });

  test('initialize needs confirmation', async () => {
    await call('PUT', '', { url: URL_A });
    expect((await call('POST', '/initialize', { confirmed: false })).status).toBe(400);
  });

  test('initialize refuses a database that already has the schema (409)', async () => {
    await call('PUT', '', { url: URL_A });
    hasTask = true;
    const r = await call('POST', '/initialize', { confirmed: true });
    expect(r.status).toBe(409);
    expect((await call('GET')).body.initializedAt).toBeNull();
  });

  test('a successful initialize is remembered and asks for a restart', async () => {
    await call('PUT', '', { url: URL_A });
    const r = await call('POST', '/initialize', { confirmed: true });
    expect(r.body).toMatchObject({ success: true, restartRequired: true });
    expect((await call('GET')).body.initializedAt).not.toBeNull();
  });

  test('a connection error is returned scrubbed of the URL and password', async () => {
    await call('PUT', '', { url: URL_A });
    connectError = new Error(`Can't reach ${URL_A} (password s3cr3t rejected)`);
    const r = await call('POST', '/measure');
    expect(r.status).toBe(502);
    expect(r.text).not.toContain('s3cr3t');
  });

  test('measure without a configuration is a 404', async () => {
    expect((await call('POST', '/measure')).status).toBe(404);
  });

  test('delete goes back to local and asks for a restart', async () => {
    await call('PUT', '', { url: URL_A });
    expect((await call('DELETE')).body).toMatchObject({ success: true, restartRequired: true });
    expect((await call('GET')).body.configured).toBe(false);
  });
});

describe('scrubSecret', () => {
  test('removes the URL and a bare password', () => {
    const out = scrubSecret(`x ${URL_A} y s3cr3t z`, URL_A);
    expect(out).not.toContain('s3cr3t');
    expect(out).toContain('alice:***@db.example.co');
  });
});
