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
/** What the character half reports. */
let character: string | null = null;

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
  readRapiCharacter: () => character,
  writeRapiCharacter: () => {},
}));

const { draftRoadmap } = await import('./roadmap-draft');

const WORLD = { themes: [], projects: [] };

beforeEach(() => {
  sent = [];
  profile = null;
  character = null;
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

describe('planning around what the person actually wants', () => {
  /**
   * The facts say what is feasible; the character says what is right.
   *
   * A plan built only from constraints is a plan that could be executed by
   * anyone with those constraints. Asked for 2026-10-22: ラピ should
   * understand the essence of what the person wants, which is the half the
   * interview never reaches.
   */
  test('puts the character notes in the message', async () => {
    character = '納得してから動きたい。人数の多い場が苦手。';
    await draftRoadmap('3ヶ月後までに転職したい', WORLD);
    expect(sent[0]?.content).toContain('人数の多い場が苦手');
  });

  test('labels them apart from the facts', async () => {
    // Merged into one block they read as more constraints, and a
    // preference becomes a requirement.
    profile = 'エンジニア8年';
    character = '納得してから動きたい';
    await draftRoadmap('転職したい', WORLD);
    const message = sent[0]?.content ?? '';
    expect(message).toContain('この人について');
    expect(message).toContain('この人の進め方・価値観');
  });

  test('says nothing when none are written', async () => {
    await draftRoadmap('転職したい', WORLD);
    expect(sent[0]?.content).not.toContain('この人の進め方・価値観');
  });

  test('carries them into the round that plans', async () => {
    character = '納得してから動きたい';
    await draftRoadmap('転職したい', WORLD, {
      answers: [{ question: '現職を続けますか', answer: '続ける' }],
    });
    expect(sent[0]?.content).toContain('納得してから動きたい');
  });

  test('stands on its own when only the character half is written', async () => {
    // Someone may never fill in the facts. The half they did write still
    // has to reach the model.
    character = '納得してから動きたい';
    await draftRoadmap('転職したい', WORLD);
    expect(sent[0]?.content).toContain('この人の進め方・価値観');
    expect(sent[0]?.content).not.toContain('この人について（');
  });
});
