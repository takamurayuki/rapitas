/**
 * agent-session-resolver.boundary.test
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:boundary-tests`
 * ソース: scripts/gen-resolver-boundary-tests.ts
 *
 * 境界値テストの契約: 全対象関数は edge 入力で reject せず、null を返すこと。
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ID_EDGES } from '../../tests/helpers/boundary-values';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const mockAgentSessionFindFirst = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
const mockAgentSessionFindUnique = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    agentSession: { findFirst: mockAgentSessionFindFirst, findUnique: mockAgentSessionFindUnique },
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

const {
  resolveLatestFinishedSession,
  resolveSessionWithLatestExecution,
  resolveLatestSessionWorktree,
} = await import('./agent-session-resolver');

beforeEach(() => {
  mockAgentSessionFindFirst.mockReset();
  mockAgentSessionFindFirst.mockResolvedValue(null);
  mockAgentSessionFindUnique.mockReset();
  mockAgentSessionFindUnique.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// resolveLatestFinishedSession 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveLatestFinishedSession 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveLatestFinishedSession(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockAgentSessionFindFirst.mockRejectedValueOnce(new Error('DB error'));
      mockAgentSessionFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveLatestFinishedSession(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveSessionWithLatestExecution 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveSessionWithLatestExecution 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveSessionWithLatestExecution(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockAgentSessionFindFirst.mockRejectedValueOnce(new Error('DB error'));
      mockAgentSessionFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveSessionWithLatestExecution(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveLatestSessionWorktree 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveLatestSessionWorktree 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveLatestSessionWorktree(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockAgentSessionFindFirst.mockRejectedValueOnce(new Error('DB error'));
      mockAgentSessionFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveLatestSessionWorktree(edge);
      expect(result).toBeNull();
    },
  );
});
