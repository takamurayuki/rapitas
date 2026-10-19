/**
 * intent-reader.test
 *
 * Reading intent means the model decides, which means the model can be wrong
 * or absent. These tests are mostly about the second half of that sentence:
 * what happens to a theme id that does not exist, to prose instead of JSON,
 * and to the aux AI being switched off entirely.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** What the fake model answers next, or the error it throws. */
let reply: string | Error = '{}';
/** The requests the reader made. */
let sent: { systemPrompt?: string; content: string }[] = [];

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async (options: {
    systemPrompt?: string;
    messages: { role: string; content: string }[];
  }) => {
    sent.push({
      systemPrompt: options.systemPrompt,
      content: options.messages.map((m) => m.content).join('\n'),
    });
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

const { readTaskIntent } = await import('./intent-reader');

const THEMES = [
  { id: 1, name: 'rapitas', description: 'このアプリ自体の開発' },
  { id: 2, name: 'TOEICの資格勉強', description: null },
  { id: 36, name: '健康', description: null },
];

/** A well-formed answer, as the model is asked to produce. */
const GOOD = JSON.stringify({
  title: 'アバターの吹き出しが長文で崩れる問題を修正',
  summary: '吹き出しが長い文章で折り返されず崩れる',
  themeId: 1,
  themeReason: 'アバターは rapitas 本体の機能のため',
  priority: 'high',
  dueDate: null,
  estimatedHours: 2,
  acceptanceCriteria: ['長文でも吹き出しの幅を超えない'],
  unclear: [],
});

beforeEach(() => {
  sent = [];
  reply = GOOD;
});

describe('reading the intent', () => {
  test('returns the model own reading, not a keyword match', async () => {
    const draft = await readTaskIntent('アバターの吹き出しが長文だと崩れる', THEMES);
    expect(draft?.title).toBe('アバターの吹き出しが長文で崩れる問題を修正');
    expect(draft?.themeId).toBe(1);
    expect(draft?.themeReason).toBe('アバターは rapitas 本体の機能のため');
  });

  // The whole complaint about the previous version: the theme was only found
  // when its name appeared in the text.
  test('can choose a theme whose name was never said', async () => {
    const draft = await readTaskIntent('アバターの吹き出しが長文だと崩れる', THEMES);
    expect(draft?.themeId).toBe(1);
  });

  test('is given the themes to choose from, with what they are for', async () => {
    await readTaskIntent('なにか', THEMES);
    const prompt = sent[0].content;
    expect(prompt).toContain('rapitas');
    expect(prompt).toContain('このアプリ自体の開発');
    expect(prompt).toContain('36');
  });

  test('carries the acceptance criteria it drafted', async () => {
    const draft = await readTaskIntent('アバターを直して', THEMES);
    expect(draft?.acceptanceCriteria).toEqual(['長文でも吹き出しの幅を超えない']);
  });

  test('keeps the original utterance, so nothing said is lost', async () => {
    const draft = await readTaskIntent('アバターの吹き出しが長文だと崩れる', THEMES);
    expect(draft?.description).toContain('アバターの吹き出しが長文だと崩れる');
  });
});

describe('when the model answers badly', () => {
  // A hallucinated id would otherwise file the task under a theme that does
  // not exist, or worse, someone else's.
  test('drops a theme id that is not in the list', async () => {
    reply = JSON.stringify({ ...JSON.parse(GOOD), themeId: 999 });
    const draft = await readTaskIntent('なにか', THEMES);
    expect(draft?.themeId).toBeUndefined();
    expect(draft?.missing).toContain('theme');
  });

  test('drops a priority outside the allowed set', async () => {
    reply = JSON.stringify({ ...JSON.parse(GOOD), priority: 'すごく急ぎ' });
    const draft = await readTaskIntent('なにか', THEMES);
    expect(draft?.priority).toBeUndefined();
  });

  test('drops an estimate that is not a positive number', async () => {
    reply = JSON.stringify({ ...JSON.parse(GOOD), estimatedHours: -3 });
    const draft = await readTaskIntent('なにか', THEMES);
    expect(draft?.estimatedHours).toBeUndefined();
  });

  test('drops a date it cannot parse', async () => {
    reply = JSON.stringify({ ...JSON.parse(GOOD), dueDate: 'いつか' });
    const draft = await readTaskIntent('なにか', THEMES);
    expect(draft?.dueDate).toBeUndefined();
  });

  test('finds the JSON even when the model wraps it in prose or a fence', async () => {
    reply = 'はい、こちらです:\n```json\n' + GOOD + '\n```\nご確認ください。';
    const draft = await readTaskIntent('なにか', THEMES);
    expect(draft?.title).toBe('アバターの吹き出しが長文で崩れる問題を修正');
  });

  test('gives up rather than guessing when there is no JSON at all', async () => {
    reply = 'すみません、よく分かりませんでした。';
    expect(await readTaskIntent('なにか', THEMES)).toBeNull();
  });

  test('gives up when there is no usable title', async () => {
    reply = JSON.stringify({ ...JSON.parse(GOOD), title: '   ' });
    expect(await readTaskIntent('なにか', THEMES)).toBeNull();
  });
});

describe('when the model is unavailable', () => {
  // RAPITAS_AUX_AI=off, no provider configured, CLI slot exhausted — all of
  // these throw, and none of them should take the feature down with them.
  test('returns null rather than throwing, so the caller can fall back', async () => {
    reply = new Error('補助AI機能は無効化されています (RAPITAS_AUX_AI=off)。');
    expect(await readTaskIntent('なにか', THEMES)).toBeNull();
  });
});
