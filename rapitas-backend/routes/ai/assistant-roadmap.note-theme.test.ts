/**
 * assistant-roadmap.note-theme.test
 *
 * The record `POST /assistant/roadmap/commit` leaves is the one the notes
 * batch reads the closing note's theme from (design §3.3, §8.3 contract 6;
 * review G2 fix1 must-fix 2). The route, `recordAction` and
 * `linkCompanionSource` run for real over the in-memory notes database; only
 * `commitRoadmap` (which makes the tasks) is stubbed, with companion rows
 * seeded as its task creation would leave them.
 *
 * mock.module is process-global — run this file with --isolate.
 */
import { describe, expect, it, mock } from 'bun:test';
import { createStage1Db } from '../../tests/helpers/notes-stage1-db';

const db = createStage1Db({
  theme: [
    { id: 1, name: '転職' },
    { id: 2, name: '英語' },
  ],
  task: [
    { id: 10, themeId: 1 },
    { id: 11, themeId: 1 },
  ],
  taskCompanion: [
    { taskId: 10, origin: 'roadmap_commit' },
    { taskId: 11, origin: 'roadmap_commit' },
  ],
});
const prismaProxy = new Proxy({}, { get: (_t, key) => db.prisma[key as string] });
mock.module('../../config/database', () => ({
  prisma: prismaProxy,
  ensureDatabaseConnection: async () => {},
}));
mock.module('../../services/assistant/roadmap-commit', () => ({
  commitRoadmap: async () => ({
    themeId: 1,
    projectId: null,
    taskIds: [10, 11],
    milestoneIds: [],
    failedAfter: null,
  }),
}));

const { assistantRoadmapRoutes } = await import('./assistant-roadmap.routes');
const { roadmapCommitTheme } = await import('../../services/notes/batch/roadmap-commit-theme');

describe('the commit record the closing note is placed by', () => {
  it('keeps the theme commit returned after a task moves to another theme', async () => {
    const res = await assistantRoadmapRoutes.handle(
      new Request('http://localhost/assistant/roadmap/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmed: true,
          goal: '転職する',
          themeChoice: { kind: 'existing', id: 1 },
          projectChoice: { kind: 'none' },
          steps: [
            { title: '経歴書', description: 'A4', acceptanceCriteria: ['書けた'] },
            { title: '応募', description: '3社', acceptanceCriteria: ['応募した'] },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const [action] = db.rows('assistantAction');
    expect(action).toMatchObject({ capabilityId: 'roadmap.commit', status: 'executed' });
    expect(db.rows('taskCompanion').map((c) => c.sourceActionId)).toEqual([action?.id, action?.id]);

    (db.find('task', { id: 11 }) as Record<string, unknown>).themeId = 2;
    expect(await roadmapCommitTheme(db.prisma as never, [10, 11])).toEqual({
      found: true,
      themeId: 1,
    });
  });
});
