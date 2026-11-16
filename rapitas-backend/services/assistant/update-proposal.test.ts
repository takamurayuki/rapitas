/**
 * update-proposal tests (#1119 stage 6)
 *
 * The model turns a sentence into "this task, these changes". Nothing it says
 * is believed unchecked: a task outside the window, or a change the validator
 * rejects, is dropped — a confident proposal pointing at the wrong task is the
 * one outcome worse than none.
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

const { proposeTaskUpdate } = await import('./update-proposal');

const tasks = [
  {
    id: 10,
    title: 'Write the CSV export',
    status: 'todo',
    priority: 'medium',
    themeId: 1,
    dueDate: null,
  },
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

describe('proposeTaskUpdate', () => {
  test('returns the task, the validated changes and the reason', async () => {
    reply = JSON.stringify({
      taskId: 11,
      changes: { status: 'todo', priority: 'low' },
      reason: '後回しにすると言っているので未着手に戻す',
    });
    const p = await proposeTaskUpdate('ログインのバグは後回し', tasks);
    expect(p).toEqual({
      kind: 'proposal',
      taskId: 11,
      title: 'Fix the login bug',
      changes: { status: 'todo', priority: 'low' },
      reason: '後回しにすると言っているので未着手に戻す',
    });
  });

  test('a task outside the window is not proposed', async () => {
    reply = JSON.stringify({ taskId: 999, changes: { status: 'done' }, reason: 'x' });
    expect((await proposeTaskUpdate('done', tasks)).kind).toBe('unclear');
  });

  test('an invalid change is not proposed', async () => {
    reply = JSON.stringify({ taskId: 10, changes: { status: 'archived' }, reason: 'x' });
    expect((await proposeTaskUpdate('archive it', tasks)).kind).toBe('unclear');
  });

  test('what the model could not settle is passed on, not guessed', async () => {
    reply = JSON.stringify({ taskId: null, unclear: ['どのタスクか分かりません'] });
    expect(await proposeTaskUpdate('あれ終わった', tasks)).toEqual({
      kind: 'unclear',
      unclear: ['どのタスクか分かりません'],
    });
  });

  test('garbage from the model is unclear, not an error', async () => {
    reply = 'sure! I will do that';
    expect((await proposeTaskUpdate('x', tasks)).kind).toBe('unclear');
  });
});
