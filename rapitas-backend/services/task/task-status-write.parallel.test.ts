/** 終端APIとスケジューラの解放が重なっても、別タスクの枠を保持する。 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import {
  fakeThemeAutoRun,
  runningRow,
  type FakeRow,
} from '../workflow/auto-run/parallel/__tests__/fake-theme-auto-run.test-support';

mock.module('../workflow/auto-run/theme-auto-run-service', () => ({}));
mock.module('../notes/deliverables/deliverable-completion', () => ({
  completionRecordBatchOps: () => [],
  onTaskCompleted: () => {},
}));
const { writeTaskStatusUpdate } = await import('./task-status-write');
const { releaseThemeSlot } = await import('../workflow/auto-run/parallel/theme-active-set');
let rows: FakeRow[];
let updated: number[];
let failWrite: boolean;

function client() {
  const fake = fakeThemeAutoRun(rows);
  const db = {
    themeAutoRun: {
      ...fake.model,
      updateMany: async (args: Parameters<typeof fake.model.updateMany>[0]) => {
        if (failWrite) throw new Error('DB書き込み失敗');
        return fake.model.updateMany(args);
      },
    },
    task: {
      update: async (args: { where: { id: number } }) => {
        updated.push(args.where.id);
        return {};
      },
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone(rows);
      try {
        return await run(db);
      } catch (err) {
        rows.splice(0, rows.length, ...snapshot);
        updated.length = 0;
        throw err;
      }
    },
  };
  return db as unknown as PrismaClient;
}

beforeEach(() => {
  rows = [runningRow({ currentTaskId: 10, companionTasksJson: '[{"taskId":20,"since":7}]' })];
  updated = [];
  failWrite = false;
});

describe('終端書き込みと枠解放', () => {
  test.each([10, 20])('タスク%dの終端API後の遅延解放は残ったタスクを消さない', async (id) => {
    const db = client();
    await writeTaskStatusUpdate(db, id, { where: { id }, data: { status: 'done' } }, 'done', {
      completing: true,
      completionAt: new Date(),
      workspaceId: null,
    });
    await releaseThemeSlot(db, 1, id, 'completed');
    expect(updated).toEqual([id]);
    expect(rows[0]).toMatchObject({
      currentTaskId: id === 10 ? 20 : 10,
      companionTasksJson: null,
      processedCount: 1,
    });
  });
  test('解放書き込みが失敗するとトランザクションの状態更新も取り消される', async () => {
    failWrite = true;
    await expect(
      writeTaskStatusUpdate(client(), 10, { where: { id: 10 }, data: { status: 'done' } }, 'done', {
        completing: true,
        completionAt: new Date(),
        workspaceId: null,
      }),
    ).rejects.toThrow('DB書き込み失敗');
    expect(updated).toEqual([]);
    expect(rows[0]!.currentTaskId).toBe(10);
  });
});
