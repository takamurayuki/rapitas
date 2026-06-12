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
  test('returns draft for null', () => {
    expect(normalizeWorkflowStatus(null)).toBe('draft');
  });
  test('returns draft for undefined', () => {
    expect(normalizeWorkflowStatus(undefined)).toBe('draft');
  });
  test('returns draft for empty string', () => {
    expect(normalizeWorkflowStatus('')).toBe('draft');
  });
  test('returns draft for whitespace-only string', () => {
    expect(normalizeWorkflowStatus('   ')).toBe('draft');
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

  test('returns empty array when task is not found', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await previewMissingFilesForStatus(99, 'plan_created');
    expect(result).toEqual([]);
  });

  test('returns empty array when all required files exist', async () => {
    mockFindUnique.mockResolvedValueOnce({ themeId: 1, theme: { categoryId: 2 } });
    mockExistsSync.mockImplementation(() => true);
    const result = await previewMissingFilesForStatus(1, 'plan_created');
    expect(result).toEqual([]);
  });

  test('returns missing files when some are absent', async () => {
    mockFindUnique.mockResolvedValueOnce({ themeId: 1, theme: { categoryId: 2 } });
    // research.md absent, plan.md present
    mockExistsSync.mockImplementation((p: string) => !p.includes('research.md'));
    const result = await previewMissingFilesForStatus(1, 'plan_created');
    expect(result).toEqual(['research.md']);
  });

  test('returns empty array for draft (no required files)', async () => {
    mockFindUnique.mockResolvedValueOnce({ themeId: null, theme: null });
    mockExistsSync.mockImplementation(() => false);
    const result = await previewMissingFilesForStatus(1, 'draft');
    expect(result).toEqual([]);
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

  test('detects missing_file for plan_created without plan.md', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'todo',
      workflowStatus: 'plan_created',
      themeId: null,
      theme: null,
    });
    // research.md exists but plan.md does not
    mockExistsSync.mockImplementation((p: string) => !p.includes('plan.md'));
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    const codes = result.map((v) => v.code);
    expect(codes).toContain('missing_file');
    const msg = result.find((v) => v.code === 'missing_file')?.message ?? '';
    expect(msg).toContain('plan.md');
  });

  test('detects missing_file for plan_created without research.md', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'todo',
      workflowStatus: 'plan_created',
      themeId: null,
      theme: null,
    });
    mockExistsSync.mockImplementation((p: string) => !p.includes('research.md'));
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    const codes = result.map((v) => v.code);
    expect(codes).toContain('missing_file');
    const msg = result.find((v) => v.code === 'missing_file')?.message ?? '';
    expect(msg).toContain('research.md');
  });

  test('detects missing_file for verify_done when verify.md is absent', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'done',
      workflowStatus: 'verify_done',
      themeId: null,
      theme: null,
    });
    // research.md and plan.md exist but verify.md does not
    mockExistsSync.mockImplementation((p: string) => !p.includes('verify.md'));
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    const msgs = result.map((v) => v.message);
    expect(msgs.some((m) => m.includes('verify.md'))).toBe(true);
  });

  test('detects status_mismatch for completed task with status != done', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'todo',
      workflowStatus: 'completed',
      themeId: null,
      theme: null,
    });
    mockExistsSync.mockImplementation(() => true);
    mockCount.mockResolvedValueOnce(0);
    const result = await checkWorkflowInvariants(1);
    const codes = result.map((v) => v.code);
    expect(codes).toContain('status_mismatch');
  });

  test('detects incomplete_subtasks for verify_done with open subtasks', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 1,
      status: 'done',
      workflowStatus: 'verify_done',
      themeId: null,
      theme: null,
    });
    mockExistsSync.mockImplementation(() => true);
    mockCount.mockResolvedValueOnce(2);
    const result = await checkWorkflowInvariants(1);
    const codes = result.map((v) => v.code);
    expect(codes).toContain('incomplete_subtasks');
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
