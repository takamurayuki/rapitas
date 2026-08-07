/**
 * theme-resolution.boundary.test
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
const mockTaskFindUnique = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
const mockThemeFindFirst = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
const mockThemeFindMany = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;

mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: mockTaskFindUnique },
    theme: { findFirst: mockThemeFindFirst, findMany: mockThemeFindMany },
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

const { resolveTaskThemeId } = await import('./theme-resolution');

beforeEach(() => {
  mockTaskFindUnique.mockReset();
  mockTaskFindUnique.mockResolvedValue(null);
  mockThemeFindFirst.mockReset();
  mockThemeFindFirst.mockResolvedValue(null);
  mockThemeFindMany.mockReset();
  mockThemeFindMany.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// resolveTaskThemeId 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskThemeId 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskThemeId(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      mockThemeFindFirst.mockRejectedValueOnce(new Error('DB error'));
      mockThemeFindMany.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskThemeId(edge);
      expect(result).toBeNull();
    },
  );
});
