/**
 * task-resolver.boundary.test
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

mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: mockTaskFindUnique },
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
  resolveTaskWithTheme,
  resolveTaskWithThemeAndCategory,
  resolveTaskForExecution,
  resolveTaskWorkingDirectory,
  resolveTaskWorkflowState,
  resolveTaskTitle,
  resolveTaskThemeId,
  resolveTaskForComplexityAnalysis,
  resolveTaskSubtaskInfo,
  resolveTaskForPlanApproval,
  resolveTaskForAutoMerge,
  resolveTaskForLearning,
} = await import('./task-resolver');

beforeEach(() => {
  mockTaskFindUnique.mockReset();
  mockTaskFindUnique.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// resolveTaskWithTheme 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskWithTheme 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskWithTheme(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskWithTheme(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveTaskWithThemeAndCategory 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskWithThemeAndCategory 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskWithThemeAndCategory(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskWithThemeAndCategory(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveTaskForExecution 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskForExecution 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskForExecution(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskForExecution(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveTaskWorkingDirectory 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskWorkingDirectory 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskWorkingDirectory(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskWorkingDirectory(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveTaskWorkflowState 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskWorkflowState 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskWorkflowState(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskWorkflowState(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveTaskTitle 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskTitle 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskTitle(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskTitle(edge);
      expect(result).toBeNull();
    },
  );
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
      const result = await resolveTaskThemeId(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveTaskForComplexityAnalysis 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskForComplexityAnalysis 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskForComplexityAnalysis(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskForComplexityAnalysis(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveTaskSubtaskInfo 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskSubtaskInfo 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskSubtaskInfo(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskSubtaskInfo(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveTaskForPlanApproval 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskForPlanApproval 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskForPlanApproval(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskForPlanApproval(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveTaskForAutoMerge 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskForAutoMerge 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskForAutoMerge(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskForAutoMerge(edge);
      expect(result).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// resolveTaskForLearning 境界値テスト
// ---------------------------------------------------------------------------
describe('resolveTaskForLearning 境界値テスト', () => {
  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が null を返すとき %p は null を返すこと',
    async (edge) => {
      const result = await resolveTaskForLearning(edge);
      expect(result).toBeNull();
    },
  );

  test.each(ID_EDGES.map((bc) => bc.value))(
    'prisma が reject するとき %p でも null を返すこと',
    async (edge) => {
      mockTaskFindUnique.mockRejectedValueOnce(new Error('DB error'));
      const result = await resolveTaskForLearning(edge);
      expect(result).toBeNull();
    },
  );
});
