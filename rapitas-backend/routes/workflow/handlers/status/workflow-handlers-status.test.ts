/**
 * workflow-handlers-status.test
 *
 * PUT /workflow/tasks/:id/status: who may call it (ui | operator), the reason an
 * operator must give, what the transition records, and that the queue sync is wired.
 * Imports through workflow-handlers-plan so the file also loads on the base commit.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const mockFindUnique = mock((): Promise<unknown> => Promise.resolve(null));
const mockUpdate = mock((_args: unknown) => Promise.resolve({ id: 1 }));
const mockUpdateMany = mock((_args: unknown) => Promise.resolve({ count: 1 }));
const mockPrisma = {
  task: { findUnique: mockFindUnique, update: mockUpdate, updateMany: mockUpdateMany },
  activityLog: { create: mock(() => Promise.resolve({})) },
  agentExecution: { findMany: mock(() => Promise.resolve([])) },
  workflowQueueItem: {
    findMany: mock(() => Promise.resolve([])),
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
};
const silentLog = () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} });
mock.module('../../../../config', () => ({ prisma: mockPrisma }));
mock.module('../../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../../config/logger', () => ({ createLogger: silentLog }));

const mockRecordTransition = mock((_input: unknown) => Promise.resolve());
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

const mockPreviewMissing = mock(() => Promise.resolve([] as string[]));
mock.module('../../../../services/workflow/workflow-invariants', () => ({
  previewMissingFilesForStatus: mockPreviewMissing,
}));

mock.module('../../../../middleware/error-handler', () => ({
  parseId: () => 1,
  ValidationError: class ValidationError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ValidationError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
}));

mock.module('../../core/workflow-helpers', () => ({
  VALID_WORKFLOW_STATUSES: ['draft', 'research_done', 'plan_approved'] as const,
}));

const { handleUpdateStatus } = await import('../workflow-handlers-plan');

type Recorded = {
  actor: string;
  cause: string;
  metadata: Record<string, unknown>;
  invariantViolation?: boolean;
};

const call = (headers: Record<string, string>, body: Record<string, unknown>) =>
  handleUpdateStatus({
    params: { taskId: '1' },
    body: { status: 'plan_approved', ...body },
    headers,
    set: { status: 200 },
  });

const recorded = () => mockRecordTransition.mock.calls[0]?.[0] as Recorded;

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockClear();
  mockUpdateMany.mockClear();
  mockRecordTransition.mockClear();
  mockPreviewMissing.mockReset();
  mockPreviewMissing.mockResolvedValue([]);
  mockFindUnique.mockResolvedValue({
    id: 1,
    workflowStatus: 'draft',
    status: 'todo',
    themeId: null,
  });
});

describe('allowed callers', () => {
  test('operator with a reason succeeds and records source and reason', async () => {
    const result = await call({ 'x-rapitas-source': 'operator' }, { reason: '  stuck in draft ' });

    expect(result).toMatchObject({ success: true, workflowStatus: 'plan_approved' });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(recorded()).toMatchObject({
      actor: 'user',
      cause: 'manual_status_change',
      metadata: { source: 'operator', sourceLabel: 'オペレーター', reason: 'stuck in draft' },
    });
  });

  test('ui succeeds and records source ui', async () => {
    await call({ 'x-rapitas-source': 'ui' }, { reason: 'redo' });

    expect(recorded()).toMatchObject({
      cause: 'manual_status_change',
      metadata: { source: 'ui', sourceLabel: 'UI', reason: 'redo' },
    });
  });

  test('ui without a reason is still accepted', async () => {
    const result = await call({ 'x-rapitas-source': 'ui' }, {});

    expect(result).toMatchObject({ success: true });
    expect(recorded().metadata).toMatchObject({ source: 'ui', reason: null });
  });

  test('force with missing files keeps source and reason on the transition', async () => {
    mockPreviewMissing.mockResolvedValue(['plan.md']);

    await call({ 'x-rapitas-source': 'operator' }, { reason: 'recover', force: true });

    expect(recorded()).toMatchObject({
      invariantViolation: true,
      metadata: { source: 'operator', reason: 'recover', force: true, missingFiles: ['plan.md'] },
    });
  });
});

describe('refusals', () => {
  test.each([
    ['no reason', {}],
    ['an empty reason', { reason: '' }],
    ['a blank reason', { reason: '   ' }],
    ['a non-string reason', { reason: 42 }],
  ])('operator with %s is a validation error and writes nothing', async (_label, body) => {
    await expect(call({ 'x-rapitas-source': 'operator' }, body)).rejects.toMatchObject({
      name: 'ValidationError',
      message: expect.stringContaining('reason'),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test.each([
    ['no header', {} as Record<string, string>],
    ['agent', { 'x-rapitas-source': 'agent' }],
    ['an inherited object key', { 'x-rapitas-source': 'constructor' }],
  ])('%s is refused as manual_status_change_blocked', async (_label, headers) => {
    await expect(call(headers, { reason: 'let me through' })).rejects.toMatchObject({
      name: 'ValidationError',
    });
    expect(recorded()).toMatchObject({
      cause: 'manual_status_change_blocked',
      invariantViolation: true,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('queue sync wiring', () => {
  test('a blocked task reset to draft is revived to todo and reports the outcome', async () => {
    mockFindUnique.mockResolvedValue({
      id: 1,
      workflowStatus: 'plan_approved',
      status: 'blocked',
      themeId: null,
    });

    const result = await call({ 'x-rapitas-source': 'ui' }, { status: 'draft', reason: 'redo' });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'blocked' },
      data: { status: 'todo' },
    });
    expect(result).toMatchObject({ queueSync: { outcome: 'not_current' } });
  });
});
