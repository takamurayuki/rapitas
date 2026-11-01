/**
 * profile-interview.test
 *
 * Asking the user who they are, instead of handing them an empty box.
 *
 * The thing these tests exist to stop is the defect the roadmap interview
 * shipped with once: questions that are asked and then not used. There, the
 * plan had already been drafted by the time the user answered, so whatever
 * was picked, the same tasks came out. Here the equivalent failure is a
 * drafted introduction that reads the same whatever was chosen — so the
 * first thing held down is that every answer is in the request that writes
 * the text, and that a second round is handed the first round's answers.
 *
 * The rest is about not believing the model: a question with one option is
 * not a choice, a half the model left blank must not come back as empty text
 * that would overwrite what the user wrote, and nothing usable must be
 * reported as nothing rather than as an introduction.
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

// The profile lives on a UserSettings row since #1275, so importing the
// store for its length bound would reach for Postgres. This module only
// needs the number, and what the number applies to is tested here.
mock.module('../system/rapi-profile-store', () => ({
  MAX_RAPI_PROFILE_LENGTH: 1200,
  readRapiProfile: async () => null,
  writeRapiProfile: async () => {},
  readRapiCharacter: async () => null,
  writeRapiCharacter: async () => {},
}));

const { askProfileQuestions, composeProfile, MAX_PROFILE_QUESTIONS, MAX_PROFILE_ROUNDS } =
  await import('./profile-interview');

const QUESTION = {
  question: '普段どんな仕事をしていますか',
  options: ['エンジニア', '企画・営業', '経営・自営', '学生'],
  recommended: 'エンジニア',
  recommendedReason: '一番多いためです',
};

const asks = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({ questions: [QUESTION], ...patch });

const ANSWERED = [
  { question: '普段どんな仕事をしていますか', answer: 'エンジニア' },
  { question: 'まとまった時間が取れるのは', answer: '土日だけ' },
];

const DRAFT = {
  profile: '30代のソフトウェアエンジニア。平日は夜のみ、土日はまとまった時間が取れる。',
  character: '納得してから動きたい。小さく試して確かめる方が性に合う。',
};

beforeEach(() => {
  sent = [];
  reply = asks();
});

describe('the first round', () => {
  test('asks without pretending it has been answered', async () => {
    await askProfileQuestions({});
    expect(sent).toHaveLength(1);
    // The word is what tells the model — and this test — which round it is.
    expect(sent[0].content).not.toContain('回答');
  });

  test('returns the question with its options, recommendation and reason', async () => {
    const questions = await askProfileQuestions({});
    expect(questions).toEqual([QUESTION]);
  });

  test('drops a question that is not a choice', async () => {
    reply = asks({
      questions: [{ question: 'どんな仕事ですか', options: ['エンジニア'] }, QUESTION],
    });
    expect(await askProfileQuestions({})).toEqual([QUESTION]);
  });

  test('asks at most MAX_PROFILE_QUESTIONS at a time', async () => {
    reply = asks({
      questions: Array.from({ length: MAX_PROFILE_QUESTIONS + 3 }, (_, i) => ({
        ...QUESTION,
        question: `質問${i}`,
      })),
    });
    const questions = await askProfileQuestions({});
    expect(questions).toHaveLength(MAX_PROFILE_QUESTIONS);
  });

  test('says nothing came back rather than asking nothing', async () => {
    reply = new Error('ollama is not running');
    expect(await askProfileQuestions({})).toBeNull();
  });

  test('an empty list is an answer: there is nothing left to ask', async () => {
    reply = asks({ questions: [] });
    expect(await askProfileQuestions({})).toEqual([]);
  });
});

describe('going deeper', () => {
  test('hands back every answer, question and answer together', async () => {
    await askProfileQuestions({ answers: ANSWERED });
    const content = sent[0].content;
    for (const a of ANSWERED) {
      expect(content).toContain(a.question);
      expect(content).toContain(a.answer);
    }
  });

  test('the deeper round is told it is one', async () => {
    await askProfileQuestions({ answers: ANSWERED });
    const deeper = sent[0];
    sent = [];
    await askProfileQuestions({});
    expect(deeper.systemPrompt).not.toBe(sent[0].systemPrompt);
  });

  test('what the introduction already says is in front of her', async () => {
    await askProfileQuestions({ profile: '医療事務を10年', character: '締切があると動ける' });
    expect(sent[0].content).toContain('医療事務を10年');
    expect(sent[0].content).toContain('締切があると動ける');
  });

  test('a round limit exists, so this cannot go on forever', () => {
    expect(MAX_PROFILE_ROUNDS).toBeGreaterThan(1);
    expect(MAX_PROFILE_ROUNDS * MAX_PROFILE_QUESTIONS).toBeLessThanOrEqual(24);
  });
});

describe('the introduction she drafts', () => {
  const compose = (over: Record<string, unknown> = {}) =>
    composeProfile({ answers: ANSWERED, ...over });

  beforeEach(() => {
    reply = JSON.stringify(DRAFT);
  });

  test('carries every answer into the request that writes it', async () => {
    await compose();
    const content = sent[0].content;
    for (const a of ANSWERED) {
      expect(content).toContain(a.question);
      expect(content).toContain(a.answer);
    }
  });

  test('returns both halves', async () => {
    expect(await compose()).toEqual(DRAFT);
  });

  test('writes nothing from no answers, and does not even ask', async () => {
    expect(await composeProfile({ answers: [] })).toBeNull();
    expect(sent).toHaveLength(0);
  });

  test('a half the model left out stays out, rather than coming back empty', async () => {
    // An empty string here is the dangerous value: applied to the card it
    // would clear a paragraph the user wrote by hand.
    reply = JSON.stringify({ profile: DRAFT.profile, character: '   ' });
    expect(await compose()).toEqual({ profile: DRAFT.profile });
  });

  test('neither half means nothing came back', async () => {
    reply = JSON.stringify({ profile: '', character: '' });
    expect(await compose()).toBeNull();
  });

  test('nothing usable is reported as nothing', async () => {
    reply = 'すみません、よく分かりませんでした';
    expect(await compose()).toBeNull();
  });

  test('bounds each half to what the card will store', async () => {
    reply = JSON.stringify({ profile: 'あ'.repeat(2000), character: 'い'.repeat(2000) });
    const drafted = await compose();
    expect(drafted?.profile).toHaveLength(1200);
    expect(drafted?.character).toHaveLength(1200);
  });

  test('what the user already wrote is the ground she builds on', async () => {
    await compose({ profile: '医療事務を10年', character: '締切があると動ける' });
    expect(sent[0].content).toContain('医療事務を10年');
    expect(sent[0].content).toContain('締切があると動ける');
  });
});
