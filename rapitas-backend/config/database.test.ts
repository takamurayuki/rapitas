/**
 * database.test
 *
 * Exercises ensureDatabaseConnection's retry loop with `resolvePrismaClientCtor`
 * replaced by a fake, controllable PrismaClient — no real DB engine is ever
 * loaded or connected to.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let connectImpl: () => Promise<void> = () => Promise.resolve();
const connectMock = mock(() => connectImpl());

/**
 * How many times database.ts wrapped the client in an extension at module
 * load. Counted here so the fake cannot drift back into being incomplete: a
 * fake missing `$extends` throws while database.ts is still being imported,
 * which aborts this whole FILE — four tests disappear and the run still
 * reports a pass count, just a smaller one.
 */
let extendsCalls = 0;

mock.module('./prisma-client-resolver', () => ({
  dbProvider: 'postgres',
  resolvePrismaClientCtor: () =>
    class FakePrismaClient {
      $connect() {
        return connectMock();
      }
      // Mirrors the real client: database.ts wraps itself in the workspace
      // extension as it loads, so this has to exist.
      $extends(): FakePrismaClient {
        extendsCalls++;
        return this;
      }
    },
}));
mock.module('./logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { ensureDatabaseConnection, prisma } = await import('./database');

beforeEach(() => {
  connectMock.mockClear();
  connectImpl = () => Promise.resolve();
});

describe('ensureDatabaseConnection', () => {
  it('resolves immediately when $connect succeeds on the first attempt', async () => {
    await ensureDatabaseConnection(5, 1);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed attempt, then succeeds', async () => {
    let calls = 0;
    connectImpl = () => {
      calls++;
      if (calls < 3) return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve();
    };
    await ensureDatabaseConnection(5, 1);
    expect(connectMock).toHaveBeenCalledTimes(3);
  });

  it('throws the last error once maxRetries is exhausted', async () => {
    connectImpl = () => Promise.reject(new Error('always fails'));
    await expect(ensureDatabaseConnection(3, 1)).rejects.toThrow('always fails');
    expect(connectMock).toHaveBeenCalledTimes(3);
  });

  it('exports a prisma client instance from the resolved constructor', () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe('function');
  });

  it('wraps the exported client in the workspace extension', () => {
    // Without this, dropping the $extends call from database.ts would leave
    // every query unscoped and nothing here would notice — the other tests
    // only need a client that connects.
    expect(extendsCalls).toBe(1);
  });
});
