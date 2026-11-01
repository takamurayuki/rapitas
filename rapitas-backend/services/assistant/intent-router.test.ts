/**
 * intent-router.test
 *
 * One sentence in, one destination out.
 *
 * The property that keeps this safe is that routing writes nothing — every
 * destination is a read, and the two that can change anything (filing a task,
 * deleting tasks) ask for confirmation of their own afterwards. So a wrong
 * route costs a wasted read and nothing else, which is why the model is
 * allowed to decide at all.
 *
 * What it must never do is guess when it does not know. "Unknown" leaves the
 * tabs doing what they already did; a confident wrong answer sends the user
 * somewhere they did not ask for and hides that it happened.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

let reply: string | Error = '{}';
let sent: { systemPrompt?: string; content: string }[] = [];

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async (o: { systemPrompt?: string; messages: { content: string }[] }) => {
    sent.push({
      systemPrompt: o.systemPrompt,
      content: o.messages.map((m) => m.content).join('\n'),
    });
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

const { routeIntent, ROUTABLE_INTENTS } = await import('./intent-router');

const says = (intent: string, reason = 'なんとなく') => JSON.stringify({ intent, reason });

beforeEach(() => {
  sent = [];
  reply = says('create');
});

describe('choosing a destination', () => {
  test.each([...ROUTABLE_INTENTS])('accepts %s', async (intent) => {
    reply = says(intent);
    const out = await routeIntent('なにか', true);
    expect(out?.intent).toBe(intent);
  });

  // Anything outside the declared set is a destination that does not exist.
  test('refuses an intent it does not have', async () => {
    reply = says('launchRockets');
    expect(await routeIntent('なにか', true)).toBeNull();
  });

  test('carries the reason, so a wrong turn is readable', async () => {
    reply = says('ask', '件数を尋ねているため');
    const out = await routeIntent('ブロックは何件？', true);
    expect(out?.reason).toBe('件数を尋ねているため');
  });

  // Without this the user cannot tell a misroute from a feature that simply
  // does something else.
  test('always has a reason, even when the model omits one', async () => {
    reply = JSON.stringify({ intent: 'ask' });
    const out = await routeIntent('なにか', true);
    expect(out?.reason.length).toBeGreaterThan(0);
  });
});

describe('what it refuses to do', () => {
  // The whole point. The tabs still work; a shrug costs nothing, a confident
  // wrong answer costs trust.
  test('gives up rather than guessing when the answer is prose', async () => {
    reply = 'うーん、たぶん作りたいのだと思います';
    expect(await routeIntent('なにか', true)).toBeNull();
  });

  test('gives up when the model is unavailable', async () => {
    reply = new Error('補助AI機能は無効化されています (RAPITAS_AUX_AI=off)。');
    expect(await routeIntent('なにか', true)).toBeNull();
  });

  test('does not ask the model about an empty sentence', async () => {
    expect(await routeIntent('   ', true)).toBeNull();
    expect(sent).toEqual([]);
  });

  // "This task" is only a place to go when a task is open. Routing there
  // from the dashboard lands on a tab that is not in the bar.
  test('never sends you to the open task when none is open', async () => {
    reply = says('consult');
    expect(await routeIntent('このタスクを分析して', false)).toBeNull();
  });

  test('sends you there when one is open', async () => {
    reply = says('consult');
    const out = await routeIntent('このタスクを分析して', true);
    expect(out?.intent).toBe('consult');
  });
});

describe('what the model is told', () => {
  // It picks a destination. It does not answer, file, or delete anything —
  // the destination does that, with its own confirmation.
  test('is asked to route and nothing else', async () => {
    await routeIntent('なにか', true);
    expect(sent[0].systemPrompt).toContain('行き先');
    expect(sent[0].systemPrompt).not.toContain('削除してください');
  });

  test('is told whether the open-task destination exists', async () => {
    await routeIntent('なにか', false);
    expect(sent[0].content).toContain('タスクは開かれていません');
    sent = [];
    await routeIntent('なにか', true);
    expect(sent[0].content).toContain('タスクが開かれています');
  });

  test('is shown every destination it may choose', async () => {
    await routeIntent('なにか', true);
    for (const intent of ROUTABLE_INTENTS) {
      expect(sent[0].systemPrompt).toContain(intent);
    }
  });
});
