/**
 * Fault Scenario: PR-Creation Response Loss
 *
 * If a PR was created successfully but the caller never saw the response
 * (network drop), a retry must find the existing PR instead of creating a
 * duplicate. Simulates this against a minimal in-memory fake of the
 * pr-duplicate-guard's Prisma surface — the same claim/find/release contract
 * used in production (services/github/pr-duplicate-guard.ts) — since driving
 * this through a real `gh pr create` call would touch actual GitHub state.
 */
import {
  claimPrCreationLock,
  findOpenPrForTask,
  releasePrCreationLock,
} from '../../services/github/pr-duplicate-guard';
import type { ScenarioContext, ScenarioResult } from './common';

interface FakeTaskRow {
  id: number;
  updatedAt: Date;
  prCreationLockedAt: Date | null;
}

/**
 * Builds a fake Prisma client exposing only the surface pr-duplicate-guard /
 * updateTaskPublicationMetadata touch, backed by an in-memory task + PR record.
 *
 * @param task - The task row to back the fake store / バックする擬似タスク行
 * @param existingPr - A previously-created PR to simulate the "response lost after success" state / 応答喪失前に作成済みのPR
 */
function makeFakePrisma(task: FakeTaskRow, existingPr: { prNumber: number; url: string } | null) {
  return {
    task: {
      findUnique: async () => ({ updatedAt: task.updatedAt }),
      updateMany: async (args: {
        where: {
          id: number;
          updatedAt: Date;
          OR?: Array<{ prCreationLockedAt: null | { lt: Date } }>;
        };
        data: { prCreationLockedAt?: Date | null };
      }) => {
        const orOk =
          !args.where.OR ||
          args.where.OR.some((cond) =>
            cond.prCreationLockedAt === null
              ? task.prCreationLockedAt === null
              : task.prCreationLockedAt !== null &&
                task.prCreationLockedAt < cond.prCreationLockedAt!.lt,
          );
        if (
          args.where.id === task.id &&
          args.where.updatedAt.getTime() === task.updatedAt.getTime() &&
          orOk
        ) {
          if (args.data.prCreationLockedAt !== undefined) {
            task.prCreationLockedAt = args.data.prCreationLockedAt;
          }
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    gitHubPullRequest: {
      findFirst: async () => (existingPr ? { ...existingPr } : null),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake matches only the narrow surface pr-duplicate-guard calls; a full PrismaClient type is unnecessary here.
  } as any;
}

/**
 * Runs the pr-response-loss fault scenario.
 *
 * @param _ctx - Unused; scenario is self-contained / 未使用（自己完結）
 * @returns Scenario result / シナリオ結果
 */
export async function run(_ctx: ScenarioContext): Promise<ScenarioResult> {
  const task: FakeTaskRow = { id: 999001, updatedAt: new Date(), prCreationLockedAt: null };
  const existingPr = { prNumber: 4242, url: 'https://github.com/example/repo/pull/4242' };
  const prisma = makeFakePrisma(task, existingPr);

  // A retry after the response was lost must see the already-created PR
  // BEFORE attempting to claim the lock again, so it never re-creates.
  const found = await findOpenPrForTask(prisma, task.id);
  if (!found || found.prNumber !== existingPr.prNumber) {
    return {
      name: 'pr-response-loss',
      passed: false,
      detail: 'retry did not find the already-created PR — would have created a duplicate',
    };
  }

  const claimed = await claimPrCreationLock(prisma, task.id);
  await releasePrCreationLock(prisma, task.id);

  return {
    name: 'pr-response-loss',
    passed: true,
    detail: `retry found existing PR #${found.prNumber} before claiming lock (claimed=${claimed})`,
  };
}
