/**
 * update-proposal done-guard tests (companion design ch.2, stage 1 item 4)
 *
 * The draft half of "ラピ never marks a task done": whatever the model says,
 * the card it produces never offers `status: 'done'`. The prompt asks the
 * model not to; these pin the server-side drop that does not rely on it.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { aiClientStub } from '../../tests/helpers/ai-client-stub';

let reply = '';
mock.module('../../utils/ai-client', () =>
  aiClientStub({ sendAIMessage: async () => ({ content: reply, tokensUsed: 0 }) }),
);
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

const { proposeTaskUpdate, DONE_VIA_TASK_SCREEN } = await import('./update-proposal');

const tasks = [
  {
    id: 11,
    title: 'Fix the login bug',
    status: 'in-progress',
    priority: 'high',
    themeId: 1,
    dueDate: null,
  },
];

beforeEach(() => {
  reply = '';
});

describe('a draft never proposes done', () => {
  test('done alone becomes "use the task screen", not a proposal', async () => {
    reply = JSON.stringify({ taskId: 11, changes: { status: 'done' }, reason: '直したので完了' });
    const p = await proposeTaskUpdate('ログインのバグ直した、完了にして', tasks);
    expect(p).toEqual({ kind: 'unclear', unclear: [DONE_VIA_TASK_SCREEN] });
  });

  test('done next to another change keeps the other change only', async () => {
    reply = JSON.stringify({
      taskId: 11,
      changes: { status: 'done', priority: 'low' },
      reason: '完了にして優先度も下げる',
    });
    const p = await proposeTaskUpdate('完了にして優先度は低で', tasks);
    expect(p.kind).toBe('proposal');
    if (p.kind !== 'proposal') return;
    expect(p.changes).toEqual({ priority: 'low' });
    expect(JSON.stringify(p)).not.toContain('"done"');
  });
});
