/**
 * roadmap-draft.profile.test
 *
 * The standing self-introduction reaching the plan.
 *
 * The interview opens by asking who you are — your situation, your
 * constraints — and asks again on the next roadmap. Asked for 2026-10-22:
 * say it once in the profile and have ラピ plan against it instead.
 *
 * What these tests hold down is that the profile is CONTEXT, not an
 * instruction: it has to reach the message, be labelled as standing
 * information, and be absent entirely when none is set — an empty heading
 * reads to a model as "this person has no situation", which is worse than
 * silence.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** What the model was handed. */
let sent: { systemPrompt?: string; content: string }[] = [];
/** The reply the stub returns. */
let reply = JSON.stringify({
  goal: '転職する',
  themeChoice: { kind: 'none', reason: '不要' },
  projectChoice: { kind: 'none', reason: '不要' },
  questions: [],
  steps: [{ title: '職務経歴書', description: '書く' }],
});
/** What the profile store reports. */
let profile: string | null = null;

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async (o: { systemPrompt?: string; messages: { content: string }[] }) => {
    sent.push({
      systemPrompt: o.systemPrompt,
      content: o.messages.map((m) => m.content).join('\n'),
    });
    return { content: reply, tokensUsed: 0 };
  },
}));

mock.module('../system/rapi-profile-store', () => ({
  MAX_RAPI_PROFILE_LENGTH: 1200,
  readRapiProfile: () => profile,
  writeRapiProfile: () => {},
}));

const { draftRoadmap } = await import('./roadmap-draft');

const WORLD = { themes: [], projects: [] };

beforeEach(() => {
  sent = [];
  profile = null;
});

describe('planning against who the user is', () => {
  test('puts the profile in the message when one is set', async () => {
    profile = '30代のソフトウェアエンジニア。toB SaaS 8年。平日夜と土日しか動けない。';
    await draftRoadmap('3ヶ月後までに転職したい', WORLD);
    expect(sent[0]?.content).toContain('toB SaaS 8年');
  });

  test('labels it as standing information rather than the request', async () => {
    // Unlabelled, the model reads the introduction as part of what was
    // asked for and plans a career summary instead of a job search.
    profile = '30代のソフトウェアエンジニア。';
    await draftRoadmap('3ヶ月後までに転職したい', WORLD);
    const message = sent[0]?.content ?? '';
    expect(message).toContain('この人について');
    expect(message.indexOf('この人について')).toBeLessThan(message.indexOf('やりたいこと'));
  });

  test('says nothing at all when no profile is set', async () => {
    await draftRoadmap('3ヶ月後までに転職したい', WORLD);
    expect(sent[0]?.content).not.toContain('この人について');
  });

  test('says nothing when the profile is only whitespace', async () => {
    profile = '   ';
    await draftRoadmap('3ヶ月後までに転職したい', WORLD);
    expect(sent[0]?.content).not.toContain('この人について');
  });

  test('tells the interview not to ask what the profile already answers', async () => {
    // Without this the profile is decorative: the model has the answer in
    // front of it and asks for it anyway, which is the complaint.
    profile = '30代のソフトウェアエンジニア。';
    await draftRoadmap('3ヶ月後までに転職したい', WORLD);
    expect(sent[0]?.systemPrompt).toContain('この人について');
  });

  test('carries the profile into the second round too', async () => {
    // The round that actually plans is the one that most needs to know the
    // constraints it is planning around.
    profile = '平日夜と土日しか動けない。';
    await draftRoadmap('3ヶ月後までに転職したい', WORLD, {
      answers: [{ question: '現職を続けますか', answer: '続ける' }],
    });
    expect(sent[0]?.content).toContain('平日夜と土日しか動けない');
  });
});
