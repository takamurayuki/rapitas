/**
 * self-detect-relevance.test
 *
 * Fixtures are real titles from 2026-08-30's no-change wave (#776/#780/#749).
 * Run this file on its own: bun's mock.module is process-global.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { parseSelfDetectSignature, isSelfDetectConcernStillRelevant } =
  await import('./self-detect-relevance');

const MISMATCH =
  '[Bug] [自己検出] 状態不整合: #560「タスク実行時間の正確な計測」— task.status=todo のまま workflowStatus が前進済み(verify_done)';
const LOOP = '[Bug] [自己検出] 反復ループ: #603「[Idea] 段階的変換」で cause=verify_repair が3回';

describe('parseSelfDetectSignature', () => {
  test('状態不整合とアンカーを解析する', () => {
    expect(parseSelfDetectSignature(MISMATCH)).toEqual({
      kind: 'state_mismatch',
      anchorTaskId: 560,
      cause: null,
    });
  });
  test('反復ループは cause も取り出す', () => {
    expect(parseSelfDetectSignature(LOOP)).toEqual({
      kind: 'repeat_loop',
      anchorTaskId: 603,
      cause: 'verify_repair',
    });
  });
  test('アンカーが detail の対象タスク欄にしか無い場合も解析する（#787）', () => {
    const title =
      '[Bug] [自己検出] 状態不整合: task.status=todo のまま workflowStatus が前進済み(research_done)';
    const detail = [
      '## 概要',
      '状態が矛盾。',
      '',
      '## 対象タスク',
      '- #784「枯渇アイドルタイマー」',
    ].join('\n');
    expect(parseSelfDetectSignature(title, detail)).toEqual({
      kind: 'state_mismatch',
      anchorTaskId: 784,
      cause: null,
    });
  });

  test('自己検出以外・回顧は対象外（null）', () => {
    expect(parseSelfDetectSignature('[Concern] [回顧] 修復ループ: 診断してください')).toBeNull();
    expect(parseSelfDetectSignature('[ログ:ERROR] 何か')).toBeNull();
  });
});

describe('isSelfDetectConcernStillRelevant', () => {
  const created = new Date('2026-08-30T12:00:00+09:00');

  test('状態不整合: 不整合が解消済みなら false（退役）', async () => {
    const r = await isSelfDetectConcernStillRelevant(
      { title: MISMATCH, createdAt: created },
      {
        getTaskState: async () => ({ status: 'done', workflowStatus: 'completed' }),
        countCauseSince: async () => 0,
      },
    );
    expect(r).toBe(false);
  });

  test('状態不整合: いまも todo×前進済みなら true（起票する）', async () => {
    const r = await isSelfDetectConcernStillRelevant(
      { title: MISMATCH, createdAt: created },
      {
        getTaskState: async () => ({ status: 'todo', workflowStatus: 'verify_done' }),
        countCauseSince: async () => 0,
      },
    );
    expect(r).toBe(true);
  });

  test('反復ループ: 起票後に同 cause が再発していなければ false', async () => {
    const r = await isSelfDetectConcernStillRelevant(
      { title: LOOP, createdAt: created },
      { getTaskState: async () => null, countCauseSince: async () => 0 },
    );
    expect(r).toBe(false);
  });

  test('反復ループ: 再発していれば true', async () => {
    const r = await isSelfDetectConcernStillRelevant(
      { title: LOOP, createdAt: created },
      { getTaskState: async () => null, countCauseSince: async () => 2 },
    );
    expect(r).toBe(true);
  });

  test('アンカー無し・照会失敗・回顧は null（fail open）', async () => {
    expect(
      await isSelfDetectConcernStillRelevant({
        title:
          '[Bug] [自己検出] 状態不整合: task.status=todo のまま workflowStatus が前進済み(verify_done)',
        createdAt: created,
      }),
    ).toBeNull();
    expect(
      await isSelfDetectConcernStillRelevant(
        { title: MISMATCH, createdAt: created },
        {
          getTaskState: async () => {
            throw new Error('db down');
          },
          countCauseSince: async () => 0,
        },
      ),
    ).toBeNull();
    expect(
      await isSelfDetectConcernStillRelevant({ title: '[回顧] 診断', createdAt: created }),
    ).toBeNull();
  });
});
