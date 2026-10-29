/**
 * roadmap-interview.test
 *
 * The second round: what she does with the answers she asked for.
 *
 * The first version of this flow asked good questions and then ignored them
 * — the plan was drafted before the user had answered anything, and the
 * answers only ever reached the closing note. Whatever was picked, the same
 * tasks were created. So the first thing these tests hold is that an answer
 * reaches the model at all, and that the plan which comes back is allowed to
 * replace the provisional one.
 *
 * The rest is about the shape the request asked for: a description someone
 * can act on without re-reading the goal (what to do, and what counts as
 * done), and dates when a deadline was named. Day counts are asked of the
 * model rather than dates, because arithmetic on calendars is the part it
 * gets wrong; turning a count into a date is this module's job and is
 * testable without a model.
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

const { draftRoadmap, composeDescription, MAX_ROADMAP_QUESTIONS } = await import('./roadmap-draft');

const WORLD = { themes: [{ id: 1, name: 'rapitas', description: null }], projects: [] };

/** A fixed "today", so a date assertion means the same thing every day. */
const TODAY = new Date('2026-10-21T00:00:00Z');

const PLAN = {
  goal: 'SESから自社開発のWeb系に転職する',
  themeChoice: { kind: 'new', name: '転職活動', reason: '既存のどれでもないため' },
  projectChoice: { kind: 'none', reason: '単発のため' },
  questions: [],
  steps: [
    {
      title: '職務経歴書を作る',
      action: '直近3社分の実績を数値付きで書く',
      done: ['A4 1枚', '第三者レビュー済み'],
    },
  ],
};

const says = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...PLAN, ...patch });

const ANSWERED = [
  { question: '現職を続けながら活動しますか', answer: '現職を続けながら活動する' },
  { question: '応募の目安は', answer: '15社程度・質重視' },
];

const refine = (patch: Record<string, unknown> = {}) => {
  reply = says(patch);
  return draftRoadmap('3ヶ月後までに転職したい', WORLD, {
    answers: ANSWERED,
    today: TODAY,
  });
};

beforeEach(() => {
  sent = [];
  reply = says();
});

describe('the answers she asked for', () => {
  test('reach the model, question and answer together', async () => {
    await refine();
    const asked = sent[0]?.content ?? '';
    expect(asked).toContain('現職を続けながら活動しますか');
    expect(asked).toContain('現職を続けながら活動する');
    expect(asked).toContain('15社程度・質重視');
  });

  test('are absent from a first round, which has nothing to fold in', async () => {
    reply = says({ questions: [{ question: 'いつまでに', options: ['3ヶ月', '半年'] }] });
    await draftRoadmap('転職したい', WORLD, { today: TODAY });
    expect(sent[0]?.content ?? '').not.toContain('回答');
  });

  test('turn the round into the last one: it may not ask again', async () => {
    // Re-asking after the answers are in is a loop with no exit, and the
    // screen has no second place to put them.
    const plan = await refine({
      questions: [{ question: 'もう一度聞きますが', options: ['はい', 'いいえ'] }],
    });
    expect(plan?.questions).toEqual([]);
  });

  test('still allow the first round to ask up to its limit', async () => {
    const many = Array.from({ length: MAX_ROADMAP_QUESTIONS + 2 }, (_, i) => ({
      question: `質問${i}`,
      options: ['A', 'B'],
    }));
    reply = says({ questions: many });
    const plan = await draftRoadmap('転職したい', WORLD, { today: TODAY });
    expect(plan?.questions).toHaveLength(MAX_ROADMAP_QUESTIONS);
  });
});

describe('a description someone can act on', () => {
  test('carries what to do and what counts as done', async () => {
    const plan = await refine();
    const body = plan?.steps[0]?.description ?? '';
    expect(body).toContain('直近3社分の実績を数値付きで書く');
    expect(body).toContain('A4 1枚');
    expect(body).toContain('第三者レビュー済み');
  });

  test('writes the done conditions as something to tick off', async () => {
    const plan = await refine();
    expect(plan?.steps[0]?.description).toContain('- [ ] A4 1枚');
  });

  test('keeps a plain description when that is all it gave', async () => {
    const plan = await refine({
      steps: [{ title: 'やる', description: '前からある形' }],
    });
    expect(plan?.steps[0]?.description).toBe('前からある形');
  });

  test('says nothing rather than an empty heading when done is missing', async () => {
    const plan = await refine({ steps: [{ title: 'やる', action: '手を動かす' }] });
    const body = plan?.steps[0]?.description ?? '';
    expect(body).toContain('手を動かす');
    expect(body).not.toContain('完了条件');
  });

  test('composes the same way wherever it is called from', () => {
    expect(composeDescription('書く', ['一枚'])).toContain('- [ ] 一枚');
    expect(composeDescription('', [])).toBe('');
  });
});

describe('when a deadline was named', () => {
  test('turns the day counts into real dates', async () => {
    const plan = await refine({
      deadlineInDays: 90,
      steps: [
        { title: '一歩目', action: 'やる', done: ['おわる'], dueInDays: 7 },
        { title: '二歩目', action: 'やる', done: ['おわる'], dueInDays: 90 },
      ],
    });
    expect(plan?.deadline).toBe('2027-01-19');
    expect(plan?.steps[0]?.dueDate).toBe('2026-10-28');
    expect(plan?.steps[1]?.dueDate).toBe('2027-01-19');
  });

  test('pulls a step back that lands after the deadline', async () => {
    // A step due after the thing it is for has already happened is not a
    // plan; the date is wrong, not the deadline.
    const plan = await refine({
      deadlineInDays: 30,
      steps: [{ title: 'おくれる', action: 'やる', done: ['おわる'], dueInDays: 200 }],
    });
    expect(plan?.steps[0]?.dueDate).toBe('2026-11-20');
  });

  test('leaves dates off entirely when no deadline was given', async () => {
    const plan = await refine({ steps: [{ title: 'いつか', action: 'やる', done: ['おわる'] }] });
    expect(plan?.deadline).toBeUndefined();
    expect(plan?.steps[0]?.dueDate).toBeUndefined();
  });

  test('ignores a day count that is not a whole number of days', async () => {
    const plan = await refine({
      deadlineInDays: 30,
      steps: [{ title: 'あやしい', action: 'やる', done: ['おわる'], dueInDays: -5 }],
    });
    expect(plan?.steps[0]?.dueDate).toBeUndefined();
  });

  test('tells the model what day it is, or every count is anchored to nothing', async () => {
    await refine({ deadlineInDays: 90 });
    expect(sent[0]?.content ?? '').toContain('2026-10-21');
  });
});
