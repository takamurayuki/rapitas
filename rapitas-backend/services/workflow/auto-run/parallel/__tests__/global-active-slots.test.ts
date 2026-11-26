/** 先頭・同伴共通の枠計数の境界を確認する。 */
import { expect, test } from 'bun:test';
import type { PrismaClient } from '../../../../../generated/prisma-postgres';
import { countGlobalActiveSlots } from '../global-active-slots';
import { fakeThemeAutoRun, runningRow } from './fake-theme-auto-run.test-support';

test.each([
  { status: 'running', live: [], queue: 0, expected: 2 },
  { status: 'paused_user', live: [], queue: 0, expected: 0 },
  { status: 'paused_approval', live: [], queue: 1, expected: 1 },
  { status: 'stopping', live: [20], queue: 0, expected: 1 },
  { status: 'idle', live: [], queue: 0, expected: 0 },
  { status: 'running', live: [], queue: 3, expected: 3 },
])('$status: キュー$queue・生存$liveなら$expected枠', async ({ status, live, queue, expected }) => {
  const fake = fakeThemeAutoRun([
    runningRow({ status, currentTaskId: 10, companionTasksJson: '[{"taskId":20,"since":1}]' }),
  ]);
  const db = {
    themeAutoRun: fake.model,
    agentExecution: {
      findMany: async () => live.map((taskId) => ({ session: { config: { taskId } } })),
    },
  } as unknown as PrismaClient;
  expect(await countGlobalActiveSlots(db, queue)).toBe(expected);
});

test('生存照会に失敗した停止中の枠は安全側に数える', async () => {
  const fake = fakeThemeAutoRun([runningRow({ status: 'paused_user', currentTaskId: 10 })]);
  const db = {
    themeAutoRun: fake.model,
    agentExecution: {
      findMany: async () => {
        throw new Error('DB');
      },
    },
  } as unknown as PrismaClient;
  expect(await countGlobalActiveSlots(db, 0)).toBe(1);
});
