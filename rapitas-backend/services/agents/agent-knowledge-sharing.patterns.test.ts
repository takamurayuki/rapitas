/**
 * agent-knowledge-sharing — learning-pattern content (#1322)
 *
 * 856 success patterns all said "タスク「<title>」で成功した手法を適用" — a pointer
 * back to the task, never the method — and the lookup injected that into agent
 * prompts with confidence up to 0.99. These pin that a success pattern carries
 * what the verify.md changed-files table says was done, that nothing is filed
 * when there is no such record, and that the legacy rows stop reaching prompts.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noop = () => {};
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
}));

let verifyContent: string | null = null;
const created: Array<{ actions: string; patternType: string }> = [];
const updated: Array<{ data: { actions?: string } }> = [];
let existingPattern: unknown = null;
let storedPatterns: unknown[] = [];

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: {
      findUnique: async () => ({
        id: 5,
        title: 'Add CSV export to reports',
        themeId: 1,
        taskLabels: [],
      }),
    },
    workflowFile: {
      findFirst: async () => (verifyContent === null ? null : { content: verifyContent }),
    },
    agentExecution: { findUnique: async () => ({ errorMessage: null }) },
    learningPattern: {
      findFirst: async () => existingPattern,
      findMany: async () => storedPatterns,
      create: async (a: { data: { actions: string; patternType: string } }) => {
        created.push(a.data);
        return a.data;
      },
      update: async (a: { data: { actions?: string } }) => {
        updated.push(a);
        return a;
      },
    },
  },
}));

const { updatePatternsFromExecution, extractMethodFromVerify } =
  await import('./agent-knowledge-sharing');
const { findRelevantPatterns } = await import('./agent-knowledge-sharing-lookup');

const VERIFY = [
  '# verify',
  '',
  '## 変更ファイル',
  '',
  '| File | Kind | What changed & why |',
  '| --- | --- | --- |',
  '| src/reports/export.ts | new | CSV writer; streams rows so large reports do not buffer |',
  '| src/reports/route.ts | modified | GET /reports/:id.csv calls the writer |',
  '',
  '## テスト結果',
].join('\n');

beforeEach(() => {
  verifyContent = null;
  existingPattern = null;
  storedPatterns = [];
  created.length = 0;
  updated.length = 0;
});

describe('extractMethodFromVerify', () => {
  test('reads file + what/why from the changed-files table', () => {
    expect(extractMethodFromVerify(VERIFY)).toEqual([
      'src/reports/export.ts: CSV writer; streams rows so large reports do not buffer',
      'src/reports/route.ts: GET /reports/:id.csv calls the writer',
    ]);
  });
  test('returns nothing when there is no such table', () => {
    expect(extractMethodFromVerify('# verify\n\nall good')).toEqual([]);
  });
});

describe('updatePatternsFromExecution — success', () => {
  test('records the method, not a pointer back to the task', async () => {
    verifyContent = VERIFY;
    await updatePatternsFromExecution(5, true, 99);
    expect(created).toHaveLength(1);
    const actions = JSON.parse(created[0].actions) as string[];
    expect(actions[0]).toContain('src/reports/export.ts');
    expect(created[0].actions).not.toContain('で成功した手法を適用');
  });

  test('files no success pattern when no method was recorded', async () => {
    verifyContent = null;
    await updatePatternsFromExecution(5, true, 99);
    expect(created).toHaveLength(0);
  });

  test('an existing pattern gets the new method, not just a higher confidence', async () => {
    verifyContent = VERIFY;
    existingPattern = { id: 3, confidence: 0.6, metadata: '{}' };
    await updatePatternsFromExecution(5, true, 99);
    expect(updated[0].data.actions).toContain('src/reports/export.ts');
  });
});

describe('findRelevantPatterns — legacy rows', () => {
  test('a self-referential pattern no longer reaches the agent prompt', async () => {
    const conditions = JSON.stringify({ titleKeywords: ['csv', 'export'] });
    storedPatterns = [
      {
        id: 1,
        patternType: 'success_strategy',
        category: 'feature_implementation',
        description: 'old',
        conditions,
        actions: JSON.stringify(['タスク「Add CSV export」で成功した手法を適用']),
        confidence: 0.99,
        occurrences: 9,
      },
      {
        id: 2,
        patternType: 'success_strategy',
        category: 'feature_implementation',
        description: 'new',
        conditions,
        actions: JSON.stringify(['src/reports/export.ts: CSV writer']),
        confidence: 0.6,
        occurrences: 1,
      },
    ];
    const found = await findRelevantPatterns({
      title: 'CSV export for invoices',
      themeId: 1,
      taskLabels: [],
    });
    expect(found.map((p: { id: number }) => p.id)).toEqual([2]);
  });
});
