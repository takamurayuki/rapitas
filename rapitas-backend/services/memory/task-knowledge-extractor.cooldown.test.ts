/**
 * task-knowledge-extractor.cooldown.test
 *
 * Verifies the 24h duplicate-boost cooldown: when a near-duplicate lesson is
 * found, the existing entry is boosted only if it was NOT already accessed
 * within the window — re-extraction / paraphrase reruns in a short span are
 * extraction artifacts, not repeated real use, and must not inflate the score.
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const taskFindUnique = mock(async () => ({
  id: 7,
  title: 'リファクタ: TTL集中管理',
  description: 'キャッシュTTLを定数化する。'.repeat(3),
  themeId: 1,
  theme: { categoryId: 1, category: {} },
  comments: [],
  taskLabels: [],
}));
const wfGroupBy = mock(async () => [{ cause: 'verify_repair', _count: { cause: 2 } }]);
const keFindFirst = mock(async () => null as { id: number } | null);
const keCreate = mock(async (args: { data: { sourceType: string } }) => ({
  id: 501,
  ...args.data,
}));
// Controls the lastAccessedAt returned for the duplicate entry under test.
let dupLastAccessedAt: Date | null = null;
const keFindUnique = mock(async () => ({ lastAccessedAt: dupLastAccessedAt }));
const sendAIMessage = mock(async () => ({
  content: JSON.stringify([
    {
      title: 'verifyの差し戻し回避',
      content: 'verify前に scoped tsc を通す',
      category: 'procedure',
    },
  ]),
}));
const enqueue = mock(async () => {});
const boostDecayOnAccess = mock(async () => {});

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: { findUnique: taskFindUnique },
    workflowTransition: { groupBy: wfGroupBy },
    knowledgeEntry: { findFirst: keFindFirst, create: keCreate, findUnique: keFindUnique },
  },
}));
// NOTE: mock.module is process-global and must mirror EVERY export of the real
// module — a transitive `import { logger }` fails if the mock omits it.
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '',
}));
mock.module('../../utils/ai-client', () => ({ sendAIMessage }));
// Always report a near-duplicate so the boost/cooldown branch is exercised.
mock.module('./dedup', () => ({
  findSemanticDuplicate: async () => 42,
  findLexicalDuplicate: async () => null,
}));
mock.module('./forgetting', () => ({ boostDecayOnAccess }));
mock.module('./index', () => ({ memoryTaskQueue: { enqueue } }));
mock.module('./timeline', () => ({ appendEvent: async () => {} }));
mock.module('../../config/db-provider', () => ({
  getInsensitiveMode: () => ({}),
  getDbProvider: () => 'sqlite',
}));

const { reflectOnFailure } = await import('./task-knowledge-extractor');

describe('duplicate-boost 24h cooldown', () => {
  beforeEach(() => {
    boostDecayOnAccess.mockClear();
    keCreate.mockClear();
    dupLastAccessedAt = null;
  });

  test('duplicate boost within 24h cooldown is skipped', async () => {
    dupLastAccessedAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago — inside window
    const ids = await reflectOnFailure(7, 'blocked');
    expect(boostDecayOnAccess).not.toHaveBeenCalled();
    expect(keCreate).not.toHaveBeenCalled(); // duplicate → no new entry
    expect(ids).toEqual([]);
  });

  test('duplicate boost after cooldown still applies', async () => {
    dupLastAccessedAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago — outside window
    const ids = await reflectOnFailure(7, 'blocked');
    expect(boostDecayOnAccess).toHaveBeenCalledTimes(1);
    expect(boostDecayOnAccess.mock.calls[0]).toEqual([42, 0.15]);
    expect(ids).toEqual([]);
  });

  test('a never-accessed duplicate (lastAccessedAt null) is boosted', async () => {
    dupLastAccessedAt = null;
    await reflectOnFailure(7, 'blocked');
    expect(boostDecayOnAccess).toHaveBeenCalledTimes(1);
  });
});
