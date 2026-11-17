/**
 * idea-tidy-judgement.test
 *
 * The rules found nothing in the real idea box (2026-11-17): 92 ideas, the
 * most similar pair at 0.27, all under two weeks old and mostly high
 * priority. The overlap was in meaning (several バトン受け渡し ideas, two
 * honeypot ideas), which only a reading catches. So ラピ can ask the model —
 * and, as everywhere she proposes, nothing it names is believed unless it
 * was in the window it was shown.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test';

let reply: string | Error = '{}';
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async () => {
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

const { judgeIdeaTidy } = await import('./idea-tidy-judgement');

const ideas = [
  {
    id: 1,
    title: '定位音によるバトン受け渡しの通知',
    content: '音で知らせる',
    priority: 'high' as const,
  },
  {
    id: 2,
    title: 'バトン受け渡し連動の集中サウンド',
    content: '音を切り替える',
    priority: 'high' as const,
  },
  { id: 3, title: '囮の練習譜面', content: 'ハニーポット', priority: 'high' as const },
  {
    id: 4,
    title: '囮バトンによる持ち出し検知',
    content: 'ハニーポット',
    priority: 'medium' as const,
  },
  { id: 5, title: 'なんとなく便利にする', content: '', priority: 'low' as const },
];

beforeEach(() => {
  reply = '{}';
});

describe('asking the model to tidy ideas', () => {
  test('groups of the same idea and ideas to put away come back with reasons', async () => {
    reply = JSON.stringify({
      groups: [{ ids: [1, 2], keepId: 1, reason: 'どちらも受け渡しを音で伝える案' }],
      unneeded: [{ id: 5, reason: '中身が無く行動に移せない' }],
      unclear: [],
    });
    const plan = await judgeIdeaTidy(ideas);
    expect(plan?.duplicates).toEqual([
      {
        keepId: 1,
        reason: 'どちらも受け渡しを音で伝える案',
        ideas: [
          { id: 1, title: '定位音によるバトン受け渡しの通知', priority: 'high' },
          { id: 2, title: 'バトン受け渡し連動の集中サウンド', priority: 'high' },
        ],
      },
    ]);
    expect(plan?.unneeded).toEqual([
      { id: 5, title: 'なんとなく便利にする', reason: 'judged', note: '中身が無く行動に移せない' },
    ]);
    expect(plan?.considered).toBe(5);
  });

  test('ids it was not shown are dropped, and a group left with one idea is no group', async () => {
    reply = JSON.stringify({
      groups: [
        { ids: [3, 99], keepId: 99, reason: 'x' },
        { ids: [3, 4], keepId: 77, reason: '同じ囮の発想' },
      ],
      unneeded: [
        { id: 42, reason: 'x' },
        { id: 4, reason: '重複' },
      ],
    });
    const plan = await judgeIdeaTidy(ideas);
    // keepId outside the group falls back to its first idea; 4 is grouped, so not offered twice.
    expect(plan?.duplicates.map((g) => [g.keepId, g.ideas.map((i) => i.id)])).toEqual([
      [3, [3, 4]],
    ]);
    expect(plan?.unneeded).toEqual([]);
  });

  test('no usable answer is null, not an empty proposal', async () => {
    reply = 'うまく考えられませんでした';
    expect(await judgeIdeaTidy(ideas)).toBeNull();
    reply = new Error('offline');
    expect(await judgeIdeaTidy(ideas)).toBeNull();
  });
});
