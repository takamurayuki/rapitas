/**
 * session-mode テスト
 *
 * セッションの mode の読み書きが、失敗を握りつぶさないことを固定する（G2 routing1
 * 再レビュー7 P1：execute-route は mode の保存に失敗しても警告だけで実行を続け、
 * success-execution-handler は読み取りの失敗を mode が null の行と同じに扱った）。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
let failures = 0;
const update = mock(async (_args: { where: { id: number }; data: Record<string, unknown> }) => {
  if (failures > 0) {
    failures -= 1;
    throw new Error('db down');
  }
  return {};
});
let findUnique: () => Promise<{ mode: string | null } | null> = async () => ({ mode: null });
mock.module('../../../../config/database', () => ({
  prisma: { agentSession: { update, findUnique: () => findUnique() } },
}));

const { readSessionMode, tagSessionWorkflowRole } = await import('./session-mode');

beforeEach(() => {
  failures = 0;
  update.mockClear();
});

test('保存できたら true を返し、mode に workflow-<role> を書く', async () => {
  expect(await tagSessionWorkflowRole(5, 'researcher')).toBe(true);
  expect(update).toHaveBeenCalledWith({ where: { id: 5 }, data: { mode: 'workflow-researcher' } });
});

test('一度失敗しても再試行で保存できれば true を返す', async () => {
  failures = 1;
  expect(await tagSessionWorkflowRole(5, 'implementer')).toBe(true);
  expect(update).toHaveBeenCalledTimes(2);
});

test('保存できなければ false を返す（呼び出し元は実行を始めない）', async () => {
  failures = 10;
  expect(await tagSessionWorkflowRole(5, 'implementer')).toBe(false);
});

test.each([
  ['mode が null の行', async () => ({ mode: null }), null],
  ['workflow の行', async () => ({ mode: 'workflow-planner' }), 'workflow-planner'],
  ['行がない', async () => null, undefined],
  [
    '読み取りに失敗',
    async () => {
      throw new Error('db down');
    },
    undefined,
  ],
] as const)('readSessionMode：%s', async (_label, read, expected) => {
  findUnique = read;
  expect(await readSessionMode(5)).toBe(expected);
});
