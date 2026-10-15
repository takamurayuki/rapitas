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

mock.module('./prisma-client-resolver', () => ({
  dbProvider: 'postgres',
  resolvePrismaClientCtor: () =>
    class FakePrismaClient {
      $connect() {
        return connectMock();
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
});
