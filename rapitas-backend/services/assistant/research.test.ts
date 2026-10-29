/**
 * research.test
 *
 * Not believing a candidate that nobody can check.
 *
 * This is the one thing ラピ does with the network switched on, and the
 * whole risk is that a made-up company is indistinguishable on screen from
 * a found one. So the tests are about the line between them: no source, no
 * candidate; a value the search did not establish stays empty rather than
 * becoming a plausible number; and the axes nothing was found for are named
 * rather than quietly dropped.
 *
 * The prompt itself can only be judged against the real model — these hold
 * the wiring and the filtering, which is where a bad answer gets stopped.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

let reply: string | Error = '{}';
let sent: { systemPrompt?: string; content: string; tools?: string; timeoutMs?: number }[] = [];

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async (o: {
    systemPrompt?: string;
    messages: { content: string }[];
    tools?: string;
    timeoutMs?: number;
  }) => {
    sent.push({
      systemPrompt: o.systemPrompt,
      content: o.messages.map((m) => m.content).join('\n'),
      tools: o.tools,
      timeoutMs: o.timeoutMs,
    });
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

const { researchCandidates, MAX_CANDIDATES, RESEARCH_TIMEOUT_MS } = await import('./research');

const AXES = ['年収', '技術スタック', '働き方'];

const found = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    query: '自社開発 Web系 求人',
    candidates: [
      {
        name: 'A社',
        sourceUrl: 'https://example.com/a',
        values: { 年収: '600〜800万', 技術スタック: 'TypeScript / Go' },
        why: '自社開発でWeb系',
      },
    ],
    unresolvedAxes: [],
    ...patch,
  });

const run = (axes: string[] = AXES) =>
  researchCandidates({ goal: 'SESから自社開発のWeb系に転職する', axes });

beforeEach(() => {
  sent = [];
  reply = found();
});

describe('how the call is made', () => {
  test('asks for the web, which nothing else here is allowed', async () => {
    await run();
    expect(sent[0]?.tools).toBe('web');
  });

  test('gives itself longer than a text call gets', async () => {
    // Searching is several round-trips; the 120s default is for one.
    await run();
    expect(sent[0]?.timeoutMs).toBe(RESEARCH_TIMEOUT_MS);
  });

  test('tells it what to compare on', async () => {
    await run();
    expect(sent[0]?.content).toContain('年収');
    expect(sent[0]?.content).toContain('技術スタック');
  });

  test('does not search at all without axes to fill', async () => {
    expect(await researchCandidates({ goal: 'なにか', axes: [] })).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('what it will not pass on', () => {
  test('drops a candidate with no source', async () => {
    // The failure this whole feature has to avoid: on screen it looks
    // exactly like a researched one.
    reply = found({
      candidates: [{ name: 'どこかの会社', values: { 年収: '1000万' }, why: 'よさそう' }],
    });
    const result = await run();
    expect(result?.candidates).toEqual([]);
  });

  test('drops a source that is not a real address', async () => {
    reply = found({
      candidates: [{ name: 'B社', sourceUrl: '検索結果より', values: {}, why: '' }],
    });
    expect((await run())?.candidates).toEqual([]);
  });

  test('keeps only the axes that were asked about', async () => {
    reply = found({
      candidates: [
        {
          name: 'C社',
          sourceUrl: 'https://example.com/c',
          values: { 年収: '700万', 社長の出身地: '東京' },
          why: '',
        },
      ],
    });
    const values = (await run())?.candidates[0]?.values ?? {};
    expect(Object.keys(values)).toEqual(['年収']);
  });

  test('holds the list to a shortlist', async () => {
    reply = found({
      candidates: Array.from({ length: MAX_CANDIDATES + 4 }, (_, i) => ({
        name: `会社${i}`,
        sourceUrl: `https://example.com/${i}`,
        values: { 年収: '600万' },
        why: '',
      })),
    });
    expect((await run())?.candidates).toHaveLength(MAX_CANDIDATES);
  });

  test('says nothing rather than something when the call fails', async () => {
    reply = new Error('CLI unavailable');
    expect(await run()).toBeNull();
  });

  test('says nothing when the answer is not JSON at all', async () => {
    reply = '検索してみましたが、よく分かりませんでした。';
    expect(await run()).toBeNull();
  });
});

describe('the axes nothing was found for', () => {
  test('are worked out from the cells, not taken on trust', async () => {
    // Claiming everything is resolved while filling one cell is exactly
    // what would put empty columns into a note as if they were checked.
    reply = found({ unresolvedAxes: [] });
    expect((await run())?.unresolvedAxes).toEqual(['働き方']);
  });

  test('are all of them when nothing was found at all', async () => {
    reply = found({ candidates: [] });
    expect((await run())?.unresolvedAxes).toEqual(AXES);
  });

  test('are none when every axis was filled by someone', async () => {
    reply = found({
      candidates: [
        {
          name: 'D社',
          sourceUrl: 'https://example.com/d',
          values: { 年収: '700万', 技術スタック: 'Go', 働き方: 'フルリモート' },
          why: '',
        },
      ],
    });
    expect((await run())?.unresolvedAxes).toEqual([]);
  });
});
