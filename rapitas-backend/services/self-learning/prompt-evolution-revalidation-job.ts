/**
 * PromptEvolutionRevalidationJob
 *
 * Periodically re-checks `completed` prompt-evolution addenda for effect
 * regression (task #937 — 樹の信頼度が古いモデル/利用実態の上に成立していない
 * か). Two triggers: (1) a monthly cron (`forceAll`), and (2) a detected
 * `modelName` drift since the addendum's last check. Reuses
 * `decideSettlement`'s verdict rule so "regressed since settlement" and
 * "regressed since approval" share one definition of regression. Default OFF
 * (`RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED`) — see plan.md's rationale
 * (mirrors RAPITAS_PROMPT_AUTO_PROMOTE: automated re-scoring of a past
 * decision defaults to a human-supervised opt-in).
 */
import { createLogger } from '../../config/logger';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { evaluateRole, type RoleEvaluation } from './prompt-evolution-runner';
import { decideSettlement } from './prompt-evolution-settle';
import { createNotification } from '../communication/notification-service';
import { buildNotificationI18n } from '../communication/notification-i18n';
import {
  computeTreeConfidence,
  type SignificanceLevel,
  type TreeConfidence,
} from './prompt-evolution-tree';

const log = createLogger('self-learning:prompt-evolution-revalidation');

/** Escape hatch — default OFF (see module doc). */
export function revalidationEnabled(): boolean {
  return process.env.RAPITAS_PROMPT_TREE_REVALIDATION_ENABLED === 'true';
}

/** Minimum recent runs before a re-check verdict is trusted (matches SETTLE_MIN_RUNS). */
export const REVALIDATION_MIN_RUNS = 5;
/** Success-rate drop (absolute) at which a past improvement is flagged as regressed. */
export const REVALIDATION_REGRESSION_THRESHOLD = -0.05;
/** Lookback window for the fresh success-rate re-measurement. */
export const REVALIDATION_WINDOW_DAYS = 7;

interface RevalidationRow {
  id: number;
  basePromptKey: string | null;
  evidenceJson: string | null;
  lastRevalidatedModelVersion: string | null;
  abTested: boolean;
  significanceLevel: string | null;
}

/** Minimal Prisma surface the revalidation job needs (tests pass a fake). */
export interface RevalidationPrisma {
  promptEvolution: {
    findMany(args: unknown): Promise<RevalidationRow[]>;
    update(args: unknown): Promise<unknown>;
  };
  agentExecution: {
    findFirst(args: unknown): Promise<{ modelName: string | null } | null>;
  };
}

function parseEvidence(raw: string | null): { beforeRate?: number; successRate?: number } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as { beforeRate?: number; successRate?: number })
      : {};
  } catch {
    return {};
  }
}

/**
 * Look up the most recent model used by a role — the signal that decides
 * whether "model changed since last revalidation" fires.
 *
 * @param prisma - Prisma surface (real client or test fake). / Prisma
 * @param role - Workflow role name. / ロール名
 * @returns The latest modelName, or null when no execution exists yet. / 直近のモデル名
 */
async function lookupCurrentModelVersion(
  prisma: RevalidationPrisma,
  role: string,
): Promise<string | null> {
  try {
    const latest = await prisma.agentExecution.findFirst({
      where: { session: { mode: `workflow-${role}` } },
      orderBy: { createdAt: 'desc' },
      select: { modelName: true },
    });
    return latest?.modelName ?? null;
  } catch (err) {
    log.warn({ err, role }, '[revalidation] model-version lookup failed');
    return null;
  }
}

/**
 * Notify that a previously `completed` addendum has regressed on re-check.
 * Not exported — kept private so the notification shape stays in one place.
 *
 * @param id - PromptEvolution row id. / 対象ID
 * @param role - Workflow role name. / ロール名
 * @param delta - Success-rate delta measured at re-check. / 再検証時の差分
 */
async function notifyRegression(id: number, role: string, delta: number): Promise<void> {
  try {
    await createNotification({
      type: 'prompt_tree_regression',
      title: 'プロンプト改善の効果が再検証で劣化しました',
      message: `ロール「${role}」の承認済み改善(#${id})を再検証したところ、成功率が ${(delta * 100).toFixed(1)}pt 悪化していました。モデル/利用実態の変化により、この改善が現在は有効でない可能性があります。`,
      link: `/system-prompts`,
      metadata: { promptEvolutionId: id, role, delta },
      i18n: buildNotificationI18n('prompt_tree_regression', {
        role,
        delta: Number(delta.toFixed(4)),
      }),
    });
  } catch (err) {
    log.warn({ err, id, role }, '[revalidation] failed to create regression notification');
  }
}

export interface RevalidationSummary {
  /** Rows whose success rate was actually re-measured this run. */
  checked: number;
  /** Rows skipped because neither trigger applied (unforced run, model unchanged). */
  skipped: number;
  /** Rows where regression was detected and a notification was sent. */
  regressions: number;
}

/**
 * Re-check every `completed` PromptEvolution row for effect regression.
 *
 * @param prisma - Prisma surface (real client or test fake). / Prisma
 * @param forceAll - True for the monthly cron trigger — re-checks every row
 *   regardless of model drift. False for a lighter model-drift-only pass. / 全件強制フラグ
 * @param evaluate - Role evaluator (the runner's, injectable for tests). / ロール評価関数
 * @param now - Clock, injectable for tests. / 現在時刻
 * @returns Counts of checked/skipped/regressed rows. / 集計結果
 */
export async function revalidateCompletedEvolutions(
  prisma: RevalidationPrisma,
  forceAll: boolean,
  evaluate: (
    prisma: PrismaClient,
    role: string,
    since: Date,
  ) => Promise<Pick<RoleEvaluation, 'totalRuns' | 'successRate'>> = evaluateRole,
  now: () => Date = () => new Date(),
): Promise<RevalidationSummary> {
  if (!revalidationEnabled()) return { checked: 0, skipped: 0, regressions: 0 };

  const rows = await prisma.promptEvolution.findMany({
    where: { status: 'completed' },
    select: {
      id: true,
      basePromptKey: true,
      evidenceJson: true,
      lastRevalidatedModelVersion: true,
      abTested: true,
      significanceLevel: true,
    },
  });

  let checked = 0;
  let skipped = 0;
  let regressions = 0;

  for (const row of rows) {
    const role = row.basePromptKey?.replace(/^workflow_role_/, '');
    if (!role) continue;

    const currentModelVersion = await lookupCurrentModelVersion(prisma, role);
    const modelChanged =
      currentModelVersion !== null && currentModelVersion !== row.lastRevalidatedModelVersion;
    if (!forceAll && !modelChanged) {
      skipped++;
      continue;
    }

    const evidence = parseEvidence(row.evidenceJson);
    const beforeRate =
      typeof evidence.beforeRate === 'number'
        ? evidence.beforeRate
        : typeof evidence.successRate === 'number'
          ? evidence.successRate
          : 0;
    const since = new Date(now().getTime() - REVALIDATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    let fresh: Pick<RoleEvaluation, 'totalRuns' | 'successRate'>;
    try {
      fresh = await evaluate(prisma as unknown as PrismaClient, role, since);
    } catch (err) {
      log.warn({ err, id: row.id, role }, '[revalidation] evaluation failed — skipped');
      continue;
    }
    checked++;

    const { verdict, delta } = decideSettlement(
      beforeRate,
      fresh,
      REVALIDATION_MIN_RUNS,
      REVALIDATION_REGRESSION_THRESHOLD,
    );

    // treeConfidence is a derived cache (plan.md "有意性・信頼度の算出方針"),
    // recomputed at every revalidation pass. computeTreeConfidence has no
    // notion of "regressed on re-check" (its inputs — abTested/significance/
    // status — are unchanged here), so a detected regression forces the
    // cache down to 'low' explicitly rather than leaving a stale high/medium
    // confidence on an addendum just shown to no longer hold.
    const treeConfidence: TreeConfidence =
      verdict === 'reverted'
        ? 'low'
        : computeTreeConfidence({
            abTested: row.abTested,
            significanceLevel: row.significanceLevel as SignificanceLevel | null,
            status: 'completed',
          });

    await prisma.promptEvolution.update({
      where: { id: row.id },
      data: {
        lastRevalidatedAt: now(),
        lastRevalidatedModelVersion: currentModelVersion,
        treeConfidence,
      },
    });

    if (verdict === 'reverted') {
      regressions++;
      await notifyRegression(row.id, role, delta);
      log.info({ id: row.id, role, delta }, '[revalidation] regression detected');
    }
  }

  return { checked, skipped, regressions };
}

/** Outcome of a single manually-triggered revalidation (POST .../:id/revalidate). */
export type SingleRevalidationResult =
  | { status: 'not_found' }
  | { status: 'not_applicable' }
  | { status: 'insufficient_data'; treeConfidence: TreeConfidence; lastRevalidatedAt: Date }
  | { status: 'ok'; treeConfidence: TreeConfidence; lastRevalidatedAt: Date };

/**
 * Manually re-check one `completed` PromptEvolution row (POST
 * `/learning/prompt-evolution/:id/revalidate`). Unlike
 * `revalidateCompletedEvolutions`, this bypasses `revalidationEnabled()` and
 * the forceAll/model-drift gate entirely — an explicit human request always
 * runs, the default-OFF flag only governs unattended automation.
 *
 * @param prisma - Prisma surface (real client or test fake), plus `findUnique`. / Prisma
 * @param id - PromptEvolution row id. / 対象ID
 * @param evaluate - Role evaluator (the runner's, injectable for tests). / ロール評価関数
 * @param now - Clock, injectable for tests. / 現在時刻
 * @returns The outcome and, when applicable, the recomputed confidence. / 結果
 */
export async function revalidateSingleEvolution(
  prisma: RevalidationPrisma & {
    promptEvolution: RevalidationPrisma['promptEvolution'] & {
      findUnique(args: unknown): Promise<(RevalidationRow & { status: string }) | null>;
    };
  },
  id: number,
  evaluate: (
    prisma: PrismaClient,
    role: string,
    since: Date,
  ) => Promise<Pick<RoleEvaluation, 'totalRuns' | 'successRate'>> = evaluateRole,
  now: () => Date = () => new Date(),
): Promise<SingleRevalidationResult> {
  const row = await prisma.promptEvolution.findUnique({
    where: { id },
    select: {
      id: true,
      basePromptKey: true,
      evidenceJson: true,
      lastRevalidatedModelVersion: true,
      abTested: true,
      significanceLevel: true,
      status: true,
    },
  });
  if (!row) return { status: 'not_found' };
  const role = row.basePromptKey?.replace(/^workflow_role_/, '');
  if (!role || row.status !== 'completed') return { status: 'not_applicable' };

  const currentModelVersion = await lookupCurrentModelVersion(prisma, role);
  const evidence = parseEvidence(row.evidenceJson);
  const beforeRate =
    typeof evidence.beforeRate === 'number'
      ? evidence.beforeRate
      : typeof evidence.successRate === 'number'
        ? evidence.successRate
        : 0;
  const since = new Date(now().getTime() - REVALIDATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const fresh = await evaluate(prisma as unknown as PrismaClient, role, since);
  const { verdict, delta } = decideSettlement(
    beforeRate,
    fresh,
    REVALIDATION_MIN_RUNS,
    REVALIDATION_REGRESSION_THRESHOLD,
  );

  if (fresh.totalRuns < REVALIDATION_MIN_RUNS) {
    const treeConfidence = computeTreeConfidence({
      abTested: row.abTested,
      significanceLevel: row.significanceLevel as SignificanceLevel | null,
      status: 'completed',
    });
    const lastRevalidatedAt = now();
    await prisma.promptEvolution.update({
      where: { id: row.id },
      data: { lastRevalidatedAt, lastRevalidatedModelVersion: currentModelVersion, treeConfidence },
    });
    return { status: 'insufficient_data', treeConfidence, lastRevalidatedAt };
  }

  const treeConfidence: TreeConfidence =
    verdict === 'reverted'
      ? 'low'
      : computeTreeConfidence({
          abTested: row.abTested,
          significanceLevel: row.significanceLevel as SignificanceLevel | null,
          status: 'completed',
        });
  const lastRevalidatedAt = now();
  await prisma.promptEvolution.update({
    where: { id: row.id },
    data: { lastRevalidatedAt, lastRevalidatedModelVersion: currentModelVersion, treeConfidence },
  });

  if (verdict === 'reverted') {
    await notifyRegression(row.id, role, delta);
    log.info({ id: row.id, role, delta }, '[revalidation] manual regression detected');
  }

  return { status: 'ok', treeConfidence, lastRevalidatedAt };
}
