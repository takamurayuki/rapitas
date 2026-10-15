/**
 * task-iteration-budget window-reset-causes テスト
 *
 * 窓リセット原因の一覧は非公開なので、`resolveIterationWindowStart` が
 * WorkflowTransition に投げる `cause.in` を捕まえて配線を検証する。
 *
 * `halt_released` がこの一覧に入っていることは halt 解除機能の要である。
 * 入っていないと、解除しても次のスケジューラ tick が同じ消費額を読み直して
 * 即座に再停止する — #996(2026-09-20)で実際に起きた失敗と同型。
 *
 * bun の mock.module はプロセス全体に効くため、このファイルは単独で実行する。
 */
import { describe, test, expect, mock } from 'bun:test';

/** Captures the `where` passed to workflowTransition.findFirst. */
const findFirstCalls: Array<{ where?: { cause?: { in?: string[] } } }> = [];

mock.module('../../config/database', () => ({
  prisma: {
    workflowTransition: {
      findFirst: async (args: { where?: { cause?: { in?: string[] } } }) => {
        findFirstCalls.push(args);
        return null;
      },
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: async () => ({ id: 1, outcome: 'created' }),
}));

const { resolveIterationWindowStart } = await import('./task-iteration-budget');
const { HALT_RELEASED_CAUSE } = await import('./halt-release');

describe('resolveIterationWindowStart — 窓をリセットする原因', () => {
  test('halt 解除は窓リセット原因に含まれる（解除直後の再停止を防ぐ）', async () => {
    findFirstCalls.length = 0;
    await resolveIterationWindowStart(1110);

    const causes = findFirstCalls[0]?.where?.cause?.in;
    expect(causes).toBeDefined();
    expect(causes).toContain(HALT_RELEASED_CAUSE);
  });

  test('既存のリセット原因も維持されている', async () => {
    findFirstCalls.length = 0;
    await resolveIterationWindowStart(996);

    const causes = findFirstCalls[0]?.where?.cause?.in ?? [];
    expect(causes).toContain('task_retried');
    expect(causes).toContain('question_resolved');
    expect(causes).toContain('plan_invalid_replan');
  });
});
