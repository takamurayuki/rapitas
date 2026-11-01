/**
 * delete-proposal.test
 *
 * A suggestion that puts a task in front of a delete button has to be a task
 * the user can actually see. So these are mostly about what is thrown away:
 * ids outside the window, prose instead of JSON, and the model being absent.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

let reply: string | Error = '{}';
let sent: { systemPrompt?: string; content: string }[] = [];

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async (options: { systemPrompt?: string; messages: { content: string }[] }) => {
    sent.push({
      systemPrompt: options.systemPrompt,
      content: options.messages.map((m) => m.content).join('\n'),
    });
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

const { proposeDeletions } = await import('./delete-proposal');

const TASKS = [
  { id: 1, title: '重複: アバターを直す', status: 'todo', themeId: 1, updatedAt: '2026-10-01' },
  { id: 2, title: 'アバターを直す', status: 'todo', themeId: 1, updatedAt: '2026-10-02' },
  { id: 3, title: '健康診断の予約', status: 'done', themeId: 36, updatedAt: '2026-09-01' },
];

const GOOD = JSON.stringify({
  ids: [1],
  reasons: { '1': '「アバターを直す」と内容が重複しており、こちらが古いため' },
  unclear: [],
});

beforeEach(() => {
  sent = [];
  reply = GOOD;
});

describe('proposing', () => {
  test('returns the chosen tasks with the reason for each', async () => {
    const out = await proposeDeletions('重複しているタスクを片付けて', TASKS);
    expect(out?.candidates).toHaveLength(1);
    expect(out?.candidates[0]).toMatchObject({ id: 1, title: '重複: アバターを直す' });
    expect(out?.candidates[0].reason).toContain('重複');
  });

  test('says how many it actually weighed, so the answer is not mistaken for all of them', async () => {
    const out = await proposeDeletions('片付けて', TASKS);
    expect(out?.considered).toBe(3);
  });

  test('shows the model the status and the age, not just the titles', async () => {
    await proposeDeletions('片付けて', TASKS);
    expect(sent[0].content).toContain('status=done');
    expect(sent[0].content).toContain('2026-09-01');
  });

  test('tells the model not to pick when it is unsure', async () => {
    await proposeDeletions('片付けて', TASKS);
    expect(sent[0].systemPrompt).toContain('迷ったら選ばない');
  });

  test('accepts an empty answer rather than forcing a victim', async () => {
    reply = JSON.stringify({ ids: [], reasons: {}, unclear: [] });
    const out = await proposeDeletions('なにか消して', TASKS);
    expect(out?.candidates).toEqual([]);
  });
});

describe('what it refuses to pass on', () => {
  // The worst failure here is a confident suggestion pointing at a task the
  // user never saw.
  test('drops an id that was not in the window', async () => {
    reply = JSON.stringify({ ids: [1, 999], reasons: { '1': 'a', '999': 'b' }, unclear: [] });
    const out = await proposeDeletions('片付けて', TASKS);
    expect(out?.candidates.map((c) => c.id)).toEqual([1]);
  });

  test('drops a non-numeric id', async () => {
    reply = JSON.stringify({ ids: ['1', null], reasons: {}, unclear: [] });
    const out = await proposeDeletions('片付けて', TASKS);
    expect(out?.candidates).toEqual([]);
  });

  test('keeps a candidate whose reason is missing rather than inventing one', async () => {
    reply = JSON.stringify({ ids: [2], reasons: {}, unclear: [] });
    const out = await proposeDeletions('片付けて', TASKS);
    expect(out?.candidates[0]).toMatchObject({ id: 2, reason: '' });
  });

  test('caps the open questions', async () => {
    reply = JSON.stringify({ ids: [], reasons: {}, unclear: ['a', 'b', 'c', 'd', 'e'] });
    const out = await proposeDeletions('片付けて', TASKS);
    expect(out?.unclear).toEqual(['a', 'b', 'c']);
  });

  test('finds the JSON through a code fence', async () => {
    reply = 'こちらです\n```json\n' + GOOD + '\n```';
    const out = await proposeDeletions('片付けて', TASKS);
    expect(out?.candidates).toHaveLength(1);
  });

  test('gives up rather than guessing when there is no JSON', async () => {
    reply = 'よく分かりませんでした';
    expect(await proposeDeletions('片付けて', TASKS)).toBeNull();
  });
});

describe('when it cannot run', () => {
  test('returns null when the model is unavailable', async () => {
    reply = new Error('補助AI機能は無効化されています (RAPITAS_AUX_AI=off)。');
    expect(await proposeDeletions('片付けて', TASKS)).toBeNull();
  });

  // No window, no suggestion — and no call to a model to tell us so.
  test('does not ask the model when there is nothing to choose from', async () => {
    expect(await proposeDeletions('片付けて', [])).toBeNull();
    expect(sent).toEqual([]);
  });

  test('does not ask the model for an empty utterance', async () => {
    expect(await proposeDeletions('   ', TASKS)).toBeNull();
    expect(sent).toEqual([]);
  });
});
