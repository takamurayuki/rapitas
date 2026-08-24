/**
 * Workflow Orchestrator — Execution Context
 *
 * Fourth stage of runAdvanceWorkflow: role context assembly (with approved and
 * experimental prompt addenda), effective model resolution via Smart Router,
 * and task-status reconciliation right before the run. Moved verbatim from
 * workflow-orchestrator.ts (file-size ratchet, task 627); behavior is unchanged.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { readWorkflowFile } from './workflow-file-utils';
import { buildRoleContext } from './workflow-context-builder';
import type { RoleTransition, WorkflowMode, WorkflowStatus } from './workflow-types';
import type { ResolvedTask } from './workflow-orchestrator-preflight';

const log = createLogger('workflow-orchestrator');

/**
 * Builds the role context and appends the approved / experimental addenda.
 *
 * @param taskId - The task whose workflow should advance. / ワークフローを進めるタスクID
 * @param transition - Transition about to execute. / 実行予定の遷移
 * @param task - Resolved task row. / 解決済みタスク行
 * @param language - Language for generated content. / 生成コンテンツの言語
 * @param workflowMode - Effective workflow mode. / 有効なワークフローモード
 * @returns Assembled context string. / 組み立てたコンテキスト
 */
export async function buildExecutionContext(
  taskId: number,
  transition: RoleTransition,
  task: ResolvedTask,
  language: 'ja' | 'en',
  workflowMode: WorkflowMode,
): Promise<string> {
  let context = await buildRoleContext(taskId, transition.role, task, language, workflowMode);

  // Human-approved prompt-evolution addendum for this role (proposed by the
  // weekly evolution pipeline, approved on /system-prompts). Appended at the
  // single orchestration call site so every workflow role gets it without
  // touching each buildRoleContext case. Best-effort.
  try {
    const { getApprovedRoleAddendum } = await import('../self-learning/prompt-evolution-worker');
    const addendum = await getApprovedRoleAddendum(transition.role);
    if (addendum) {
      context += `\n\n## 承認済みの改善ガイダンス(プロンプト進化)\n\n${addendum}`;
      // Observability: role-evidence success rates before/after this line
      // starts appearing are the evolution's measured effect.
      log.info(
        { taskId, role: transition.role },
        '[prompt-evolution] Approved addendum injected into role context',
      );
    }
  } catch {
    // Addendum injection must never block the run.
  }

  // Active-experiment intervention (hypothesis-driven self-experiment loop).
  // Deliberately a SEPARATE path from the approved addendum above: the text
  // is unapproved and under measurement, so it carries its own heading and
  // never touches getApprovedRoleAddendum's status='approved' semantics.
  // Best-effort.
  try {
    const { getActiveExperimentAddendum } =
      await import('../self-learning/experiment-loop/experiment-store');
    const experimentAddendum = await getActiveExperimentAddendum(transition.role);
    if (experimentAddendum) {
      context += `\n\n## 実験中の改善ガイダンス(未承認・効果測定中)\n\n${experimentAddendum}`;
      log.info(
        { taskId, role: transition.role },
        '[experiment] Active-experiment addendum injected into role context',
      );
    }
  } catch {
    // Experiment injection must never block the run.
  }

  return context;
}

/**
 * Resolves the effective model id: role override → agent default → Smart Router.
 *
 * @param taskId - The task whose workflow should advance. / ワークフローを進めるタスクID
 * @param transition - Transition about to execute. / 実行予定の遷移
 * @param task - Resolved task row. / 解決済みタスク行
 * @param roleConfig - Role config row (may be null). / ロール設定行
 * @param agentConfig - Agent config resolved for the role. / ロールに解決されたエージェント設定
 * @returns Effective model id, or null when none is configured. / 有効なモデルID
 */
export async function resolveEffectiveModel(
  taskId: number,
  transition: RoleTransition,
  task: ResolvedTask,
  roleConfig: { modelId?: string | null } | null,
  agentConfig: { modelId: string | null },
): Promise<string | null> {
  // agentConfig is resolved above (role assignment or capability fallback).
  // Model resolution: role override → agent default → smart auto-select
  const roleModelId = (roleConfig as { modelId?: string | null } | null)?.modelId ?? null;
  let effectiveModelId = roleModelId || agentConfig.modelId;

  // Auto-select: when modelId is 'auto' or unset, use Smart Model Router.
  // The resolver computes `preferredProvider` (role override > global default)
  // and `excludeProviders` (upstream phase's provider for verifier
  // roles, to mitigate self-evaluation bias).
  if (!effectiveModelId || effectiveModelId === 'auto') {
    try {
      // NOTE: No pre-routing heuristic scoring here anymore. Before research
      // runs, task.complexityScore is intentionally null and SmartRouter
      // falls back to its neutral 50 ('standard') — a weak title/description
      // guess must not masquerade as a measured value and steer model tiers.
      // After research, the agent's code-grounded score (persisted by
      // applyResearchAssessedComplexity) drives routing for the remaining
      // phases (plan / implement / verify).

      const [
        { getStableSmartRoute },
        { resolveRoleProviderPreferences },
        { computeMinTier, detectHighRisk },
        { WorkflowQueueService },
      ] = await Promise.all([
        import('../ai/model-route-stability'),
        import('./role-provider-resolver'),
        import('./routing-policy'),
        import('./workflow-queue'),
      ]);
      const prefs = await resolveRoleProviderPreferences(transition.role, taskId);

      // Failure escalation: a phase that already failed (queue retryCount > 0)
      // gets a STRONGER model on the retry instead of re-running the same weak
      // one. ALSO factor in recent OUTCOME telemetry for this theme — when the
      // theme's recent tasks have been failing/repair-heavy, start stronger
      // (adaptive routing closing the outcome loop), not just on per-task retry.
      const queueItem = await WorkflowQueueService.getInstance()
        .findByTaskId(taskId)
        .catch(() => null);
      const { recentThemeEscalation } = await import('./outcome-telemetry');
      // NOT a fail-closed candidate: this is a soft routing SIGNAL, not a
      // cap that bounds a loop. recentThemeEscalation already fails open
      // internally (returns 0, "no escalation") because a lost signal just
      // means "start at the base tier" (a quality nudge), never an unbounded
      // retry/repair loop. The outer .catch(() => 0) here is pure
      // defense-in-depth for the (already-caught) call itself throwing.
      // NOTE: kept SEPARATE from the per-task retry count — collapsing them
      // via Math.max meant theme level 1 (>=25% of recent tasks had a
      // routine self-repair bounce — the common case) forced premium on
      // every phase of every task indefinitely (observed: 122/122 recent
      // executions on the top model). computeMinTier now weighs them
      // differently (task retry → premium; theme 1 → standard, 2 → premium).
      const themeEscalation = await recentThemeEscalation(task.themeId).catch(() => 0);
      const taskRetries = queueItem?.retryCount ?? 0;

      // Risk override: schema / auth / payment / security work forces premium
      // regardless of complexity. For code phases, also scan plan.md for risky
      // planned file paths.
      const planContent =
        transition.role === 'implementer' ||
        transition.role === 'verifier' ||
        transition.role === 'auto_verifier'
          ? await readWorkflowFile(taskId, 'plan').catch(() => null)
          : null;
      const labelsText =
        typeof (task as { labels?: unknown }).labels === 'string'
          ? ((task as { labels?: string }).labels ?? '')
          : '';
      const { high: riskHigh, reason: riskReason } = detectHighRisk({
        text: `${task.title} ${task.description ?? ''} ${labelsText}`,
        planContent,
      });

      // Evidence layer: the cheapest tier with a PROVEN success record for
      // this role (recorded outcomes, role-evidence.ts). Only consulted on
      // the safe path — a task that already failed and high-risk work keep
      // their premium floors and never downgrade on history. Theme-level
      // escalation no longer disables evidence: its floor is applied AFTER
      // the cap in SmartRouter, so a proven-cheap tier can still lower the
      // heuristic tier down to that floor (previously any theme churn froze
      // evidence collection entirely, locking routing at premium).
      const { resolveProvenTier } = await import('./role-evidence');
      const provenTier =
        taskRetries === 0 && !riskHigh
          ? await resolveProvenTier(transition.role).catch(() => undefined)
          : undefined;

      // Role floor + failure signals + risk → the minimum tier SmartRouter
      // may not go below (it still RAISES further when complexity is high).
      // The evidence-proven tier relaxes the static role floor only.
      const minTier = computeMinTier({
        role: transition.role,
        taskRetries,
        themeEscalation,
        riskHigh,
        provenTier,
      });
      // NOTE (determinism): pinned per taskId+role+minTier+capTier so a
      // same-phase retry (queue re-run, discovery cache rollover, a provider
      // briefly flapping in/out of cooldown) reuses the SAME model instead of
      // silently re-routing. A genuine escalation/risk/evidence change
      // computes a different key, so it still re-routes deliberately. See
      // services/ai/model-route-stability.ts.
      const route = await getStableSmartRoute(taskId, transition.role, {
        ...prefs,
        minTier,
        capTier: provenTier,
        includeAlternatives: false,
      });
      effectiveModelId = route.recommendedModel;
      log.info(
        {
          taskId,
          role: transition.role,
          model: effectiveModelId,
          tier: route.recommendedTier,
          minTier: minTier ?? null,
          provenTier: provenTier ?? null,
          taskRetries,
          themeEscalation,
          riskHigh,
          riskReason: riskReason ?? null,
          preferredProvider: prefs.preferredProvider ?? null,
          excludeProviders: prefs.excludeProviders ?? [],
        },
        'Auto-selected model via Smart Router',
      );
    } catch {
      // Bare alias, not a pinned date-suffixed id: the CLI resolves 'sonnet'
      // to the current release, so this fallback cannot go stale/be rejected
      // at spawn the way 'claude-haiku-4-5-20251001' could after retirement.
      effectiveModelId = 'sonnet';
      log.warn({ taskId }, 'Smart Router failed, falling back to the sonnet alias');
    }
  }

  return effectiveModelId;
}

/**
 * Reconciles task.workflowStatus / task.status right before the agent starts.
 *
 * @param taskId - The task whose workflow should advance. / ワークフローを進めるタスクID
 * @param currentStatus - Current workflow status. / 現在のワークフローステータス
 * @param task - Resolved task row. / 解決済みタスク行
 */
export async function reconcileTaskStatusBeforeRun(
  taskId: number,
  currentStatus: WorkflowStatus,
  task: ResolvedTask,
): Promise<void> {
  if (currentStatus === 'draft') {
    // Reconcile the status from EXISTING artifacts before starting. A
    // re-dispatched task whose research.md / plan.md already exist must not
    // restart at `draft` — draft only accepts research/question saves, so the
    // agent would have to RE-SAVE research.md just to escape draft before it can
    // save verify.md (the "verify.md already written but won't advance without a
    // re-save" the user observed on task 267). Mirror resolveImplementEntryStatus:
    // plan.md present → plan_created, else research.md present → research_done.
    //
    // NOTE: stops at `plan_created` (never `plan_approved`) even when plan.md
    // is present — reusing an existing plan must go through the SAME
    // approval gate a freshly-produced plan.md would (manual approval or the
    // auto-approve setting), never silently skip it just because a
    // WorkflowFile row happens to exist. This is a DB-existence-only
    // backstop; reconcileStatusFromExistingArtifacts (called earlier in
    // runAdvanceWorkflow, before role/model resolution) already handles the
    // common case with actual content-quality validation and in time to
    // affect which role THIS dispatch runs — this block only still fires
    // when that earlier check found nothing usable but a WorkflowFile row
    // exists anyway (e.g. a stale row pointing at deleted/invalid content).
    const [hasPlan, hasResearch] = await Promise.all([
      prisma.workflowFile
        .findFirst({ where: { taskId, fileType: 'plan' }, select: { id: true } })
        .catch(() => null),
      prisma.workflowFile
        .findFirst({ where: { taskId, fileType: 'research' }, select: { id: true } })
        .catch(() => null),
    ]);
    const reconciled = hasPlan ? 'plan_created' : hasResearch ? 'research_done' : 'draft';
    await prisma.task.update({
      where: { id: taskId },
      data: { workflowStatus: reconciled, status: 'in-progress' },
    });
  } else if (task.status === 'todo') {
    // A task that resumes at a non-draft phase (valid research/plan artifacts
    // reused, or a multi-phase / re-run continuation) skips the draft branch
    // above, so its status was never flipped off 'todo' while the workflow
    // advances — leaving it stuck looking like 'todo' (進行中にならない) in the UI.
    // Flip it forward without touching workflowStatus. Only 'todo' is advanced,
    // so 'done'/'blocked' are never clobbered.
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'in-progress' },
    });
  }
}
