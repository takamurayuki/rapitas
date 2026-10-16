/**
 * task-parent-status-sync ユニットテスト
 *
 * サブタスクのステータス変更時、兄弟タスク全体から親タスクのステータスを
 * 再計算するロジックを検証する。ルール: 全てtodo→todo、一件でも
 * in-progress(blocked含む)があればin-progress、全てdone→done、
 * done+todoの混在(in-progressなし)はin-progress。
 * ワークフロー管理下の親(workflowStatusが非null)への'done'適用は
 * onSubtaskCompletedとの競合を避けるためスキップする。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { syncParentStatusFromSubtasks } from './task-parent-status-sync';

function createMockPrisma() {
  return {
    task: {
      findMany: mock(() => Promise.resolve([])) as ReturnType<typeof mock>,
      findUnique: mock(() => Promise.resolve(null)) as ReturnType<typeof mock>,
      update: mock(() => Promise.resolve({})) as ReturnType<typeof mock>,
    },
  };
}

let mockPrisma = createMockPrisma();

function setup(
  siblingStatuses: string[],
  parent: { status: string; workflowStatus: string | null } | null,
) {
  mockPrisma.task.findMany.mockResolvedValueOnce(siblingStatuses.map((status) => ({ status })));
  mockPrisma.task.findUnique.mockResolvedValueOnce(parent);
}

beforeEach(() => {
  mockPrisma = createMockPrisma();
});

describe('syncParentStatusFromSubtasks', () => {
  test('全サブタスクがtodoの場合、親をtodoに更新すること', async () => {
    setup(['todo', 'todo'], { status: 'in-progress', workflowStatus: null });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
      where: { parentId: 100 },
      select: { status: true },
    });
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'todo' },
    });
  });

  test('一件でもin-progressのサブタスクがあれば親をin-progressに更新すること', async () => {
    setup(['in-progress', 'todo', 'done'], { status: 'todo', workflowStatus: null });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'in-progress', startedAt: expect.any(Date) },
    });
  });

  test('blockedなサブタスクもin-progress扱いになること', async () => {
    setup(['blocked', 'todo'], { status: 'todo', workflowStatus: null });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'in-progress', startedAt: expect.any(Date) },
    });
  });

  test('全サブタスクがdoneかつワークフロー管理下でない親の場合、done + completedAtで更新すること', async () => {
    setup(['done', 'done'], { status: 'in-progress', workflowStatus: null });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'done', completedAt: expect.any(Date) },
    });
  });

  test('全サブタスクがdoneでもワークフロー管理下の親(workflowStatusが非null)はスキップすること', async () => {
    setup(['done', 'done'], { status: 'in-progress', workflowStatus: 'draft' });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('workflowStatusがcompleted(確定済み)の親でも、サブタスクがin-progressに戻ればstatusを追従させること', async () => {
    setup(['in-progress', 'done'], { status: 'done', workflowStatus: 'completed' });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'in-progress', startedAt: expect.any(Date), completedAt: null },
    });
  });

  test('done+todoの混在(in-progressなし)の場合、親をin-progressに更新すること', async () => {
    setup(['done', 'todo'], { status: 'todo', workflowStatus: null });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'in-progress', startedAt: expect.any(Date) },
    });
  });

  test('親が既に目標ステータスの場合、更新を呼ばないこと', async () => {
    setup(['in-progress', 'todo'], { status: 'in-progress', workflowStatus: null });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('doneからtodoへの降格時、completedAtをnullにクリアすること', async () => {
    setup(['todo', 'todo'], { status: 'done', workflowStatus: null });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'todo', completedAt: null },
    });
  });

  test('doneからin-progressへの降格でも、in-progress用のstartedAtとcompletedAtクリアの両方が入ること', async () => {
    setup(['done', 'todo'], { status: 'done', workflowStatus: null });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'in-progress', startedAt: expect.any(Date), completedAt: null },
    });
  });

  test('親が見つからない場合、更新をスキップすること', async () => {
    setup(['todo'], null);

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('兄弟タスクが存在しない場合、更新をスキップすること', async () => {
    setup([], { status: 'todo', workflowStatus: null });

    await syncParentStatusFromSubtasks(mockPrisma as never, 100);

    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });
});
