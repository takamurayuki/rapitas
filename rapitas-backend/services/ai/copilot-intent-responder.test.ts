/**
 * copilot-intent-responder.test
 *
 * Unit tests for the deterministic factual-question shortcut: intent
 * matching must stay narrow (short, keyword-specific messages only) and
 * each responder must format from mocked Prisma reads, with no LLM
 * involved at all.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockTaskFindUnique = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
const mockTransitionFindFirst = mock(() => Promise.resolve<Record<string, unknown> | null>(null));

mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: mockTaskFindUnique },
    workflowTransition: { findFirst: mockTransitionFindFirst },
  },
}));

const { matchCopilotIntent, respondToIntent } = await import('./copilot-intent-responder');

beforeEach(() => {
  mockTaskFindUnique.mockReset();
  mockTransitionFindFirst.mockReset();
});

describe('matchCopilotIntent', () => {
  it.each([
    ['サブタスクの進捗は？', 'subtask_progress'],
    ['サブタスクの状況を教えて', 'subtask_progress'],
    ['なぜブロックされてるの？', 'blocked_reason'],
    ['ブロックの理由は？', 'blocked_reason'],
    ['期限はいつ？', 'due_estimate'],
    ['見積もりはどれくらい？', 'due_estimate'],
    ['ステータスを教えて', 'status_priority'],
    ['優先度は？', 'status_priority'],
  ])('matches "%s" -> %s', (message, expected) => {
    expect(matchCopilotIntent(message)).toBe(expected);
  });

  it('returns null for messages with no recognizable factual-lookup keyword', () => {
    expect(matchCopilotIntent('このタスクの実装方針についてどう思う？')).toBeNull();
  });

  it('returns null for long messages even if they contain a matching keyword', () => {
    // Regression: a long, open-ended question mentioning "ステータス" in
    // passing should still get real reasoning from the LLM, not a canned
    // one-line status readout.
    const long =
      'ステータスを見た上で、このタスクを進める上で気をつけるべき点や次にやるべきことを詳しく教えてください';
    expect(matchCopilotIntent(long)).toBeNull();
  });

  it('returns null for an empty/whitespace-only message', () => {
    expect(matchCopilotIntent('   ')).toBeNull();
  });
});

describe('respondToIntent', () => {
  describe('subtask_progress', () => {
    it('reports done/total counts when subtasks exist', async () => {
      mockTaskFindUnique.mockResolvedValue({
        subtasks: [{ status: 'done' }, { status: 'done' }, { status: 'todo' }],
      });
      const result = await respondToIntent('subtask_progress', 1);
      expect(result).toBe('サブタスクの進捗は 2/3 件完了です。');
    });

    it('returns null (fall through to LLM) when the task has no subtasks', async () => {
      mockTaskFindUnique.mockResolvedValue({ subtasks: [] });
      expect(await respondToIntent('subtask_progress', 1)).toBeNull();
    });
  });

  describe('blocked_reason', () => {
    it('says the task is not blocked when status is not "blocked"', async () => {
      mockTaskFindUnique.mockResolvedValue({ status: 'in-progress' });
      const result = await respondToIntent('blocked_reason', 1);
      expect(result).toBe('このタスクは現在ブロックされていません。');
    });

    it('maps a known cause code to its human-readable message', async () => {
      mockTaskFindUnique.mockResolvedValue({ status: 'blocked' });
      mockTransitionFindFirst.mockResolvedValue({ cause: 'subtask_failed' });
      const result = await respondToIntent('blocked_reason', 1);
      expect(result).toBe('一部のサブタスクが失敗したため、親タスクをブロックしました。');
    });

    it('falls back to a generic message with the raw cause code when unrecognized', async () => {
      mockTaskFindUnique.mockResolvedValue({ status: 'blocked' });
      mockTransitionFindFirst.mockResolvedValue({ cause: 'some_new_cause' });
      const result = await respondToIntent('blocked_reason', 1);
      expect(result).toBe('タスクがブロックされています（原因コード: some_new_cause）。');
    });
  });

  describe('due_estimate', () => {
    it('formats due date and estimate/actual hours together', async () => {
      mockTaskFindUnique.mockResolvedValue({
        dueDate: new Date('2026-08-01T00:00:00Z'),
        estimatedHours: 5,
        actualHours: 2,
      });
      const result = await respondToIntent('due_estimate', 1);
      expect(result).toBe('期限: 2026-08-01 / 見積もり工数: 5h（実績: 2h）');
    });

    it('returns null (fall through to LLM) when neither due date nor estimate is set', async () => {
      mockTaskFindUnique.mockResolvedValue({
        dueDate: null,
        estimatedHours: null,
        actualHours: null,
      });
      expect(await respondToIntent('due_estimate', 1)).toBeNull();
    });
  });

  describe('status_priority', () => {
    it('formats known status/priority values with their labels', async () => {
      mockTaskFindUnique.mockResolvedValue({ status: 'in-progress', priority: 'high' });
      const result = await respondToIntent('status_priority', 1);
      expect(result).toBe('現在のステータスは「進行中」、優先度は「高」です。');
    });

    it('falls back to the raw value for an unrecognized status/priority', async () => {
      mockTaskFindUnique.mockResolvedValue({ status: 'weird-status', priority: 'weird-priority' });
      const result = await respondToIntent('status_priority', 1);
      expect(result).toBe('現在のステータスは「weird-status」、優先度は「weird-priority」です。');
    });
  });

  it('returns null when the task cannot be found', async () => {
    mockTaskFindUnique.mockResolvedValue(null);
    expect(await respondToIntent('status_priority', 999)).toBeNull();
  });
});
