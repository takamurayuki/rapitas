/**
 * roadmap-commit-theme.test
 *
 * Reading back the theme a roadmap commit returned (design §3.3, §8.3
 * contract 6; review G2 fix1 must-fix 2) from the commit's AssistantAction and
 * the tasks' TaskCompanion rows — and refusing to guess when those records do
 * not account for every task.
 */
import { describe, it, expect } from 'bun:test';
import { createStage1Db } from '../../../tests/helpers/notes-stage1-db';
import { roadmapCommitTheme } from './roadmap-commit-theme';

type Row = Record<string, unknown>;

function dbWith(opts: {
  result?: Row;
  capabilityId?: string;
  actionWs?: number | null;
  companions?: Row[];
}) {
  return createStage1Db({
    theme: [{ id: 10 }, { id: 11 }, { id: 20, workspaceId: 2 }],
    task: [
      { id: 1, themeId: 11 },
      { id: 2, themeId: 10 },
      { id: 3, themeId: 11 },
    ],
    assistantAction: [
      {
        id: 50,
        workspaceId: opts.actionWs ?? null,
        capabilityId: opts.capabilityId ?? 'roadmap.commit',
        resultJson: JSON.stringify(opts.result ?? { themeId: 11, taskIds: [1, 2] }),
      },
    ],
    taskCompanion: opts.companions ?? [
      { taskId: 1, sourceActionId: 50 },
      { taskId: 2, sourceActionId: 50 },
    ],
  });
}

const read = (db: ReturnType<typeof createStage1Db>, ids: number[]) =>
  roadmapCommitTheme(db.prisma as never, ids);

describe('roadmapCommitTheme', () => {
  it('returns the theme commit returned, whatever the tasks carry now', async () => {
    expect(await read(dbWith({}), [1, 2])).toEqual({ found: true, themeId: 11 });
  });

  it('reads a commit that made no theme as 未分類', async () => {
    const db = dbWith({ result: { themeId: null, taskIds: [1, 2] } });
    expect(await read(db, [1, 2])).toEqual({ found: true, themeId: null });
  });

  it('reads a commit whose theme has since been deleted as 未分類', async () => {
    const db = dbWith({ result: { themeId: 99, taskIds: [1, 2] } });
    expect(await read(db, [1, 2])).toEqual({ found: true, themeId: null });
  });

  it('does not take a theme of another workspace from the record', async () => {
    const db = dbWith({ result: { themeId: 20, taskIds: [1, 2] } });
    expect(await read(db, [1, 2])).toEqual({ found: true, themeId: null });
  });

  it.each([
    ['a task without a companion row', { companions: [{ taskId: 1, sourceActionId: 50 }] }],
    [
      'a companion that points nowhere',
      {
        companions: [
          { taskId: 1, sourceActionId: 50 },
          { taskId: 2, sourceActionId: null },
        ],
      },
    ],
    ['a record that is not a roadmap commit', { capabilityId: 'task.create' }],
    ['a record of another workspace', { actionWs: 2 }],
    ['a record that did not make the task', { result: { themeId: 11, taskIds: [1] } }],
    ['a record without a result', { result: { failedAfter: 0 } }],
  ])('finds nothing for %s', async (_label, opts) => {
    expect(await read(dbWith(opts as never), [1, 2])).toEqual({ found: false });
  });

  it('finds nothing when the tasks come from commits that returned different themes', async () => {
    const db = dbWith({});
    db.rows('assistantAction').push({
      id: 51,
      workspaceId: null,
      capabilityId: 'roadmap.commit',
      status: 'executed',
      resultJson: JSON.stringify({ themeId: 10, taskIds: [3] }),
    });
    db.rows('taskCompanion').push({
      id: 99,
      workspaceId: null,
      taskId: 3,
      origin: 'roadmap_commit',
      sourceActionId: 51,
    });
    expect(await read(db, [1, 3])).toEqual({ found: false });
  });
});
