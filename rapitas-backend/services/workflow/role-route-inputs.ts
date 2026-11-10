/**
 * role-route-inputs
 *
 * Single source of truth for "which model should this workflow role run on?".
 * Gathers every routing SIGNAL (risk, per-task retries, theme trouble,
 * evidence-proven tier, provider preferences), turns them into SmartRouter
 * inputs, and returns the chosen model.
 *
 * Shared deliberately: the auto-run orchestrator and the manual `/agents/execute`
 * route both call this. They used to compute their inputs separately, and the
 * manual path skipped the floors entirely — measured 2026-08-23, the same phase
 * of the same task resolved to a different model depending on which button
 * started it, and a manual run of high-risk work never got its premium floor.
 */
import { createLogger } from '../../config/logger';
import { readWorkflowFile } from './workflow-file-utils';
import type { Provider } from '../ai/model-discovery/types';
import type { RouteShortfall } from '../ai/route-shortfall';
import { raiseFloorToExecutor, REVIEW_ROLES } from './review-floor';

const log = createLogger('role-route-inputs');

/** The task fields routing needs. Accepts any richer record. */
export interface RoleRouteTask {
  title: string;
  description?: string | null;
  labels?: unknown;
  themeId?: number | null;
}

/** Outcome of a routing decision. */
export interface RoleRouteResult {
  /** Model id to run with. Never empty — falls back to the `sonnet` alias. */
  modelId: string;
  /** Structured log/audit payload describing how it was chosen. */
  details: Record<string, unknown>;
  /**
   * Set when the chosen model misses the route's requirement (floor, role
   * suitability, no candidates, excluded provider). The phase may still run —
   * that is the caller's decision — but a review role's verdict on such a
   * model is not accepted as a verification (verifier-eligibility.ts).
   */
  constraintShortfall?: RouteShortfall;
  /** True when routing itself failed and `modelId` is the bare fallback alias. */
  routingFailed?: boolean;
}

/**
 * Roles whose floor counts verified capability bounces as retries. A bounce
 * rejects the implementer's diff; review roles follow it up through
 * raiseFloorToExecutor rather than escalating on their own.
 */
const REPAIR_ESCALATED_ROLES = new Set(['implementer']);

/** Roles whose routing also inspects plan.md for risky planned file paths. */
const PLAN_AWARE_ROLES = new Set(['implementer', 'verifier', 'auto_verifier']);

/**
 * Whether a role's configured modelId means "let the router decide".
 *
 * NOTE: null / empty are treated as auto, matching role-resolver. The
 * orchestrator previously read null as "use the agent config's default model",
 * which silently pinned planner and verifier to a premium model and bypassed
 * every floor and evidence check — 15% of measured spend never reached the
 * router. Both paths now agree on this one rule.
 *
 * @param roleModelId - WorkflowRoleConfig.modelId. / ロール設定のモデルID
 * @returns true when SmartRouter should pick. / 自動選択すべきなら true
 */
export function shouldAutoSelectModel(roleModelId: string | null | undefined): boolean {
  return !roleModelId || roleModelId.trim() === '' || roleModelId === 'auto';
}

/**
 * Pick the model for one workflow phase.
 *
 * Never throws: any failure resolves to the bare `sonnet` alias (the CLI maps
 * it to the current release, so it cannot go stale like a pinned id).
 *
 * @param opts.taskId - Task being executed. / 実行対象タスクID
 * @param opts.role - Workflow role about to run. / 実行ロール
 * @param opts.task - Task fields used for risk detection. / リスク判定に使うタスク情報
 * @returns The chosen model id plus an audit payload. / モデルIDと監査情報
 */
export async function routeModelForRole(opts: {
  taskId: number;
  role: string;
  task: RoleRouteTask;
  /**
   * Providers to keep out of this route on top of the role's own preferences —
   * the provider-failure fallback passes the provider that just failed, so the
   * re-route keeps every floor and cap of a normal run.
   */
  excludeProviders?: Provider[];
}): Promise<RoleRouteResult> {
  const { taskId, role, task } = opts;
  try {
    // NOTE: No pre-routing heuristic scoring here. Before research runs,
    // task.complexityScore is intentionally null and SmartRouter falls back to
    // its neutral 50 - a weak title/description guess must not masquerade as a
    // measured value and steer model tiers. After research, the agent's
    // code-grounded score drives routing for the remaining phases.
    const [
      { getStableSmartRoute },
      { resolveRoleProviderPreferences },
      { computeMinTierWithReason },
      { detectHighRisk },
      { WorkflowQueueService },
      { recentThemeEscalation },
      { resolveProvenTier, resolvePremiumAdvantage },
    ] = await Promise.all([
      import('../ai/model-route-stability'),
      import('./role-provider-resolver'),
      import('./routing-policy'),
      import('./risk-detection'),
      import('./workflow-queue'),
      import('./outcome-telemetry'),
      import('./role-evidence'),
    ]);

    const rolePrefs = await resolveRoleProviderPreferences(role, taskId);
    const prefs = opts.excludeProviders?.length
      ? {
          ...rolePrefs,
          excludeProviders: [
            ...new Set([...(rolePrefs.excludeProviders ?? []), ...opts.excludeProviders]),
          ],
          // A preference for the provider that just failed would be pointless.
          preferredProvider: opts.excludeProviders.includes(rolePrefs.preferredProvider as Provider)
            ? undefined
            : rolePrefs.preferredProvider,
        }
      : rolePrefs;
    const queueItem = await WorkflowQueueService.getInstance()
      .findByTaskId(taskId)
      .catch(() => null);

    // Theme trouble is a SOFT signal and stays separate from the per-task retry
    // count: collapsing them once pinned every phase of every task in a theme
    // to premium. recentThemeEscalation already fails open; the catch is
    // defense in depth.
    const themeEscalation = await recentThemeEscalation(task.themeId ?? null).catch(() => 0);
    const taskRetries = queueItem?.retryCount ?? 0;
    // The repair loop bounces back to the implementer WITHOUT bumping the
    // queue's retryCount, so a rejected weak model used to run again on the
    // same floor and pin. Count the bounces by cause; only verified capability
    // gaps escalate (infrastructure / requirement / unfounded ones do not).
    const repairCauses = REPAIR_ESCALATED_ROLES.has(role)
      ? await import('./repair-escalation')
          .then((m) => m.summarizeRepairCauses(taskId))
          .catch(() => null)
      : null;
    const capabilityRepairs = repairCauses?.capability ?? 0;

    const planContent = PLAN_AWARE_ROLES.has(role)
      ? await readWorkflowFile(taskId, 'plan').catch(() => null)
      : null;
    const labelsText = typeof task.labels === 'string' ? task.labels : '';

    // EVIDENCE FIRST (task 661). research.md and plan.md are produced by agents
    // that read the actual code, so they supersede a keyword guess over the
    // task's prose — the same rule this file already applies to complexity
    // (see the note above: neutral 50 before research, measured score after).
    // The keyword detector remains the pre-research fallback, where no evidence
    // exists yet. Measured: of the routing decisions that recorded a driver,
    // complexity never once chose premium while the prose floor chose it 31
    // times, and every instance inspected was a false positive.
    const { resolveRiskFromEvidence } = await import('./risk-evidence');
    const researchContent = await readWorkflowFile(taskId, 'research').catch(() => null);
    const evidence = resolveRiskFromEvidence({ researchContent, planContent });
    const { high: riskHigh, reason: riskReason } =
      evidence ??
      detectHighRisk({
        text: `${task.title} ${task.description ?? ''} ${labelsText}`,
        planContent,
      });

    // Evidence is consulted only on the safe path: a task that already failed,
    // and high-risk work, keep their premium floors and never downgrade on
    // history.
    const provenTier =
      taskRetries === 0 && capabilityRepairs === 0 && !riskHigh
        ? await resolveProvenTier(role).catch(() => undefined)
        : undefined;

    // Premium suppression is suspended (routing-policy.ts); the verdict is
    // still read so the trace shows where it WOULD have capped the floor.
    const premiumAdvantage = await resolvePremiumAdvantage(role).catch(() => undefined);

    // Spend backstop (task 658 ran four premium phases for $50.04 unnoticed).
    // Resolved here so it reaches the router as a hard ceiling applied after
    // every floor.
    const { resolveTaskBudgetCap } = await import('./task-budget');
    const budget = await resolveTaskBudgetCap(taskId).catch(() => null);
    // spendUnknown means the lookup itself failed, not that spend is $0 —
    // capTier stays whatever resolveTaskBudgetCap left it as (unset), so
    // this phase runs on the existing floor. Record why, so a run that
    // looks under-capped during a DB blip is explainable from the logs.
    if (budget?.spendUnknown) {
      log.warn(
        { taskId, role, unknownReason: budget.unknownReason },
        '[role-route-inputs] task budget unknown — tier judgement deferred, existing floor applies',
      );
    }

    const policyFloor = computeMinTierWithReason({
      role,
      taskRetries,
      themeEscalation,
      riskHigh,
      provenTier,
      // The retry floor only applies when a stronger model could plausibly fix
      // the previous failure - a spend limit or a timeout could not.
      retryCause: queueItem?.errorMessage ?? null,
      premiumJustified: premiumAdvantage?.justified,
      capabilityRepairs,
    });
    // A review role judges the implementer's work, so its floor is at least the
    // executor's tier — the same rule the jury seats follow (G2 routing1 item 4).
    const reviewFloor = REVIEW_ROLES.has(role)
      ? await raiseFloorToExecutor(taskId, policyFloor)
      : null;
    const minTier = reviewFloor?.tier ?? policyFloor.tier;
    const minTierReason = reviewFloor?.reason ?? policyFloor.reason;

    // NOTE (determinism): pinned per taskId+role+minTier+capTier+hardCapTier so a same-phase
    // retry reuses the SAME model instead of silently re-routing. A genuine
    // escalation/risk/evidence change computes a different key.
    const route = await getStableSmartRoute(taskId, role, {
      ...prefs,
      minTier,
      minTierReason,
      riskSource: evidence?.source ?? 'task_text_keywords',
      hardCapTier: budget?.capTier,
      hardCapReason: budget?.reason,
      capTier: provenTier,
      includeAlternatives: false,
    });

    const shortfall = route.constraintShortfall;
    if (shortfall) {
      log.warn(
        { taskId, role, model: route.recommendedModel, shortfall },
        '[role-route-inputs] route misses its requirement — returned to the caller, not hidden',
      );
    }
    return {
      modelId: route.recommendedModel,
      ...(shortfall ? { constraintShortfall: shortfall } : {}),
      details: {
        taskId,
        role,
        model: route.recommendedModel,
        tier: route.recommendedTier,
        minTier: minTier ?? null,
        minTierReason: minTierReason ?? null,
        provenTier: provenTier ?? null,
        taskRetries,
        repairCauses,
        themeEscalation,
        riskHigh,
        riskReason: riskReason ?? null,
        riskSource: evidence?.source ?? 'task_text_keywords',
        premiumJustified: premiumAdvantage?.justified ?? null,
        // Suspended for every route; `WouldApply` marks the routes it would have capped.
        premiumSuppression: 'suspended',
        premiumSuppressionWouldApply: policyFloor.premiumSuppressionSuspended ?? false,
        taskSpentUsd: budget?.spentUsd ?? null,
        budgetCapTier: budget?.capTier ?? null,
        budgetSpendUnknown: budget?.spendUnknown ?? false,
        budgetUnknownReason: budget?.unknownReason ?? null,
        preferredProvider: prefs.preferredProvider ?? null,
        excludeProviders: prefs.excludeProviders ?? [],
        executorModel: reviewFloor?.executor.modelId ?? null,
        executorVerified: reviewFloor?.executor.verified ?? null,
        constraintShortfall: shortfall ?? null,
      },
    };
  } catch (err) {
    log.warn({ err, taskId, role }, 'Smart Router failed, falling back to the sonnet alias');
    return {
      modelId: 'sonnet',
      routingFailed: true,
      details: { taskId, role, model: 'sonnet', fallback: true },
    };
  }
}
