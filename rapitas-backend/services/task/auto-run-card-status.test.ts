/**
 * auto-run-card-status ユニットテスト
 *
 * attachAutoRunCardStatus の分岐（空配列・非対象テーマ・現在実行中タスク・
 * 順番待ち候補・対象外タスク・非開発テーマ・ネストされたサブタスク）を検証する。
 * prisma は関数引数として渡されるため mock.module は不要 — プレーンなモック
 * オブジェクトを直接渡す。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { attachAutoRunCardStatus, type TaskLikeForAutoRunCardStatus } from './auto-run-card-status';

const findMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;

function buildPrisma(): PrismaClient {
  return {
    themeAutoRun: { findMany },
  } as unknown as PrismaClient;
}

const devTheme = { isDevelopment: true, workingDirectory: 'C:/Projects/rapitas' };

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

describe('attachAutoRunCardStatus', () => {
  test('空配列を渡した場合 → DBに問い合わせず空配列を返すこと', async () => {
    const result = await attachAutoRunCardStatus(buildPrisma(), []);

    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  test('themeId が無いタスクのみ → DBに問い合わせず両フラグとも undefined のままであること', async () => {
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      { id: 1, themeId: null, parentId: null, status: 'todo' },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(findMany).not.toHaveBeenCalled();
    expect(result[0].autoRunCurrent).toBeUndefined();
    expect(result[0].autoRunQueued).toBeUndefined();
  });

  test('テーマの自動実行が enabled+running でない → 両フラグとも false', async () => {
    findMany.mockResolvedValueOnce([]); // このテーマは対象外(running中のThemeAutoRun無し)
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      { id: 1, themeId: 1, parentId: null, status: 'todo', theme: devTheme },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunCurrent).toBe(false);
    expect(result[0].autoRunQueued).toBe(false);
  });

  test('自動実行中で currentTaskId と一致 → autoRunCurrent=true, autoRunQueued=false', async () => {
    findMany.mockResolvedValueOnce([{ themeId: 1, currentTaskId: 5 }]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      { id: 5, themeId: 1, parentId: null, status: 'in-progress', theme: devTheme },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunCurrent).toBe(true);
    expect(result[0].autoRunQueued).toBe(false);
  });

  test('自動実行中だが対象外(todo・条件を満たす)のタスク → autoRunQueued=true', async () => {
    findMany.mockResolvedValueOnce([{ themeId: 1, currentTaskId: 5 }]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      { id: 7, themeId: 1, parentId: null, status: 'todo', theme: devTheme },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunCurrent).toBe(false);
    expect(result[0].autoRunQueued).toBe(true);
  });

  test('workflowDisabled なタスク → 対象テーマでも順番待ちにならない', async () => {
    findMany.mockResolvedValueOnce([{ themeId: 1, currentTaskId: 5 }]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      {
        id: 8,
        themeId: 1,
        parentId: null,
        status: 'todo',
        workflowDisabled: true,
        theme: devTheme,
      },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunQueued).toBe(false);
  });

  test('autoRunExcluded なタスク → 順番待ちにならない', async () => {
    findMany.mockResolvedValueOnce([{ themeId: 1, currentTaskId: 5 }]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      { id: 9, themeId: 1, parentId: null, status: 'todo', autoRunExcluded: true, theme: devTheme },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunQueued).toBe(false);
  });

  test('awaiting_question のタスク → 順番待ちにならない', async () => {
    findMany.mockResolvedValueOnce([{ themeId: 1, currentTaskId: 5 }]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      {
        id: 10,
        themeId: 1,
        parentId: null,
        status: 'todo',
        workflowStatus: 'awaiting_question',
        theme: devTheme,
      },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunQueued).toBe(false);
  });

  test('サブタスク(parentId有り) → 対象外であり順番待ちにならない', async () => {
    findMany.mockResolvedValueOnce([{ themeId: 1, currentTaskId: 5 }]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      { id: 11, themeId: 1, parentId: 100, status: 'todo', theme: devTheme },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunQueued).toBe(false);
  });

  test('非開発テーマ(isDevelopment=false) → running中でも両フラグとも false', async () => {
    findMany.mockResolvedValueOnce([{ themeId: 1, currentTaskId: 5 }]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      {
        id: 5,
        themeId: 1,
        parentId: null,
        status: 'in-progress',
        theme: { isDevelopment: false, workingDirectory: 'C:/Projects/rapitas' },
      },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunCurrent).toBe(false);
    expect(result[0].autoRunQueued).toBe(false);
  });

  test('workingDirectory 未設定テーマ → 両フラグとも false', async () => {
    findMany.mockResolvedValueOnce([{ themeId: 1, currentTaskId: 5 }]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      {
        id: 5,
        themeId: 1,
        parentId: null,
        status: 'in-progress',
        theme: { isDevelopment: true, workingDirectory: null },
      },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunCurrent).toBe(false);
    expect(result[0].autoRunQueued).toBe(false);
  });

  test('ネストされたサブタスクにも再帰的に付与されること', async () => {
    findMany.mockResolvedValueOnce([{ themeId: 1, currentTaskId: 20 }]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      {
        id: 10,
        themeId: 1,
        parentId: null,
        status: 'todo',
        theme: devTheme,
        subtasks: [{ id: 20, themeId: 1, parentId: 10, status: 'in-progress', theme: devTheme }],
      },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunQueued).toBe(true);
    expect(result[0].subtasks?.[0].autoRunCurrent).toBe(true);
  });

  test('複数テーマが混在していても正しく振り分けられること', async () => {
    findMany.mockResolvedValueOnce([
      { themeId: 1, currentTaskId: 100 },
      { themeId: 2, currentTaskId: 200 },
    ]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      { id: 100, themeId: 1, parentId: null, status: 'in-progress', theme: devTheme },
      { id: 200, themeId: 2, parentId: null, status: 'in-progress', theme: devTheme },
      { id: 101, themeId: 1, parentId: null, status: 'todo', theme: devTheme },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result[0].autoRunCurrent).toBe(true);
    expect(result[1].autoRunCurrent).toBe(true);
    expect(result[2].autoRunQueued).toBe(true);
  });

  test('findMany は enabled+running のテーマのみを問い合わせること', async () => {
    findMany.mockResolvedValueOnce([]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      { id: 1, themeId: 1, parentId: null, status: 'todo', theme: devTheme },
    ];

    await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(findMany).toHaveBeenCalledTimes(1);
    const callArgs = findMany.mock.calls[0][0] as {
      where: { themeId: { in: number[] }; enabled: boolean; status: string };
    };
    expect(callArgs.where.themeId.in).toEqual([1]);
    expect(callArgs.where.enabled).toBe(true);
    expect(callArgs.where.status).toBe('running');
  });

  test('戻り値は入力と同一の配列参照であること（インプレース変更）', async () => {
    findMany.mockResolvedValueOnce([{ themeId: 1, currentTaskId: 1 }]);
    const tasks: TaskLikeForAutoRunCardStatus[] = [
      { id: 1, themeId: 1, parentId: null, status: 'todo', theme: devTheme },
    ];

    const result = await attachAutoRunCardStatus(buildPrisma(), tasks);

    expect(result).toBe(tasks);
  });
});
