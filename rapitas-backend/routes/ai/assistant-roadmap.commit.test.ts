/**
 * assistant-roadmap.commit.test
 *
 * The half of the roadmap flow that writes, and the date that stopped it.
 *
 * Reported 2026-10-22: pressing 「この計画で◯件作る」 answered HTTP 400 and
 * created nothing. The payload was fine — the schema was not. `dueDate` was
 * declared `pattern: '^\d{4}-\d{2}-\d{2}$'`, and in a single-quoted
 * TypeScript string `\d` is just `d`, so the rule the route actually
 * enforced was `^d{4}-d{2}-d{2}$`: it rejected every real date and accepted
 * the literal text "dddd-dd-dd". Dated steps arrived with the deadline work
 * (#1184), which is when every commit carrying one began to fail.
 *
 * So the tests are about the dates specifically: a real one goes through and
 * reaches the writer, a malformed one is still refused, and the step that
 * carries no date is unaffected.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** What `commitRoadmap` was handed, if anything. */
let committed: Record<string, unknown>[] = [];
/** Audit rows the route wrote. */
let audited: Record<string, unknown>[] = [];

mock.module('../../config/database', () => ({
  prisma: {
    theme: { findMany: async () => [] },
    project: { findMany: async () => [] },
  },
  ensureDatabaseConnection: async () => {},
}));

// The narrow modules, not the `services/assistant` barrel: mock.module
// replaces a module wholesale, so stubbing the barrel drops every export it
// re-exports and the first unrelated importer dies on a missing name
// (`buildTaskDraft`, measured here before this was split out).
mock.module('../../services/assistant/roadmap-draft', () => ({
  draftRoadmap: async () => ({ available: false }),
  MAX_ROADMAP_STEPS: 20,
  MAX_ROADMAP_QUESTIONS: 4,
  composeDescription: (s: string) => s,
}));

mock.module('../../services/assistant/roadmap-commit', () => ({
  commitRoadmap: async (args: Record<string, unknown>) => {
    committed.push(args);
    return { themeId: 1, projectId: null, taskIds: [10, 11], failedAfter: null };
  },
}));

mock.module('../../services/assistant/action-log', () => ({
  recordAction: async (row: Record<string, unknown>) => {
    audited.push(row);
  },
  listRecentActions: async () => [],
}));

const { assistantRoadmapRoutes } = await import('./assistant-roadmap.routes');

/** The smallest plan the route will accept, minus the steps. */
const PLAN = {
  confirmed: true,
  goal: '3ヶ月後までに転職する',
  themeChoice: { kind: 'existing', id: 1 },
  projectChoice: { kind: 'none' },
};

async function commit(steps: unknown[]) {
  const res = await assistantRoadmapRoutes.handle(
    new Request('http://localhost/assistant/roadmap/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...PLAN, steps }),
    }),
  );
  return { status: res.status };
}

beforeEach(() => {
  committed = [];
  audited = [];
});

describe('committing a plan whose steps carry dates', () => {
  test('accepts a real date and creates the tasks', async () => {
    const { status } = await commit([
      { title: '職務経歴書を作る', description: 'A4 1枚', dueDate: '2026-11-04' },
    ]);
    expect(status).toBe(200);
    expect(committed).toHaveLength(1);
    expect((committed[0]?.steps as { dueDate?: string }[])[0]?.dueDate).toBe('2026-11-04');
  });

  test('accepts every step of a dated plan, not just the first', async () => {
    const { status } = await commit([
      { title: '職務経歴書を作る', description: '', dueDate: '2026-11-04' },
      { title: '15社に応募する', description: '', dueDate: '2027-01-19' },
      { title: '面接の練習', description: '', dueDate: '2026-12-01' },
    ]);
    expect(status).toBe(200);
    expect(committed[0]?.steps).toHaveLength(3);
  });

  test('still refuses a date that is not one', async () => {
    // The check exists because a malformed date reaches Prisma as an Invalid
    // Date; loosening it to fix the false rejection would trade one bug for
    // a worse one.
    const { status } = await commit([
      { title: '面接の練習', description: '', dueDate: '2026-11-4' },
    ]);
    expect(status).toBe(422);
    expect(committed).toHaveLength(0);
  });

  test('refuses the literal text the broken rule used to accept', async () => {
    const { status } = await commit([
      { title: '面接の練習', description: '', dueDate: 'dddd-dd-dd' },
    ]);
    expect(status).toBe(422);
    expect(committed).toHaveLength(0);
  });

  test('leaves an undated step alone', async () => {
    const { status } = await commit([{ title: '情報収集', description: '' }]);
    expect(status).toBe(200);
    expect(committed).toHaveLength(1);
  });
});
