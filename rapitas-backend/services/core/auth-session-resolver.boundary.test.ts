/**
 * auth-session-resolver.boundary.test
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:boundary-tests`
 * ソース: scripts/gen-resolver-boundary-tests.ts
 *
 * 境界値テストの契約: 全対象関数は edge 入力で reject せず、null を返すこと。
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { STRING_EDGES } from '../../tests/helpers/boundary-values';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const mockUserSessionFindFirst = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    userSession: { findFirst: mockUserSessionFindFirst },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../config/logger', () => {
  const noopLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { resolveSessionByToken } = await import('./auth-session-resolver');

beforeEach(() => {
  mockUserSessionFindFirst.mockReset();
  mockUserSessionFindFirst.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// resolveSessionByToken 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveSessionByToken 境界値テスト', () => {
  test.each(STRING_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveSessionByToken(edge);
      expect(result).toBeNull();
    },
  );

  test.each(STRING_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockUserSessionFindFirst.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveSessionByToken(edge);
      expect(result).toBeNull();
    },
  );
});
