/**
 * roadmap-draft.test
 *
 * Turning "I want to do X" into a plan, before anything is written.
 *
 * This half writes nothing at all, which is what lets a model shape the
 * whole thing: the worst a bad draft does is waste the reader's attention,
 * and they see every part of it before a second, confirmed call creates
 * anything. So the tests are about not believing the model — an invented
 * theme id, a project that does not exist, a step with no title — and about
 * the parts the request explicitly asked for: a quantitative description per
 * step, and the questions it needs answered in one round rather than a
 * conversation.
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

// The profile ラピ plans against lives on a UserSettings row since #1275, so
// reaching for it here would mean reaching for Postgres. These tests are
// about the prompt, not the profile: see roadmap-draft.profile.test.ts for
// the profile reaching the message.
mock.module('../system/rapi-profile-store', () => ({
  MAX_RAPI_PROFILE_LENGTH: 1200,
  readRapiProfile: async () => null,
  writeRapiProfile: async () => {},
  readRapiCharacter: async () => null,
  writeRapiCharacter: async () => {},
}));

const { draftRoadmap, MAX_ROADMAP_STEPS, MAX_ROADMAP_QUESTIONS } = await import('./roadmap-draft');

const THEMES = [
  { id: 1, name: 'rapitas', description: 'the app itself' },
  { id: 36, name: '健康', description: null },
];
const PROJECTS = [{ id: 7, name: '自己開発', description: null }];

/** A well-formed answer, which each test then spoils in one specific way. */
const GOOD = {
  goal: 'ラピを万能エージェントにする',
  themeChoice: { kind: 'existing', id: 1 },
  projectChoice: { kind: 'existing', id: 7 },
  questions: [
    {
      question: 'どこまでを今回の範囲にしますか',
      options: ['読み取りだけ', '操作まで'],
      recommended: '読み取りだけ',
      recommendedReason: '判断の当たり外れを先に測れるため',
    },
  ],
  steps: [
    { title: '監督の目を作る', description: '5分類をSQLで集約し、1エンドポイントで返す' },
    { title: '介入の手を足す', description: '1タスクへの操作4種を確認付きで' },
  ],
};

const says = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...GOOD, ...patch });

const draft = () => draftRoadmap('ラピを万能にしたい', { themes: THEMES, projects: PROJECTS });

beforeEach(() => {
  sent = [];
  reply = says();
});

describe('the plan it comes back with', () => {
  test('restates the goal, so a misread is visible before anything is built', async () => {
    const out = await draft();
    expect(out?.goal).toBe('ラピを万能エージェントにする');
  });

  test('breaks the goal into steps that each become a task', async () => {
    const out = await draft();
    expect(out?.steps).toHaveLength(2);
    expect(out?.steps[0].title).toBe('監督の目を作る');
  });

  // Asked for explicitly: the description says how much, not just what.
  test('asks for a description on every step', async () => {
    const out = await draft();
    expect(out?.steps.every((s) => s.description.length > 0)).toBe(true);
  });

  // A step with nothing to call it cannot become a task.
  test('drops a step with no title rather than filing a blank one', async () => {
    reply = says({
      steps: [{ title: '', description: 'x' }, GOOD.steps[0]],
    });
    const out = await draft();
    expect(out?.steps).toHaveLength(1);
    expect(out?.steps[0].title).toBe('監督の目を作る');
  });

  test('gives up when every step was unusable', async () => {
    reply = says({ steps: [{ title: '  ', description: '' }] });
    expect(await draft()).toBeNull();
  });

  test('caps how many steps one answer can propose', async () => {
    reply = says({
      steps: Array.from({ length: MAX_ROADMAP_STEPS + 12 }, (_, i) => ({
        title: `step ${i}`,
        description: 'd',
      })),
    });
    const out = await draft();
    expect(out?.steps).toHaveLength(MAX_ROADMAP_STEPS);
  });
});

describe('where it proposes to put the work', () => {
  test('uses an existing theme when it names a real one', async () => {
    const out = await draft();
    expect(out?.themeChoice).toEqual({ kind: 'existing', id: 1, name: 'rapitas' });
  });

  // The model inventing an id would otherwise file tasks into nothing.
  test('treats an invented theme id as a new theme rather than a real one', async () => {
    reply = says({ themeChoice: { kind: 'existing', id: 999 } });
    const out = await draft();
    expect(out?.themeChoice.kind).toBe('new');
  });

  test('proposes a new theme by name when it says so', async () => {
    reply = says({ themeChoice: { kind: 'new', name: '語学', reason: '既存に当てはまらない' } });
    const out = await draft();
    expect(out?.themeChoice).toMatchObject({ kind: 'new', name: '語学' });
  });

  // Themes and projects are two independent groupings of a task, not a
  // hierarchy — a task carries themeId and projectId side by side — so the
  // project can be left out entirely.
  test('allows no project at all', async () => {
    reply = says({ projectChoice: { kind: 'none', reason: 'まとまりとしては小さい' } });
    const out = await draft();
    expect(out?.projectChoice.kind).toBe('none');
  });

  test('treats an invented project id as none rather than a real one', async () => {
    reply = says({ projectChoice: { kind: 'existing', id: 404 } });
    const out = await draft();
    expect(out?.projectChoice.kind).not.toBe('existing');
  });
});

describe('what it needs answered', () => {
  // One round, not a conversation: everything it needs, asked at once.
  test('carries the questions with their choices', async () => {
    const out = await draft();
    expect(out?.questions[0].options).toEqual(['読み取りだけ', '操作まで']);
  });

  // The house rule for questions, and the reason it exists: a choice with no
  // recommendation hands the decision back without helping make it.
  test('keeps a recommendation and its reason', async () => {
    const out = await draft();
    expect(out?.questions[0].recommended).toBe('読み取りだけ');
    expect(out?.questions[0].recommendedReason).toContain('測れる');
  });

  test('drops a question that offers nothing to choose between', async () => {
    reply = says({ questions: [{ question: 'どう？', options: [] }, GOOD.questions[0]] });
    const out = await draft();
    expect(out?.questions).toHaveLength(1);
  });

  test('caps how many it may ask in one round', async () => {
    reply = says({
      questions: Array.from({ length: MAX_ROADMAP_QUESTIONS + 5 }, (_, i) => ({
        question: `q${i}`,
        options: ['a', 'b'],
      })),
    });
    const out = await draft();
    expect(out?.questions).toHaveLength(MAX_ROADMAP_QUESTIONS);
  });

  test('is fine with no questions when nothing is unclear', async () => {
    reply = says({ questions: [] });
    const out = await draft();
    expect(out?.questions).toEqual([]);
  });
});

describe('what it will not do', () => {
  test('gives up rather than guessing when the answer is prose', async () => {
    reply = 'まずテーマを作って、それから…';
    expect(await draft()).toBeNull();
  });

  test('gives up when the model is unavailable', async () => {
    reply = new Error('補助AI機能は無効化されています (RAPITAS_AUX_AI=off)。');
    expect(await draft()).toBeNull();
  });

  test('does not ask the model about an empty request', async () => {
    expect(await draftRoadmap('   ', { themes: THEMES, projects: PROJECTS })).toBeNull();
    expect(sent).toEqual([]);
  });

  // It plans; a second, confirmed call creates. Saying so in the prompt is
  // what keeps the two halves from blurring.
  test('is told it is only drafting', async () => {
    await draft();
    expect(sent[0].systemPrompt).toContain('作成はしません');
  });

  test('is shown what already exists, so it can reuse rather than duplicate', async () => {
    await draft();
    expect(sent[0].content).toContain('rapitas');
    expect(sent[0].content).toContain('自己開発');
  });
});
