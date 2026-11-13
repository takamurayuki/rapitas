/**
 * assistant-roadmap.milestones.test
 *
 * The commit route must carry the approved milestones (節目) and each step's
 * milestone number through to the writer. Elysia's t.Object drops every
 * property the schema does not declare, so a field the client sends but the
 * schema forgets is lost silently — the tasks would be created, unfiled.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

let committed: Record<string, unknown>[] = [];

mock.module('../../config/database', () => ({
  prisma: { theme: { findMany: async () => [] }, project: { findMany: async () => [] } },
  ensureDatabaseConnection: async () => {},
}));
mock.module('../../services/assistant/roadmap-draft', () => ({
  draftRoadmap: async () => ({ available: false }),
  MAX_ROADMAP_STEPS: 20,
  MAX_ROADMAP_QUESTIONS: 4,
  composeDescription: (s: string) => s,
}));
mock.module('../../services/assistant/roadmap-commit', () => ({
  commitRoadmap: async (args: Record<string, unknown>) => {
    committed.push(args);
    return { themeId: null, projectId: 7, taskIds: [10], milestoneIds: [20], failedAfter: null };
  },
}));
mock.module('../../services/assistant/action-log', () => ({
  recordAction: async () => {},
  listRecentActions: async () => [],
}));

const { assistantRoadmapRoutes } = await import('./assistant-roadmap.routes');

const post = (body: Record<string, unknown>) =>
  assistantRoadmapRoutes.handle(
    new Request('http://localhost/assistant/roadmap/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const BASE = {
  confirmed: true,
  goal: '基本情報に合格する',
  themeChoice: { kind: 'none' },
  projectChoice: { kind: 'existing', id: 7 },
};
const DONE = { acceptanceCriteria: ['終わったと確かめられる'] };

beforeEach(() => {
  committed = [];
});

describe('committing a plan with milestones', () => {
  test('passes the milestones and each step milestone index to the writer', async () => {
    const res = await post({
      ...BASE,
      milestones: [
        { name: '基礎固め', acceptanceCriteria: ['午前で7割'], dueDate: '2026-12-01' },
        { name: '仕上げ', acceptanceCriteria: ['模試で合格点'] },
      ],
      steps: [
        { title: 'テキスト', description: '', milestoneIndex: 0, ...DONE },
        { title: '模試', description: '', milestoneIndex: 1, ...DONE },
      ],
    });
    expect(res.status).toBe(200);
    expect(committed[0]?.milestones).toEqual([
      { name: '基礎固め', acceptanceCriteria: ['午前で7割'], dueDate: '2026-12-01' },
      { name: '仕上げ', acceptanceCriteria: ['模試で合格点'] },
    ]);
    expect(
      (committed[0]?.steps as { milestoneIndex?: number }[]).map((s) => s.milestoneIndex),
    ).toEqual([0, 1]);
  });

  test('still accepts a plan without milestones', async () => {
    const res = await post({ ...BASE, steps: [{ title: 'a', description: '', ...DONE }] });
    expect(res.status).toBe(200);
    expect(committed[0]?.milestones ?? []).toEqual([]);
  });

  test('refuses a malformed milestone date', async () => {
    const res = await post({
      ...BASE,
      milestones: [{ name: 'x', acceptanceCriteria: ['y'], dueDate: '2026-12-1' }],
      steps: [{ title: 'a', description: '', ...DONE }],
    });
    expect(res.status).toBe(422);
  });
});
