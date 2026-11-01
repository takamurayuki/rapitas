/**
 * assistant-profile.routes.test
 *
 * The interview that fills in the self-introduction.
 *
 * Two properties are worth the test. The first is that the round is asked
 * against what is already known — the card's current text when it sends it,
 * the stored row when it does not — because re-asking what the user already
 * wrote is the complaint the profile exists to answer.
 *
 * The second is that none of what they say about themselves lands in the
 * audit log. These answers are a person's job, hours, money and health; the
 * log is a record of acts, and it only needs to know a round happened and
 * how big it was.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** What the stand-in model answers. */
let modelReply: string | Error = JSON.stringify({ questions: [] });
/** What the model was last asked. */
let asked: string[] = [];
/** Audit rows written. */
let audited: Record<string, unknown>[] = [];
/** What the stored settings row holds. */
let storedProfile: string | null = null;
let storedCharacter: string | null = null;

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async (o: { messages: { content: string }[] }) => {
    asked.push(o.messages.map((m) => m.content).join('\n'));
    if (modelReply instanceof Error) throw modelReply;
    return { content: modelReply, tokensUsed: 0 };
  },
}));

mock.module('../../services/system/rapi-profile-store', () => ({
  MAX_RAPI_PROFILE_LENGTH: 1200,
  readRapiProfile: async () => storedProfile,
  readRapiCharacter: async () => storedCharacter,
  writeRapiProfile: async () => {},
  writeRapiCharacter: async () => {},
}));

mock.module('../../config/database', () => ({
  prisma: {
    assistantAction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audited.push(data);
        return { id: audited.length };
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));

const { assistantProfileRoutes } = await import('./assistant-profile.routes');
const { MAX_PROFILE_ROUNDS } = await import('../../services/assistant/profile-interview');

const post = async (path: string, body: unknown) => {
  const res = await assistantProfileRoutes.handle(
    new Request(`http://localhost/assistant/profile/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: res.status,
    json: (await res.json().catch(() => null)) as Record<string, never>,
  };
};

const QUESTION = {
  question: '普段どんな仕事をしていますか',
  options: ['エンジニア', '企画・営業', '経営・自営', '学生'],
  recommended: 'エンジニア',
  recommendedReason: '一番多いためです',
};

const ANSWERED = [{ question: '普段どんな仕事をしていますか', answer: 'エンジニア' }];

beforeEach(() => {
  asked = [];
  audited = [];
  storedProfile = null;
  storedCharacter = null;
  modelReply = JSON.stringify({ questions: [QUESTION] });
});

describe('asking the next round', () => {
  test('answers with the questions ラピ asked', async () => {
    const { status, json } = await post('questions', {});
    expect(status).toBe(200);
    expect(json).toEqual({
      success: true,
      available: true,
      questions: [QUESTION],
      // The card offers another round off this, so it has to come back.
      maxRounds: MAX_PROFILE_ROUNDS,
    });
  });

  test('says ラピ could not be reached rather than asking nothing', async () => {
    modelReply = new Error('ollama is not running');
    const { json } = await post('questions', {});
    expect(json).toEqual({ success: true, available: false });
  });

  test('an empty round is available with nothing left to ask', async () => {
    modelReply = JSON.stringify({ questions: [] });
    const { json } = await post('questions', {});
    expect(json).toEqual({
      success: true,
      available: true,
      questions: [],
      maxRounds: MAX_PROFILE_ROUNDS,
    });
  });

  test('falls back to the stored introduction when the caller sends none', async () => {
    storedProfile = '医療事務を10年';
    storedCharacter = '締切があると動ける';
    await post('questions', {});
    expect(asked[0]).toContain('医療事務を10年');
    expect(asked[0]).toContain('締切があると動ける');
  });

  test('what is on screen wins over what is stored', async () => {
    // The card is sending its current text, unsaved edits and all. Asking
    // against the row instead would ask about a paragraph the user has just
    // rewritten.
    storedProfile = '医療事務を10年';
    await post('questions', { profile: '去年から訪問看護に移った' });
    expect(asked[0]).toContain('去年から訪問看護に移った');
    expect(asked[0]).not.toContain('医療事務を10年');
  });

  test('an emptied box is an answer too, not a reason to read the row', async () => {
    storedProfile = '医療事務を10年';
    await post('questions', { profile: '' });
    expect(asked[0]).not.toContain('医療事務を10年');
  });

  test('refuses more answers than the interview can produce', async () => {
    const tooMany = Array.from({ length: 40 }, (_, i) => ({
      question: `質問${i}`,
      answer: 'はい',
    }));
    const { status } = await post('questions', { answers: tooMany });
    expect(status).toBe(422);
  });
});

describe('writing it up', () => {
  const DRAFT = {
    profile: '30代のエンジニア。土日はまとまった時間が取れる。',
    character: '納得してから動きたい。',
  };

  beforeEach(() => {
    modelReply = JSON.stringify(DRAFT);
  });

  test('answers with the draft, for the user to apply', async () => {
    const { status, json } = await post('compose', { answers: ANSWERED });
    expect(status).toBe(200);
    expect(json).toEqual({ success: true, available: true, draft: DRAFT });
  });

  test('refuses to write from no answers at all', async () => {
    const { status } = await post('compose', { answers: [] });
    expect(status).toBe(422);
  });

  test('says so when nothing usable came back', async () => {
    modelReply = 'すみません、よく分かりませんでした';
    const { json } = await post('compose', { answers: ANSWERED });
    expect(json).toEqual({ success: true, available: false });
  });
});

describe('the audit log', () => {
  test('records that a round happened, and how big', async () => {
    await post('questions', { answers: ANSWERED });
    expect(audited).toHaveLength(1);
    expect(audited[0].capabilityId).toBe('profile.interview');
    expect(audited[0].status).toBe('executed');
  });

  test('records the write-up under its own capability', async () => {
    modelReply = JSON.stringify({ profile: '30代のエンジニア。' });
    await post('compose', { answers: ANSWERED });
    expect(audited[0].capabilityId).toBe('profile.draft');
  });

  test('keeps what the person said about themselves out of it', async () => {
    storedProfile = '持病があり通院している';
    modelReply = JSON.stringify({ profile: '30代のエンジニア。' });
    await post('compose', {
      answers: [{ question: '通院はありますか', answer: '月に一度ある' }],
      character: '人数の多い場は消耗する',
    });
    const row = JSON.stringify(audited[0]);
    expect(row).not.toContain('月に一度ある');
    expect(row).not.toContain('通院');
    expect(row).not.toContain('人数の多い場は消耗する');
    expect(row).not.toContain('30代のエンジニア');
  });
});
