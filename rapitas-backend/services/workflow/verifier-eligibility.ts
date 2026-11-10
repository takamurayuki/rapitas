/**
 * verifier-eligibility
 *
 * Decides whether the verify phase's verdict may count as a verification at
 * the completion gate: the model that ran the verifier / auto_verifier phase
 * must be one the tier table allows to review (registered, current, review
 * column) and at least the executor's tier (追補5: レビュー役 ≧ 実行役). A
 * verdict from any other model is HELD for a human (review-hold.ts) instead
 * of completing the task. Not responsible for choosing the verifier's model
 * (role-route-inputs.ts) — routing may still run an ineligible model when
 * nothing eligible is usable; this gate is what keeps that run from passing.
 *
 * The verifier's model is read from its run, newest first:
 *  1. the model the run REPORTED (AgentExecution.modelName, set when it ends);
 *  2. while it is still running (verify.md is usually PUT mid-run), the model
 *     it was launched with: the role's explicit model, else the route pin.
 * No model from either → unverified → held.
 */
import { createLogger } from '../../config/logger';
import { NOT_REVIEW_COST_ROW } from '../agents/review-cost-rows';
import { findModelEntry, tierAtLeast } from '../ai/model-tier-table/tier-table';
import type { ExecutorRef } from '../ai/model-tier-table/seat-planner';
import { REVIEW_ROLES } from './review-floor';

const log = createLogger('workflow:verifier-eligibility');

/** Must match model-route-stability.ts's EVENT_TYPE and correlation format. */
const PIN_EVENT_TYPE = 'model_route_pin';

/** Outcome of the eligibility check. */
export type VerifierEligibility =
  /** No verifier-role run exists (e.g. verify.md written by a human): nothing to judge. */
  | { status: 'no_verifier_run' }
  | { status: 'eligible'; role: string; model: string; executor: ExecutorRef }
  | {
      status: 'ineligible' | 'unverified';
      role: string;
      model: string | null;
      executor: ExecutorRef | null;
      /** One-line reason shown on the hold. */
      reason: string;
    }
  /** The record could not be read; the gate fails open, like the other verify gates. */
  | { status: 'lookup_failed' };

/** A dated snapshot (`…-20261101`) is judged as the row it snapshots. */
function entryOf(model: string) {
  return findModelEntry(model) ?? findModelEntry(model.replace(/-\d{8}$/, ''));
}

async function launchedModel(taskId: number, role: string): Promise<string | null> {
  const { prisma } = await import('../../config/database');
  const roleConfig = await prisma.workflowRoleConfig
    .findFirst({ where: { role }, select: { modelId: true } })
    .catch(() => null);
  // Same "explicit model" rule as role-route-inputs' shouldAutoSelectModel.
  const explicit = roleConfig?.modelId?.trim();
  if (explicit && explicit !== 'auto') return explicit;
  const { queryEvents } = await import('../memory/timeline');
  const { events } = await queryEvents({
    eventType: PIN_EVENT_TYPE,
    correlationId: `route_${taskId}_${role}`,
    limit: 1,
  });
  const payload = events[0]?.payload;
  const parsed = (typeof payload === 'string' ? JSON.parse(payload) : payload) as {
    decision?: { recommendedModel?: unknown };
  } | null;
  const model = parsed?.decision?.recommendedModel;
  return typeof model === 'string' && model.trim() ? model : null;
}

/**
 * Judge the newest verifier-role run of a task.
 *
 * @param taskId - Task whose verify.md is being completed / タスクID
 * @returns The judgement / 判定
 */
export async function judgeVerifierEligibility(taskId: number): Promise<VerifierEligibility> {
  try {
    const { prisma } = await import('../../config/database');
    const run = await prisma.agentExecution.findFirst({
      where: {
        ...NOT_REVIEW_COST_ROW,
        session: {
          mode: { in: [...REVIEW_ROLES].map((r) => `workflow-${r}`) },
          config: { taskId },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { modelName: true, session: { select: { mode: true } } },
    });
    if (!run) return { status: 'no_verifier_run' };
    const role = (run.session?.mode ?? 'workflow-verifier').replace(/^workflow-/, '');
    const model = run.modelName?.trim() || (await launchedModel(taskId, role));
    if (!model) {
      return {
        status: 'unverified',
        role,
        model: null,
        executor: null,
        reason: `${role} がどのモデルで動いたかを実行記録から確認できない`,
      };
    }
    const { resolveExecutor } = await import('../ai/model-tier-table/executor-model');
    const executor = await resolveExecutor(taskId);
    const entry = entryOf(model);
    if (!entry) {
      return {
        status: 'ineligible',
        role,
        model,
        executor,
        reason: `${role} のモデル ${model} はティア表に登録がなく、レビューに置けない`,
      };
    }
    if (entry.status !== 'current' || !entry.roles.review) {
      return {
        status: 'ineligible',
        role,
        model,
        executor,
        reason: `${role} のモデル ${model}（${entry.tier}）はティア表でレビュー不可`,
      };
    }
    if (executor.tier !== 'free' && !tierAtLeast(entry.tier, executor.tier)) {
      const who = executor.verified
        ? `実行役 ${executor.modelId}（${executor.tier}）`
        : '実行役（実行記録で未確認のため premium とみなす）';
      return {
        status: 'ineligible',
        role,
        model,
        executor,
        reason: `${role} のモデル ${model}（${entry.tier}）が${who}を下回る`,
      };
    }
    return { status: 'eligible', role, model, executor };
  } catch (err) {
    log.warn({ err, taskId }, '[verifier-eligibility] run record unreadable — gate fails open');
    return { status: 'lookup_failed' };
  }
}

/**
 * Hold the task for a human when its verify verdict came from an ineligible
 * or unverified verifier. A no-op for an eligible verifier, no verifier run,
 * or an unreadable record.
 *
 * @param p.taskId - Task / タスクID
 * @param p.fromStatus - Workflow status the caller evaluated / 評価時の状態
 * @param p.source - Which gate / どのゲートか
 * @param p.sessionId - Session for the transition record / セッションID
 * @returns 'held' / 'cas_lost' when the verdict must not be used, 'ok' otherwise / 結果
 */
export async function holdIfVerifierIneligible(p: {
  taskId: number;
  fromStatus?: string;
  source: 'http_save' | 'cli_epilogue';
  sessionId?: number;
}): Promise<{ outcome: 'ok' | 'held' | 'cas_lost'; judgement: VerifierEligibility }> {
  const judgement = await judgeVerifierEligibility(p.taskId);
  if (judgement.status !== 'ineligible' && judgement.status !== 'unverified') {
    return { outcome: 'ok', judgement };
  }
  log.warn(
    { taskId: p.taskId, ...judgement, source: p.source },
    '[verifier-eligibility] verify verdict is not an eligible verification — holding for a human',
  );
  const { holdForHumanReview } = await import('./review-hold');
  const outcome = await holdForHumanReview({
    taskId: p.taskId,
    fromStatus: p.fromStatus,
    reason: 'ineligible_verifier',
    detail: judgement.reason,
    findings: [],
    source: p.source,
    sessionId: p.sessionId,
    extra: {
      verifierRole: judgement.role,
      verifierModel: judgement.model,
      executorModel: judgement.executor?.modelId ?? null,
      executorVerified: judgement.executor?.verified ?? null,
    },
  });
  return { outcome, judgement };
}
