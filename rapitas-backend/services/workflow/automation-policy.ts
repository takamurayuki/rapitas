/**
 * automation-policy
 *
 * `autoCommit` / `autoCreatePR` / `autoMergePR` の有効値をタスク単位で解決する。
 * 解決順序:
 *   1. タスク個別の `Task.autoCommit/autoCreatePR/autoMergePR` (Prisma に追加されていれば)
 *   2. ワークフロー設定 (`WorkflowAutomationSettings`)（将来追加予定）
 *   3. 環境変数フォールバック (`RAPITAS_DEFAULT_AUTO_*`)
 *   4. ハードコード default (false)
 *
 * 自動化判断は `routes/workflow/workflow-auto-commit.ts` がここを呼ぶことで一元化される。
 */

import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:automation-policy');

/**
 * 解決後の自動化設定。verify_done → completed の自動進行をどこまで進めるかを表す。
 */
export interface ResolvedAutomationPolicy {
  /** verify_done 後に自動 commit するか */
  autoCommit: boolean;
  /** commit 後に自動で gh pr create するか */
  autoCreatePR: boolean;
  /** PR 作成後 CI 通過したら自動 merge するか */
  autoMergePR: boolean;
  /** どのソースで決まったかの診断情報 */
  source: {
    autoCommit: 'task' | 'env' | 'default';
    autoCreatePR: 'task' | 'env' | 'default';
    autoMergePR: 'task' | 'env' | 'default';
  };
}

/**
 * タスク ID から自動化ポリシーを解決する。
 *
 * @param prisma - Prisma クライアント
 * @param taskId - 対象タスク ID
 * @returns 解決後の `autoCommit / autoCreatePR / autoMergePR` 値と source
 */
export async function resolveAutomationPolicy(
  prisma: PrismaClient,
  taskId: number,
): Promise<ResolvedAutomationPolicy> {
  // Task model にカラムが追加されたらここで読み出す。現状はスキーマ追加待ち。
  const task = (await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  })) as {
    id: number;
    autoCommit?: boolean | null;
    autoCreatePR?: boolean | null;
    autoMergePR?: boolean | null;
  } | null;

  const envBoolean = (key: string): boolean | null => {
    const raw = process.env[key];
    if (raw === undefined) return null;
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return null;
  };

  const envAutoCommit = envBoolean('RAPITAS_DEFAULT_AUTO_COMMIT');
  const envAutoCreatePR = envBoolean('RAPITAS_DEFAULT_AUTO_CREATE_PR');
  const envAutoMergePR = envBoolean('RAPITAS_DEFAULT_AUTO_MERGE_PR');

  const resolveOne = <T extends 'autoCommit' | 'autoCreatePR' | 'autoMergePR'>(
    key: T,
    envValue: boolean | null,
    fallback: boolean,
  ): { value: boolean; source: 'task' | 'env' | 'default' } => {
    const taskValue = task?.[key];
    if (typeof taskValue === 'boolean') return { value: taskValue, source: 'task' };
    if (envValue !== null) return { value: envValue, source: 'env' };
    return { value: fallback, source: 'default' };
  };

  const ac = resolveOne('autoCommit', envAutoCommit, false);
  const acpr = resolveOne('autoCreatePR', envAutoCreatePR, false);
  const ampr = resolveOne('autoMergePR', envAutoMergePR, false);

  log.debug(
    {
      taskId,
      autoCommit: ac.value,
      autoCreatePR: acpr.value,
      autoMergePR: ampr.value,
      sources: { autoCommit: ac.source, autoCreatePR: acpr.source, autoMergePR: ampr.source },
    },
    '[automation-policy] resolved policy',
  );

  return {
    autoCommit: ac.value,
    autoCreatePR: acpr.value,
    autoMergePR: ampr.value,
    source: {
      autoCommit: ac.source,
      autoCreatePR: acpr.source,
      autoMergePR: ampr.source,
    },
  };
}
