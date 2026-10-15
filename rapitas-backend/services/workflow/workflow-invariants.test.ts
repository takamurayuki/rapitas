/**
 * workflow-invariants.test
 *
 * Tests for normalizeWorkflowStatus, requiredWorkflowFiles, previewMissingFilesForStatus,
 * and checkWorkflowInvariants.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

// ---- prisma mock ----
const mockFindUnique = mock(() => Promise.resolve(null));
const mockCount = mock(() => Promise.resolve(0));
const mockWorkflowFileFindMany = mock(() => Promise.resolve([] as { fileType: string }[]));
const mockPrisma = {
  task: {
    findUnique: mockFindUnique,
    count: mockCount,
  },
  workflowFile: {
    findMany: mockWorkflowFileFindMany,
  },
};
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));

// ---- workflow-mode-config mock (dynamically imported by resolveIncludePlan) ----
// Defaults to includePlan: true (standard/comprehensive) so pre-existing tests
// that never set task.workflowMode keep seeing the old plan-required behavior.
const mockGetModeSettings = mock((mode: string) =>
  Promise.resolve({
    mode,
    includePlan: mode !== 'lightweight',
    autoVerify: mode === 'lightweight',
    complexityMin: 0,
    complexityMax: 100,
    isEnabled: true,
  }),
);
mock.module('./workflow-mode-config', () => ({
  getModeSettings: mockGetModeSettings,
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

  describe('includePlan=false (lightweight mode)', () => {
    test.each([
      { status: 'plan_created', expected: ['research.md'] },
      { status: 'plan_approved', expected: ['research.md'] },
      { status: 'in_progress', expected: ['research.md'] },
      { status: 'verify_done', expected: ['research.md', 'verify.md'] },
      { status: 'completed', expected: ['research.md', 'verify.md'] },
    ])('$status excludes plan.md', ({ status, expected }) => {
      expect(requiredWorkflowFiles(status, false)).toEqual(expected);
    });
  });
});

// -------------------------------------------------------------------------
describe('previewMissingFilesForStatus', () => {
  beforeEach(() => {
    mockWorkflowFileFindMany.mockReset();
    mockWorkflowFileFindMany.mockResolvedValue([]);
    mockFindUnique.mockReset();
    mockFindUnique.mockResolvedValue(null);
    mockGetModeSettings.mockClear();
  });

  test('returns empty array for draft (no required files, no DB query needed)', async () => {
    const result = await previewMissingFilesForStatus(1, 'draft');
    expect(result).toEqual([]);
    expect(mockWorkflowFileFindMany).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('lightweight mode: verify_done does not flag plan.md as missing', async () => {
    mockFindUnique.mockResolvedValueOnce({ workflowMode: 'lightweight' });
    mockWorkflowFileFindMany.mockResolvedValueOnce([{ fileType: 'research' }]);
    const result = await previewMissingFilesForStatus(1, 'verify_done');
    expect(result).toEqual(['verify.md']);
  });

  test('comprehensive mode: verify_done still flags plan.md as missing (regression)', async () => {
    mockFindUnique.mockResolvedValueOnce({ workflowMode: 'comprehensive' });
    mockWorkflowFileFindMany.mockResolvedValueOnce([{ fileType: 'research' }]);
    const result = await previewMissingFilesForStatus(1, 'verify_done');
    expect(result).toEqual(['plan.md', 'verify.md']);
  });

  test('returns empty array when all required WorkflowFile rows exist', async () => {
    mockWorkflowFileFindMany.mockResolvedValueOnce([
      { fileType: 'research' },
      { fileType: 'plan' },
    ]);
    const result = await previewMissingFilesForStatus(1, 'plan_created');
    expect(result).toEqual([]);
  });

  test('returns missing files when some WorkflowFile rows are absent', async () => {
    // plan.md exists, research.md does not.
    mockWorkflowFileFindMany.mockResolvedValueOnce([{ fileType: 'plan' }]);
    const result = await previewMissingFilesForStatus(1, 'plan_created');
    expect(result).toEqual(['research.md']);
  });

  test('returns all required files as missing when no WorkflowFile rows exist', async () => {
    mockWorkflowFileFindMany.mockResolvedValueOnce([]);
    const result = await previewMissingFilesForStatus(1, 'verify_done');
    expect(result).toEqual(['research.md', 'plan.md', 'verify.md']);
  });
});

// -------------------------------------------------------------------------
describe('checkWorkflowInvariants', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockCount.mockReset();
    mockWorkflowFileFindMany.mockReset();
    mockWorkflowFileFindMany.mockResolvedValue([]);
    mockGetModeSettings.mockClear();
  });

  test('lightweight mode: verify_done with plan.md missing reports no violations (task #607 regression)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'done',
      workflowStatus: 'verify_done',
      workflowMode: 'lightweight',
    });
    mockWorkflowFileFindMany.mockResolvedValueOnce([
      { fileType: 'research' },
      { fileType: 'verify' },
    ]);
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    expect(result.filter((v) => v.code === 'missing_file')).toHaveLength(0);
  });

  test('lightweight mode: completed with plan.md missing reports no violations', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'done',
      workflowStatus: 'completed',
      workflowMode: 'lightweight',
    });
    mockWorkflowFileFindMany.mockResolvedValueOnce([
      { fileType: 'research' },
      { fileType: 'verify' },
    ]);
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    expect(result).toHaveLength(0);
  });

  test('standard mode: verify_done with plan.md missing still reports missing_file (regression)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'done',
      workflowStatus: 'verify_done',
      workflowMode: 'standard',
    });
    mockWorkflowFileFindMany.mockResolvedValueOnce([
      { fileType: 'research' },
      { fileType: 'verify' },
    ]);
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    const missing = result.filter((v) => v.code === 'missing_file');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('plan.md');
  });

  test('null workflowMode falls back to plan-required behavior (pre-existing tasks)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'done',
      workflowStatus: 'verify_done',
      workflowMode: null,
    });
    mockWorkflowFileFindMany.mockResolvedValueOnce([
      { fileType: 'research' },
      { fileType: 'verify' },
    ]);
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    expect(result.filter((v) => v.code === 'missing_file')).toHaveLength(1);
  });

  test('draft status does not resolve mode (getModeSettings not called)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'todo',
      workflowStatus: 'draft',
      workflowMode: 'lightweight',
    });
    mockCount.mockResolvedValueOnce(0);
    await checkWorkflowInvariants(1);
    expect(mockGetModeSettings).not.toHaveBeenCalled();
  });

  test('returns task_not_found when task is missing', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await checkWorkflowInvariants(999);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('task_not_found');
  });

  test('returns no violations when research_done and the research WorkflowFile row exists', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'todo',
      workflowStatus: 'research_done',
    });
    mockWorkflowFileFindMany.mockResolvedValueOnce([{ fileType: 'research' }]);
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    expect(result).toHaveLength(0);
  });

  test.each([
    {
      desc: 'detects missing_file for plan_created without the plan WorkflowFile row',
      task: { id: 1, status: 'todo', workflowStatus: 'plan_created' },
      present: [{ fileType: 'research' }],
      count: 0,
      expectedCode: 'missing_file',
      expectedMessageContains: 'plan.md',
    },
    {
      desc: 'detects missing_file for plan_created without the research WorkflowFile row',
      task: { id: 1, status: 'todo', workflowStatus: 'plan_created' },
      present: [{ fileType: 'plan' }],
      count: 0,
      expectedCode: 'missing_file',
      expectedMessageContains: 'research.md',
    },
    {
      desc: 'detects missing_file for verify_done when the verify WorkflowFile row is absent',
      task: { id: 1, status: 'done', workflowStatus: 'verify_done' },
      present: [{ fileType: 'research' }, { fileType: 'plan' }],
      count: 0,
      expectedCode: 'missing_file',
      expectedMessageContains: 'verify.md',
    },
    {
      desc: 'detects status_mismatch for completed task with status != done',
      task: { id: 1, status: 'todo', workflowStatus: 'completed' },
      present: [{ fileType: 'research' }, { fileType: 'plan' }, { fileType: 'verify' }],
      count: 0,
      expectedCode: 'status_mismatch',
      expectedMessageContains: undefined as string | undefined,
    },
    {
      desc: 'detects incomplete_subtasks for verify_done with open subtasks',
      task: { id: 1, status: 'done', workflowStatus: 'verify_done' },
      present: [{ fileType: 'research' }, { fileType: 'plan' }, { fileType: 'verify' }],
      count: 2,
      expectedCode: 'incomplete_subtasks',
      expectedMessageContains: undefined as string | undefined,
    },
  ])('$desc', async ({ task, present, count, expectedCode, expectedMessageContains }) => {
    mockFindUnique.mockResolvedValueOnce(task);
    mockWorkflowFileFindMany.mockResolvedValueOnce(present);
    mockCount.mockResolvedValueOnce(count);
    const result = await checkWorkflowInvariants(1);
    const codes = result.map((v) => v.code);
    expect(codes).toContain(expectedCode);
    if (expectedMessageContains) {
      const msg = result.find((v) => v.code === expectedCode)?.message ?? '';
      expect(msg).toContain(expectedMessageContains);
    }
  });

  test('treats empty workflowStatus as draft (no violations, no WorkflowFile query)', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, status: 'todo', workflowStatus: '' });
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    // draft has no file requirements and no status_mismatch (not 'completed')
    expect(result.filter((v) => v.code === 'missing_file')).toHaveLength(0);
    expect(mockWorkflowFileFindMany).not.toHaveBeenCalled();
  });

  test('returns no violations for in_progress with both WorkflowFile rows present', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, status: 'todo', workflowStatus: 'in_progress' });
    mockWorkflowFileFindMany.mockResolvedValueOnce([
      { fileType: 'research' },
      { fileType: 'plan' },
    ]);
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    expect(result).toHaveLength(0);
  });
});
