/**
 * workflow-invariants.test
 *
 * Tests for normalizeWorkflowStatus, requiredWorkflowFiles, previewMissingFilesForStatus,
 * and checkWorkflowInvariants.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

// ---- fs mock ----
const mockExistsSync = mock((_path: string) => true);
mock.module('fs', () => ({
  existsSync: mockExistsSync,
}));

// ---- prisma mock ----
const mockFindUnique = mock(() => Promise.resolve(null));
const mockCount = mock(() => Promise.resolve(0));
const mockPrisma = {
  task: {
    findUnique: mockFindUnique,
    count: mockCount,
  },
};
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));

// ---- workflow-paths mock ----
mock.module('./workflow-paths', () => ({
  getTaskWorkflowDir: (_cat: unknown, _theme: unknown, taskId: number) =>
    `/fake/workflows/0/0/${taskId}`,
}));

import {
  normalizeWorkflowStatus,
  requiredWorkflowFiles,
  previewMissingFilesForStatus,
  checkWorkflowInvariants,
} from './workflow-invariants';

// -------------------------------------------------------------------------
describe('normalizeWorkflowStatus', () => {
  test.each([
    { name: 'null', input: null },
    { name: 'undefined', input: undefined },
    { name: 'empty string', input: '' },
    { name: 'whitespace-only string', input: '   ' },
  ])('returns draft for $name', ({ input }) => {
    expect(normalizeWorkflowStatus(input)).toBe('draft');
  });
  test('returns the status unchanged for a valid string', () => {
    expect(normalizeWorkflowStatus('plan_created')).toBe('plan_created');
  });
  test('trims surrounding whitespace from a valid string', () => {
    expect(normalizeWorkflowStatus('  in_progress  ')).toBe('in_progress');
  });
});

// -------------------------------------------------------------------------
describe('requiredWorkflowFiles', () => {
  test('draft requires no files', () => {
    expect(requiredWorkflowFiles('draft')).toEqual([]);
  });
  test('awaiting_question requires no files', () => {
    expect(requiredWorkflowFiles('awaiting_question')).toEqual([]);
  });
  test('unknown status requires no files', () => {
    expect(requiredWorkflowFiles('bogus_status')).toEqual([]);
  });
  test('research_done requires only research.md', () => {
    expect(requiredWorkflowFiles('research_done')).toEqual(['research.md']);
  });
  test('plan_created requires research.md and plan.md', () => {
    expect(requiredWorkflowFiles('plan_created')).toEqual(['research.md', 'plan.md']);
  });
  test('plan_approved requires research.md and plan.md', () => {
    expect(requiredWorkflowFiles('plan_approved')).toEqual(['research.md', 'plan.md']);
  });
  test('in_progress requires research.md and plan.md', () => {
    expect(requiredWorkflowFiles('in_progress')).toEqual(['research.md', 'plan.md']);
  });
  test('verify_done requires all three files', () => {
    expect(requiredWorkflowFiles('verify_done')).toEqual(['research.md', 'plan.md', 'verify.md']);
  });
  test('completed requires all three files', () => {
    expect(requiredWorkflowFiles('completed')).toEqual(['research.md', 'plan.md', 'verify.md']);
  });
});

// -------------------------------------------------------------------------
describe('previewMissingFilesForStatus', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockExistsSync.mockReset();
  });

  test.each([
    {
      desc: 'returns empty array when task is not found',
      findUniqueValue: null as {
        themeId: number | null;
        theme: { categoryId: number } | null;
      } | null,
      existsImpl: () => true,
      taskId: 99,
      status: 'plan_created',
      expected: [] as string[],
    },
    {
      desc: 'returns empty array when all required files exist',
      findUniqueValue: { themeId: 1, theme: { categoryId: 2 } },
      existsImpl: () => true,
      taskId: 1,
      status: 'plan_created',
      expected: [],
    },
    {
      desc: 'returns missing files when some are absent',
      findUniqueValue: { themeId: 1, theme: { categoryId: 2 } },
      // research.md absent, plan.md present
      existsImpl: (p: string) => !p.includes('research.md'),
      taskId: 1,
      status: 'plan_created',
      expected: ['research.md'],
    },
    {
      desc: 'returns empty array for draft (no required files)',
      findUniqueValue: { themeId: null, theme: null },
      existsImpl: () => false,
      taskId: 1,
      status: 'draft',
      expected: [],
    },
  ])('$desc', async ({ findUniqueValue, existsImpl, taskId, status, expected }) => {
    mockFindUnique.mockResolvedValueOnce(findUniqueValue);
    mockExistsSync.mockImplementation(existsImpl);
    const result = await previewMissingFilesForStatus(taskId, status);
    expect(result).toEqual(expected);
  });
});

// -------------------------------------------------------------------------
describe('checkWorkflowInvariants', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockCount.mockReset();
    mockExistsSync.mockReset();
  });

  test('returns task_not_found when task is missing', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await checkWorkflowInvariants(999);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('task_not_found');
  });

  test('returns no violations when research_done and research.md exists', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'todo',
      workflowStatus: 'research_done',
      themeId: null,
      theme: null,
    });
    mockExistsSync.mockImplementation(() => true);
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    expect(result).toHaveLength(0);
  });

  test.each([
    {
      desc: 'detects missing_file for plan_created without plan.md',
      task: { id: 1, status: 'todo', workflowStatus: 'plan_created', themeId: null, theme: null },
      // research.md exists but plan.md does not
      existsImpl: (p: string) => !p.includes('plan.md'),
      count: 0,
      expectedCode: 'missing_file',
      expectedMessageContains: 'plan.md',
    },
    {
      desc: 'detects missing_file for plan_created without research.md',
      task: { id: 1, status: 'todo', workflowStatus: 'plan_created', themeId: null, theme: null },
      existsImpl: (p: string) => !p.includes('research.md'),
      count: 0,
      expectedCode: 'missing_file',
      expectedMessageContains: 'research.md',
    },
    {
      desc: 'detects missing_file for verify_done when verify.md is absent',
      task: { id: 1, status: 'done', workflowStatus: 'verify_done', themeId: null, theme: null },
      // research.md and plan.md exist but verify.md does not
      existsImpl: (p: string) => !p.includes('verify.md'),
      count: 0,
      expectedCode: 'missing_file',
      expectedMessageContains: 'verify.md',
    },
    {
      desc: 'detects status_mismatch for completed task with status != done',
      task: { id: 1, status: 'todo', workflowStatus: 'completed', themeId: null, theme: null },
      existsImpl: () => true,
      count: 0,
      expectedCode: 'status_mismatch',
      expectedMessageContains: undefined as string | undefined,
    },
    {
      desc: 'detects incomplete_subtasks for verify_done with open subtasks',
      task: { id: 1, status: 'done', workflowStatus: 'verify_done', themeId: null, theme: null },
      existsImpl: () => true,
      count: 2,
      expectedCode: 'incomplete_subtasks',
      expectedMessageContains: undefined as string | undefined,
    },
  ])('$desc', async ({ task, existsImpl, count, expectedCode, expectedMessageContains }) => {
    mockFindUnique.mockResolvedValueOnce(task);
    mockExistsSync.mockImplementation(existsImpl);
    mockCount.mockResolvedValueOnce(count);
    const result = await checkWorkflowInvariants(1);
    const codes = result.map((v) => v.code);
    expect(codes).toContain(expectedCode);
    if (expectedMessageContains) {
      const msg = result.find((v) => v.code === expectedCode)?.message ?? '';
      expect(msg).toContain(expectedMessageContains);
    }
  });

  test('treats empty workflowStatus as draft (no violations)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'todo',
      workflowStatus: '',
      themeId: null,
      theme: null,
    });
    // draft requires no files, so existsSync result doesn't matter
    mockExistsSync.mockImplementation(() => false);
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    // draft has no file requirements and no status_mismatch (not 'completed')
    expect(result.filter((v) => v.code === 'missing_file')).toHaveLength(0);
  });

  test('returns no violations for in_progress with all files present', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'todo',
      workflowStatus: 'in_progress',
      themeId: null,
      theme: null,
    });
    mockExistsSync.mockImplementation(() => true);
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    expect(result).toHaveLength(0);
  });
});
