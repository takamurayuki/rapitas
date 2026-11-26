/**
 * theme-active-set.test
 *
 * Task 1552: slot bookkeeping for a theme running a head plus companions.
 * Covers acceptance row 5 ("A が完了 → A の枠だけ空き、B の状態は変わらない"),
 * the unchanged one-at-a-time path (no companions → the pre-task service
 * calls with the same arguments), compare-and-set retries and bad input.
 *
 * Run on its own: bun's mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../../../../generated/prisma-postgres';
import { fakeThemeAutoRun, runningRow, type FakeRow } from './fake-theme-auto-run.test-support';

const setCurrentTask = mock(async (_themeId: number, _taskId: number | null) => {});
const onTaskCompleted = mock(async (_themeId: number) => {});
const onTaskFailed = mock(async (_themeId: number, _error: string) => {});
mock.module('../../theme-auto-run-service', () => ({
  setCurrentTask,
  onTaskCompleted,
  onTaskFailed,
}));
mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const {
  addCompanion,
  activeTaskIds,
  loadThemeActiveSet,
  parseCompanions,
  releaseThemeSlot,
  retrackThemeSlot,
} = await import('../theme-active-set');
const { promoteHeadless, releaseCompanionEverywhere, clearCompanions } =
  await import('../theme-active-set-cleanup');

let rows: FakeRow[];
let fake: ReturnType<typeof fakeThemeAutoRun>;
const prisma = () => ({ themeAutoRun: fake.model }) as unknown as PrismaClient;

beforeEach(() => {
  setCurrentTask.mockClear();
  onTaskCompleted.mockClear();
  onTaskFailed.mockClear();
  rows = [];
  fake = fakeThemeAutoRun(rows);
});

describe('acceptance row 5 — A completes: only A leaves, B keeps its state', () => {
  test('head A completes → B becomes head with its own tenure; B is not touched otherwise', async () => {
    rows.push(
      runningRow({ currentTaskId: 10, companionTasksJson: '[{"taskId":20,"since":1000}]' }),
    );
    expect(await releaseThemeSlot(prisma(), 1, 10, 'completed')).toBe('promoted');
    expect(rows[0]).toMatchObject({
      currentTaskId: 20,
      companionTasksJson: null,
      processedCount: 1,
      lastRunAt: new Date(1000), // B's tenure is kept, not restarted
    });
    expect(onTaskCompleted).not.toHaveBeenCalled();
  });

  test('companion B completes → A stays head, only B leaves the set', async () => {
    rows.push(
      runningRow({
        currentTaskId: 10,
        lastRunAt: new Date(500),
        companionTasksJson: '[{"taskId":20,"since":1000},{"taskId":30,"since":2000}]',
      }),
    );
    expect(await releaseThemeSlot(prisma(), 1, 20, 'completed')).toBe('companion_removed');
    expect(rows[0]!.currentTaskId).toBe(10);
    expect(rows[0]!.lastRunAt).toEqual(new Date(500));
    expect(parseCompanions(rows[0]!.companionTasksJson)).toEqual([{ taskId: 30, since: 2000 }]);
  });

  test('a failure records lastError and counts as processed, companion untouched', async () => {
    rows.push(
      runningRow({ currentTaskId: 10, companionTasksJson: '[{"taskId":20,"since":1000}]' }),
    );
    await releaseThemeSlot(prisma(), 1, 20, 'failed', 'boom');
    expect(rows[0]).toMatchObject({ currentTaskId: 10, lastError: 'boom', processedCount: 1 });
  });
});

describe('単独実行も対象IDでCAS解放する', () => {
  test.each(['completed', 'failed', 'released'] as const)(
    '%s: 対象の先頭だけを外す',
    async (kind) => {
      rows.push(runningRow({ currentTaskId: 10 }));
      expect(await releaseThemeSlot(prisma(), 1, 10, kind, 'err')).toBe('head_removed');
      expect(rows[0]!.currentTaskId).toBeNull();
      expect(rows[0]!.processedCount).toBe(kind === 'released' ? 0 : 1);
      expect(fake.writes[0]!.where).toEqual({
        themeId: 1,
        currentTaskId: 10,
        companionTasksJson: null,
      });
    },
  );
  test.each([true, false])(
    '旧クライアント・読取失敗時も別タスクは消さない: %s',
    async (readFails) => {
      rows.push(runningRow({ currentTaskId: 20 }));
      const p = {
        themeAutoRun: {
          ...fake.model,
          findFirst: async () => {
            if (readFails) throw new Error('read failed');
            return { currentTaskId: 20 };
          },
        },
      } as unknown as PrismaClient;
      expect(await releaseThemeSlot(p, 1, 10, 'completed')).toBe('not_member');
      expect(rows[0]!.currentTaskId).toBe(20);
      expect(await releaseThemeSlot(p, 1, 20, 'completed')).toBe('head_removed');
      expect(rows[0]!.processedCount).toBe(1);
      expect(
        fake.writes.every(
          (w) => w.where.themeId === 1 && typeof w.where.currentTaskId === 'number',
        ),
      ).toBe(true);
    },
  );
  test('DBモデルがない場合は無条件解放をしない', async () => {
    expect(await releaseThemeSlot({} as PrismaClient, 1, 10, 'completed')).toBe('not_member');
    expect(onTaskCompleted).not.toHaveBeenCalled();
  });
});

describe('addCompanion', () => {
  test.each(['{oops', 'null', '[null]', '[{"taskId":20}]'])(
    '破損JSON %s は上書きせず追加を拒否する',
    async (raw) => {
      rows.push(runningRow({ currentTaskId: 10, companionTasksJson: raw }));
      expect(await addCompanion(prisma(), 1, 30)).toBe(false);
      expect(rows[0]!.companionTasksJson).toBe(raw);
    },
  );
  test('adds while running; refuses on a paused theme and on an old client', async () => {
    rows.push(runningRow({ currentTaskId: 10 }));
    expect(await addCompanion(prisma(), 1, 20, 1234)).toBe(true);
    expect(parseCompanions(rows[0]!.companionTasksJson)).toEqual([{ taskId: 20, since: 1234 }]);
    rows[0]!.status = 'paused_approval';
    expect(await addCompanion(prisma(), 1, 30)).toBe(false);
    const oldClient = { themeAutoRun: { findFirst: async () => ({ currentTaskId: 10 }) } };
    expect(await addCompanion(oldClient as unknown as PrismaClient, 1, 30)).toBe(false);
  });

  test('a concurrent write between read and write is retried, both survive', async () => {
    rows.push(runningRow({ currentTaskId: 10 }));
    let injected = false;
    const racing = {
      ...fake.model,
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if (!injected) {
          injected = true;
          rows[0]!.companionTasksJson = '[{"taskId":30,"since":5}]'; // someone else added 30
        }
        return fake.model.updateMany(args);
      },
    };
    const p = { themeAutoRun: racing } as unknown as PrismaClient;
    expect(await addCompanion(p, 1, 20, 9)).toBe(true);
    expect(activeTaskIds(await loadThemeActiveSet(p, 1))).toEqual([10, 30, 20]);
  });
});

describe('F1: 解放の冪等性', () => {
  test('先頭解放のCAS直前に同伴が完了しても二重に数えない', async () => {
    rows.push(runningRow({ currentTaskId: 10, companionTasksJson: '[{"taskId":20,"since":7}]' }));
    let injected = false;
    const p = {
      themeAutoRun: {
        ...fake.model,
        updateMany: async (args: Parameters<typeof fake.model.updateMany>[0]) => {
          if (!injected) {
            injected = true;
            await releaseThemeSlot(prisma(), 1, 20, 'completed');
          }
          return fake.model.updateMany(args);
        },
      },
    } as unknown as PrismaClient;
    await releaseThemeSlot(p, 1, 10, 'completed');
    expect(rows[0]).toMatchObject({
      currentTaskId: null,
      companionTasksJson: null,
      processedCount: 2,
    });
  });

  test('再起動後の読み込みは終端・削除済み同伴を除き、生存タスクの在籍を保持する', async () => {
    rows.push(
      runningRow({
        currentTaskId: 10,
        companionTasksJson:
          '[{"taskId":20,"since":7},{"taskId":30,"since":8},{"taskId":40,"since":9}]',
      }),
    );
    const p = {
      themeAutoRun: fake.model,
      task: {
        findMany: async () => [
          { id: 10, status: 'in-progress' },
          { id: 20, status: 'done' },
          { id: 40, status: 'in-progress' },
        ],
      },
    } as unknown as PrismaClient;
    expect(activeTaskIds(await loadThemeActiveSet(p, 1))).toEqual([10, 40]);
    expect(rows[0]!.companionTasksJson).toBe('[{"taskId":40,"since":9}]');
  });
  test.each(['completed', 'failed', 'released'] as const)(
    '%s: 同伴の遅れた解放でも先頭を保持する',
    async (kind) => {
      rows.push(runningRow({ currentTaskId: 10, companionTasksJson: '[{"taskId":20,"since":7}]' }));
      await releaseCompanionEverywhere(prisma(), 20);
      await releaseThemeSlot(prisma(), 1, 20, kind);
      expect(rows[0]!.currentTaskId).toBe(10);
      expect(onTaskCompleted).not.toHaveBeenCalled();
      expect(onTaskFailed).not.toHaveBeenCalled();
      expect(setCurrentTask).not.toHaveBeenCalled();
      expect(rows[0]!.processedCount).toBe(0);
    },
  );
  test.each(['completed', 'failed', 'released'] as const)(
    '%s: 旧先頭の二重解放で繰り上げ済み先頭を保持する',
    async (kind) => {
      rows.push(runningRow({ currentTaskId: 10, companionTasksJson: '[{"taskId":20,"since":7}]' }));
      await releaseThemeSlot(prisma(), 1, 10, kind);
      await releaseThemeSlot(prisma(), 1, 10, kind);
      expect(rows[0]!.currentTaskId).toBe(20);
      expect(rows[0]!.processedCount).toBe(kind === 'released' ? 0 : 1);
      expect(onTaskCompleted).not.toHaveBeenCalled();
      expect(onTaskFailed).not.toHaveBeenCalled();
      expect(setCurrentTask).not.toHaveBeenCalled();
    },
  );
});

describe('re-track, headless promotion, terminal release, clear', () => {
  test('停止は破損した同伴JSONも消去する', async () => {
    rows.push(runningRow({ currentTaskId: 10, companionTasksJson: '{oops' }));
    await clearCompanions(prisma(), 1);
    expect(rows[0]!.companionTasksJson).toBeNull();
  });
  test('読み込みで終端先頭を外し、生存同伴を繰り上げる', async () => {
    rows.push(runningRow({ currentTaskId: 10, companionTasksJson: '[{"taskId":20,"since":7}]' }));
    const p = {
      themeAutoRun: fake.model,
      task: {
        findMany: async () => [
          { id: 10, status: 'done' },
          { id: 20, status: 'in-progress' },
        ],
      },
    } as unknown as PrismaClient;
    expect(activeTaskIds(await loadThemeActiveSet(p, 1))).toEqual([20]);
    expect(rows[0]).toMatchObject({ currentTaskId: 20, lastRunAt: new Date(7), processedCount: 1 });
  });
  test('re-tracking a companion restarts only its own tenure', async () => {
    rows.push(runningRow({ currentTaskId: 10, companionTasksJson: '[{"taskId":20,"since":1}]' }));
    await retrackThemeSlot(prisma(), 1, 20);
    expect(parseCompanions(rows[0]!.companionTasksJson)[0]!.since).toBeGreaterThan(1);
    expect(setCurrentTask).not.toHaveBeenCalled();
    await retrackThemeSlot(prisma(), 1, 10);
    expect(setCurrentTask).toHaveBeenCalledWith(1, 10);
  });

  test('a head released elsewhere (PATCH /tasks) is replaced by the oldest companion', async () => {
    rows.push(runningRow({ currentTaskId: null, companionTasksJson: '[{"taskId":20,"since":7}]' }));
    expect(await promoteHeadless(prisma(), 1)).toBe(true);
    expect(rows[0]).toMatchObject({ currentTaskId: 20, companionTasksJson: null });
  });

  test('a terminal task leaves every theme it is a companion of, the head is kept', async () => {
    rows.push(runningRow({ currentTaskId: 10, companionTasksJson: '[{"taskId":20,"since":7}]' }));
    expect(await releaseCompanionEverywhere(prisma(), 20)).toBe(1);
    expect(rows[0]).toMatchObject({ currentTaskId: 10, companionTasksJson: null });
    expect(setCurrentTask).not.toHaveBeenCalled();
  });

  test('clear on a theme without companions writes nothing', async () => {
    rows.push(runningRow({ currentTaskId: 10 }));
    await clearCompanions(prisma(), 1);
    expect(fake.writes).toEqual([]);
  });

  test('broken JSON reads as no companions', () => {
    expect(parseCompanions('{oops')).toEqual([]);
    expect(
      parseCompanions('[{"taskId":"x"},{"taskId":5,"since":1},{"taskId":5,"since":2}]'),
    ).toEqual([{ taskId: 5, since: 1 }]);
  });
});
