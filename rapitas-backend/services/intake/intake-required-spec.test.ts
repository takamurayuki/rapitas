/**
 * intake-required-spec.test
 *
 * A development task does not start without its goals and a completion
 * criterion (#1555); a personal task is never stopped for them.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

type Row = {
  id: number;
  title: string;
  workflowStatus: string | null;
  goals: unknown;
  acceptanceCriteria: unknown;
  userAcceptanceChecks: unknown;
  theme: { isDevelopment: boolean } | null;
};
let row: Row | null = null;
const update = mock(async (_a: unknown) => ({}));
mock.module('../../config', () => ({
  prisma: { task: { findUnique: async () => row, update } },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const written: Array<{ type: string; body: string }> = [];
mock.module('../workflow/workflow-file-utils', () => ({
  writeWorkflowFile: async (_id: number, type: string, body: string) => {
    written.push({ type, body });
  },
}));
const recordTransition = mock(async (_p: Record<string, unknown>) => undefined);
mock.module('../workflow/transition-recorder', () => ({ recordTransition }));
mock.module('../communication/notification-service', () => ({
  notifyIntakeQuestionPending: async () => undefined,
}));

const { holdForRequiredSpec, REQUIRED_SPEC_CAUSE } = await import('./intake-required-spec');

const devTask = (over: Partial<Row> = {}): Row => ({
  id: 7,
  title: 'ログに理由を残す',
  workflowStatus: 'draft',
  goals: null,
  acceptanceCriteria: null,
  userAcceptanceChecks: null,
  theme: { isDevelopment: true },
  ...over,
});

beforeEach(() => {
  row = null;
  written.length = 0;
  update.mockClear();
  recordTransition.mockClear();
});

describe('a development task', () => {
  it('waits for its goals and a completion criterion', async () => {
    row = devTask();
    expect(await holdForRequiredSpec(7)).toBe(true);
    expect(update.mock.calls[0][0]).toMatchObject({
      data: { workflowStatus: 'awaiting_question' },
    });
    expect(written[0].type).toBe('question');
    expect(written[0].body).toContain('ゴール');
    const t = recordTransition.mock.calls[0][0];
    expect(t.cause).toBe(REQUIRED_SPEC_CAUSE);
    // Resuming returns to draft, which runs the gate again.
    expect(t.metadata).toMatchObject({
      previousStatus: 'draft',
      missing: ['goals', 'completionCriteria'],
    });
  });

  it('starts once both are written', async () => {
    row = devTask({ goals: '["理由が読める"]', userAcceptanceChecks: '["ログを見て分かる"]' });
    expect(await holdForRequiredSpec(7)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('a task outside a development theme', () => {
  it('is never stopped for them', async () => {
    row = devTask({ theme: { isDevelopment: false } });
    expect(await holdForRequiredSpec(7)).toBe(false);
    row = devTask({ theme: null });
    expect(await holdForRequiredSpec(7)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
