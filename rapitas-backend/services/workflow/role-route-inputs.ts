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
}

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
      { computeMinTierWithReason, detectHighRisk },
      { WorkflowQueueService },
      { recentThemeEscalation },
      { resolveProvenTier, resolvePremiumAdvantage },
    ] = await Promise.all([
      import('../ai/model-route-stability'),
      import('./role-provider-resolver'),
      import('./routing-policy'),
      import('./workflow-queue'),
      import('./outcome-telemetry'),
      import('./role-evidence'),
    ]);

    const prefs = await resolveRoleProviderPreferences(role, taskId);
    const queueItem = await WorkflowQueueService.getInstance()
      .findByTaskId(taskId)
      .catch(() => null);

    // Theme trouble is a SOFT signal and stays separate from the per-task retry
    // count: collapsing them once pinned every phase of every task in a theme
    // to premium. recentThemeEscalation already fails open; the catch is
    // defense in depth.
    const themeEscalation = await recentThemeEscalation(task.themeId ?? null).catch(() => 0);
    const taskRetries = queueItem?.retryCount ?? 0;

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
      taskRetries === 0 && !riskHigh
        ? await resolveProvenTier(role).catch(() => undefined)
        : undefined;

    // Does the RECORD say premium outperforms standard for this role? An
    // upgrade has to earn itself, the same way resolveProvenTier makes a
    // downgrade earn itself. undefined = not enough evidence, floor unchanged.
    const premiumAdvantage = await resolvePremiumAdvantage(role).catch(() => undefined);

    // Spend backstop (task 658 ran four premium phases for $50.04 unnoticed).
    // Resolved here so it reaches the router as a hard ceiling applied after
    // every floor.
    const { resolveTaskBudgetCap } = await import('./task-budget');
    const budget = await resolveTaskBudgetCap(taskId).catch(() => null);

    const { tier: minTier, reason: minTierReason } = computeMinTierWithReason({
      role,
      taskRetries,
      themeEscalation,
      riskHigh,
      provenTier,
      // The retry floor only applies when a stronger model could plausibly fix
      // the previous failure - a spend limit or a timeout could not.
      retryCause: queueItem?.errorMessage ?? null,
      premiumJustified: premiumAdvantage?.justified,
    });

    // NOTE (determinism): pinned per taskId+role+minTier+capTier so a same-phase
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

    return {
      modelId: route.recommendedModel,
      details: {
        taskId,
        role,
        model: route.recommendedModel,
        tier: route.recommendedTier,
        minTier: minTier ?? null,
        minTierReason: minTierReason ?? null,
        provenTier: provenTier ?? null,
        taskRetries,
        themeEscalation,
        riskHigh,
        riskReason: riskReason ?? null,
        riskSource: evidence?.source ?? 'task_text_keywords',
        premiumJustified: premiumAdvantage?.justified ?? null,
        taskSpentUsd: budget?.spentUsd ?? null,
        budgetCapTier: budget?.capTier ?? null,
        preferredProvider: prefs.preferredProvider ?? null,
        excludeProviders: prefs.excludeProviders ?? [],
      },
    };
  } catch (err) {
    log.warn({ err, taskId, role }, 'Smart Router failed, falling back to the sonnet alias');
    return { modelId: 'sonnet', details: { taskId, role, model: 'sonnet', fallback: true } };
  }
}
