/**
 * assistant-roadmap criteria tests (companion design stage 1, item 1)
 *
 * The plan mode writes completion criteria to `Task.acceptanceCriteria`, not
 * only into the description. Every step must arrive with criteria — sent as
 * the array, or (for a client predating the field) read back from the
 * `## 完了条件` checklist the approved description carries — or the whole
 * commit is refused before anything is created.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

let committed: Array<{ steps: Array<Record<string, unknown>> }> = [];
let audited: Record<string, unknown>[] = [];
let linked: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];

mock.module('../../config/database', () => ({
  prisma: {
    theme: { findMany: async () => [] },
    project: { findMany: async () => [] },
    taskCompanion: {
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        linked.push(args);
        return { count: 2 };
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));
mock.module('../../services/assistant/roadmap-draft', () => ({
  draftRoadmap: async () => ({ available: false }),
  MAX_ROADMAP_STEPS: 20,
  MAX_ROADMAP_QUESTIONS: 4,
  composeDescription: (s: string) => s,
}));
mock.module('../../services/assistant/roadmap-commit', () => ({
  commitRoadmap: async (args: { steps: Array<Record<string, unknown>> }) => {
    committed.push(args);
    return { themeId: 1, projectId: null, taskIds: [10, 11], failedAfter: null };
  },
}));
mock.module('../../services/assistant/action-log', () => ({
  recordAction: async (row: Record<string, unknown>) => {
    audited.push(row);
    return 77;
  },
  listRecentActions: async () => [],
}));

const { assistantRoadmapRoutes } = await import('./assistant-roadmap.routes');

async function commit(steps: unknown[]) {
  const res = await assistantRoadmapRoutes.handle(
    new Request('http://localhost/assistant/roadmap/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmed: true,
        goal: '転職する',
        themeChoice: { kind: 'existing', id: 1 },
        projectChoice: { kind: 'none' },
        steps,
      }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  committed = [];
  audited = [];
  linked = [];
});

describe('POST /assistant/roadmap/commit and criteria', () => {
  test('passes the sent criteria through to the commit', async () => {
    const { status } = await commit([
      { title: '経歴書', description: 'A4', acceptanceCriteria: ['A4 1枚', ' A4 1枚 '] },
    ]);
    expect(status).toBe(200);
    expect(committed[0].steps[0].acceptanceCriteria).toEqual(['A4 1枚']);
  });

  test('reads them from the approved description when the client sends none', async () => {
    const { status } = await commit([
      {
        title: '経歴書',
        description: '書く\n\n## 完了条件\n- [ ] A4 1枚\n- [ ] 第三者レビュー済み',
      },
    ]);
    expect(status).toBe(200);
    expect(committed[0].steps[0].acceptanceCriteria).toEqual(['A4 1枚', '第三者レビュー済み']);
  });

  test('a step with no criteria anywhere refuses the whole commit, creating nothing', async () => {
    const { status, json } = await commit([
      { title: '経歴書', description: '書く', acceptanceCriteria: ['A4 1枚'] },
      { title: '応募', description: '15社' },
    ]);
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: 'acceptance_criteria_required', steps: [1] });
    expect(committed).toEqual([]);
    expect(audited[0]).toMatchObject({
      capabilityId: 'roadmap.commit',
      status: 'refused',
      errorMessage: 'acceptance_criteria_required',
    });
  });

  test('points the created tasks’ companion rows at the commit’s audit row', async () => {
    await commit([{ title: '経歴書', description: '', acceptanceCriteria: ['A4 1枚'] }]);
    expect(linked).toEqual([
      { where: { taskId: { in: [10, 11] }, sourceActionId: null }, data: { sourceActionId: 77 } },
    ]);
  });
});
