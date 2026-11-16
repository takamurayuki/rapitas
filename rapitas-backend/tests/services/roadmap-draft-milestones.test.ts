/**
 * roadmap-draft-milestones.test
 *
 * The drafted plan carries milestones (節目) only when the work is filed under
 * a project — milestones belong to a project (the goal) and have nowhere to
 * live otherwise — and each step says which milestone it builds towards.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

let reply = '{}';
let sent: { systemPrompt?: string }[] = [];

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async (o: { systemPrompt?: string }) => {
    sent.push({ systemPrompt: o.systemPrompt });
    return { content: reply, tokensUsed: 0 };
  },
}));
mock.module('../../services/system/rapi-profile-store', () => ({
  MAX_RAPI_PROFILE_LENGTH: 1200,
  readRapiProfile: async () => null,
  writeRapiProfile: async () => {},
  readRapiCharacter: async () => null,
  writeRapiCharacter: async () => {},
}));

const { draftRoadmap } = await import('../../services/assistant/roadmap-draft');

const PROJECTS = [{ id: 7, name: '資格', description: null }];
const PLAN = {
  goal: '基本情報に合格する',
  themeChoice: { kind: 'new', name: '学習', reason: 'なし' },
  projectChoice: { kind: 'existing', id: 7 },
  questions: [],
  milestones: [
    { name: '基礎固め', done: ['午前の過去問で7割を3回'], dueInDays: null },
    { name: '仕上げ', done: ['模試で合格点'], dueInDays: null },
  ],
  steps: [
    { title: 'テキストを1周', action: '1日1章', done: ['全章読了'], milestone: 0 },
    { title: '過去問を解く', action: '3年分', done: ['3年分解答'], milestone: 0 },
    { title: '模試を受ける', action: '1回', done: ['模試1回'], milestone: 1 },
  ],
};

const draft = () =>
  draftRoadmap(
    '資格を取りたい',
    { themes: [], projects: PROJECTS },
    { answers: [{ question: 'q', answer: 'a' }] },
  );

beforeEach(() => {
  sent = [];
});

describe('roadmap draft — milestones', () => {
  test('asks the model for milestones and which one each step builds towards', async () => {
    reply = JSON.stringify(PLAN);
    await draft();
    expect(sent[0].systemPrompt).toContain('"milestones"');
    expect(sent[0].systemPrompt).toContain('"milestone": number | null');
  });

  test('returns the milestones and each step milestone index', async () => {
    reply = JSON.stringify(PLAN);
    const result = await draft();
    expect(result?.milestones).toEqual([
      { name: '基礎固め', acceptanceCriteria: ['午前の過去問で7割を3回'] },
      { name: '仕上げ', acceptanceCriteria: ['模試で合格点'] },
    ]);
    expect(result?.steps.map((s) => s.milestoneIndex)).toEqual([0, 0, 1]);
  });

  test('drops milestones when the work is not filed under a project', async () => {
    reply = JSON.stringify({ ...PLAN, projectChoice: { kind: 'none', reason: '単発' } });
    const result = await draft();
    expect(result?.milestones).toEqual([]);
    expect(result?.steps.every((s) => s.milestoneIndex === undefined)).toBe(true);
  });
});
