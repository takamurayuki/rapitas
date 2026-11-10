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
 * Only the model the run REPORTED (AgentExecution.modelName, written when the
 * run ends) counts. What it was launched with (the role's explicit model, the
 * route pin) is a plan, not evidence: a run planned as Opus may have fallen
 * back to another model (G2 routing1 re-review item 5).
 *  - Still running and not reported yet (verify.md is usually PUT mid-run):
 *    the decision is DEFERRED — completion is withheld and the run's epilogue
 *    (or the manual post-run settle) judges again once the model is reported.
 *  - Ended without a report: unverified → held.
 *  - Record unreadable: the gate STOPS (held when the hold can be written,
 *    stopped either way) — "could not check" never allows completion.
 */
import { createLogger } from '../../config/logger';
import { NOT_REVIEW_COST_ROW } from '../agents/review-cost-rows';
import { findModelEntry, tierAtLeast } from '../ai/model-tier-table/tier-table';
import type { ExecutorRef } from '../ai/model-tier-table/seat-planner';
import { REVIEW_ROLES } from './review-floor';
import type { CompletionCheckSource } from './verifier-completion-check';

const log = createLogger('workflow:verifier-eligibility');

/** Transition cause of a completion withheld until the verifier's model is reported. */
export const VERIFIER_ELIGIBILITY_DEFERRED_CAUSE = 'verifier_eligibility_deferred';

/** Run statuses in which a missing modelName only means "not reported YET". */
const LIVE_RUN_STATUSES = new Set(['pending', 'running', 'waiting_for_input']);

/**
 * When the check runs: `in_run` = the HTTP verify.md save while the verifier
 * may still be running; `after_run` = the run has ended and saved its result.
 */
export type EligibilityPhase = 'in_run' | 'after_run';

/** Outcome of the eligibility check. */
export type VerifierEligibility =
  /** No verifier-role run exists (e.g. verify.md written by a human): nothing to judge. */
  | { status: 'no_verifier_run' }
  | { status: 'eligible'; role: string; model: string; executor: ExecutorRef }
  /** The run is live and has not reported its model yet: judge again after it ends. */
  | { status: 'unreported'; role: string; model: null; executor: null; reason: string }
  | {
      status: 'ineligible' | 'unverified';
      role: string;
      model: string | null;
      executor: ExecutorRef | null;
      /** One-line reason shown on the hold. */
      reason: string;
    }
  /** The record could not be read; the gate stops. */
  | { status: 'lookup_failed'; role: null; model: null; executor: null; reason: string };

/** A dated snapshot (`…-20261101`) is judged as the row it snapshots. */
function entryOf(model: string) {
  return findModelEntry(model) ?? findModelEntry(model.replace(/-\d{8}$/, ''));
}

/**
 * Judge the newest verifier-role run of a task.
 *
 * @param taskId - Task whose verify.md is being completed / タスクID
 * @param phase - Whether the run may still be live (default after_run) / 実行中か実行後か
 * @returns The judgement / 判定
 */
export async function judgeVerifierEligibility(
  taskId: number,
  phase: EligibilityPhase = 'after_run',
): Promise<VerifierEligibility> {
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
      select: { modelName: true, status: true, session: { select: { mode: true } } },
    });
    if (!run) return { status: 'no_verifier_run' };
    const role = (run.session?.mode ?? 'workflow-verifier').replace(/^workflow-/, '');
    const model = run.modelName?.trim();
    if (!model) {
      if (phase === 'in_run' && LIVE_RUN_STATUSES.has(run.status ?? '')) {
        return {
          status: 'unreported',
          role,
          model: null,
          executor: null,
          reason: `${role} の実行が実際のモデルをまだ報告していない`,
        };
      }
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
    log.warn({ err, taskId }, '[verifier-eligibility] run record unreadable — gate stops');
    return {
      status: 'lookup_failed',
      role: null,
      model: null,
      executor: null,
      reason: '検証役の実行記録を読めず、適格性を確認できない',
    };
  }
}

/** What the caller must do: only 'ok' lets the verdict proceed to completion. */
export type EligibilityGateOutcome = 'ok' | 'held' | 'cas_lost' | 'deferred' | 'unreadable';

/**
 * Stop the verdict from counting unless its verifier is confirmed eligible:
 * defer while the model is not reported yet, hold for a human when the
 * verifier is ineligible / unverified / unreadable. A no-op only for an
 * eligible verifier or when no verifier run exists.
 *
 * @param p.taskId - Task / タスクID
 * @param p.fromStatus - Workflow status the caller evaluated / 評価時の状態
 * @param p.source - Which gate / どのゲートか
 * @param p.sessionId - Session for the transition record / セッションID
 * @param p.phase - in_run (HTTP save) or after_run (default) / 実行中か実行後か
 * @returns 'ok' only when the verdict may be used; anything else means stop / 結果
 */
export async function holdIfVerifierIneligible(p: {
  taskId: number;
  fromStatus?: string;
  source: 'http_save' | 'cli_epilogue' | 'manual_settle' | CompletionCheckSource;
  sessionId?: number;
  phase?: EligibilityPhase;
}): Promise<{ outcome: EligibilityGateOutcome; judgement: VerifierEligibility }> {
  const judgement = await judgeVerifierEligibility(p.taskId, p.phase ?? 'after_run');
  if (judgement.status === 'eligible' || judgement.status === 'no_verifier_run') {
    return { outcome: 'ok', judgement };
  }
  if (judgement.status === 'unreported') {
    log.info(
      { taskId: p.taskId, role: judgement.role, source: p.source },
      '[verifier-eligibility] verifier model not reported yet — completion deferred until the run ends',
    );
    const { recordTransition } = await import('./transition-recorder');
    // Best-effort record: the deferral itself is the stop, not this row.
    await recordTransition({
      taskId: p.taskId,
      fromStatus: p.fromStatus ?? 'verify_done',
      toStatus: p.fromStatus ?? 'verify_done',
      actor: 'system',
      cause: VERIFIER_ELIGIBILITY_DEFERRED_CAUSE,
      phase: 'verify',
      sessionId: p.sessionId,
      metadata: { verifierRole: judgement.role, source: p.source },
    }).catch(() => {});
    return { outcome: 'deferred', judgement };
  }
  log.warn(
    { taskId: p.taskId, ...judgement, source: p.source },
    '[verifier-eligibility] verify verdict is not an eligible verification — holding for a human',
  );
  const { holdForHumanReview } = await import('./review-hold');
  const held = await holdForHumanReview({
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
  }).catch((err: unknown) => {
    log.warn(
      { err, taskId: p.taskId },
      '[verifier-eligibility] hold write failed — still stopping',
    );
    return 'cas_lost' as const;
  });
  // An unreadable record is a stop even when the hold was written: the caller
  // must never read it as "checked and fine".
  return { outcome: judgement.status === 'lookup_failed' ? 'unreadable' : held, judgement };
}
