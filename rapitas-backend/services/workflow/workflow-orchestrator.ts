/**
 * Workflow Orchestrator
 *
 * Manages automatic progression of workflow phases and executes AI agents assigned to each phase.
 * CLI agents (claude-code, gemini, codex) run via AgentOrchestrator.
 * API agents (anthropic-api, openai, etc.) call APIs directly and save output files on their behalf.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { resolveWorkflowDir, readWorkflowFile, archiveWorkflowFile } from './workflow-file-utils';
import { resolveTaskWithThemeAndCategory } from '../task/task-resolver';
import { buildRoleContext, applyPlanModeDirective } from './workflow-context-builder';
import {
  executeCLIAgent,
  executeAPIAgent,
  type WorkflowAdvanceResult,
} from './workflow-agent-executor';
import {
  acquireTaskExecutionLock,
  releaseTaskExecutionLock,
  WORKFLOW_LOCK_TTL_MS,
} from '../agents/task-execution-lock';
import { DEFAULT_SYSTEM_PROMPTS } from '../../routes/ai/system-prompts/default-prompts';
import { isReusableArtifact } from './phase-output-validator';
import { recordTransition } from './transition-recorder';
import { isShutdownError } from '../agents/orchestrator/shutdown-error';
import { narrowWorkflowStatus, narrowWorkflowMode } from './workflow-types.guards.generated';
import type { WorkflowRole, WorkflowStatus } from './workflow-types';
import { TASK_NOT_FOUND } from '../../utils/common/error-messages';
import { countWithFailClosed } from '../../utils/database/fail-closed-count';
import { writeBlockedStatusDurable } from './durable-blocked-write';

// Re-export sub-module helpers so existing imports from this path keep working.
export { resolveWorkflowDir, readWorkflowFile, writeWorkflowFile } from './workflow-file-utils';
export type { WorkflowFileType } from './workflow-file-utils';
export { buildRoleContext } from './workflow-context-builder';
export { callAnthropicAPI, callOpenAIAPI, decryptApiKey } from './workflow-api-callers';
export type { WorkflowAdvanceResult } from './workflow-agent-executor';

const log = createLogger('workflow-orchestrator');

// NOTE: The per-mode transition tables were moved to workflow-mode-config.ts,
// which builds them from DB-backed, UI-editable settings (single source of
// truth, shared with role-resolver and the frontend). Research is mandatory in
// every mode; the tiers diverge by ceremony (plan / review / auto-verify).

const CLI_AGENT_TYPES = new Set(['claude-code', 'codex', 'gemini']);

/**
 * Max times the implementer guard may roll back to re-plan a task whose plan.md
 * keeps coming back invalid. Beyond this the task is blocked instead of looping
 * (draft→…→plan_approved→rollback) forever. / 再計画ロールバックの上限。
 */
const MAX_PLAN_REPLANS = 3;

/**
 * Resolves the system prompt content for a given key.
 *
 * @param key - The system prompt key to look up. / 検索するシステムプロンプトキー。
 * @returns The prompt content string. / プロンプト本文。
 *   B-2: DB hit → DB の content を返す。
 *   B-1: DB null + DEFAULT_SYSTEM_PROMPTS に key あり → default content を返す。
 *   B-1': DB null + DEFAULT_SYSTEM_PROMPTS にも key なし → `''` を返す。
 *
 * NOTE: DB record の content が `''` であってもフォールバックしない。
 * record の存在 = DB の意図として尊重するため、存在判定は `null` チェックのみ行う。
 */
export async function resolveSystemPromptContent(key: string): Promise<string> {
  const sp = await prisma.systemPrompt.findUnique({ where: { key } });
  if (sp !== null) return sp.content;
  const defaultEntry = DEFAULT_SYSTEM_PROMPTS.find((p) => p.key === key);
  return defaultEntry?.content ?? '';
}

export class WorkflowOrchestrator {
  private static instance: WorkflowOrchestrator;

  static getInstance(): WorkflowOrchestrator {
    if (!WorkflowOrchestrator.instance) {
      WorkflowOrchestrator.instance = new WorkflowOrchestrator();
    }
    return WorkflowOrchestrator.instance;
  }

  /**
   * Get or create the DeveloperModeConfig required for AgentSession creation.
   *
   * @param taskId - The task ID. / タスクID
   * @returns The DeveloperModeConfig record. / DeveloperModeConfigレコード
   */
  private async getOrCreateDevConfig(taskId: number) {
    let devConfig = await prisma.developerModeConfig.findUnique({ where: { taskId } });
    if (!devConfig) {
      devConfig = await prisma.developerModeConfig.create({
        data: { taskId, isEnabled: true },
      });
    }
    return devConfig;
  }

  /**
   * Execute the next phase of the workflow.
   *
   * Acquires the process-wide per-task execution mutex BEFORE doing any work,
   * guaranteeing at most one agent runs per task at a time. The many triggers
   * that call this (queue runner, post-phase auto-advance setTimeouts, HTTP
   * approve/advance handlers, plan auto-approve) would otherwise spawn
   * duplicate agents for the same task. When the lock is already held, this
   * returns `skipped: true` WITHOUT spawning — the holder will advance the
   * workflow, so the duplicate trigger is a safe no-op.
   *
   * @param taskId - The task whose workflow should advance. / ワークフローを進めるタスクID
   * @param language - Language for generated content. / 生成コンテンツの言語
   * @returns Result of the phase execution. / フェーズ実行の結果
   */
  async advanceWorkflow(
    taskId: number,
    language: 'ja' | 'en' = 'ja',
  ): Promise<WorkflowAdvanceResult> {
    // WORKFLOW_LOCK_TTL_MS intentionally exceeds the WorkflowRunner's per-phase
    // timeout (both derive from execution-timeouts) so a long phase cannot have
    // its lock stolen mid-run.
    if (!acquireTaskExecutionLock(taskId, WORKFLOW_LOCK_TTL_MS)) {
      const current = await prisma.task
        .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
        .catch(() => null);
      log.info(
        `[WorkflowOrchestrator] Task ${taskId} already has a phase running — skipping duplicate advance`,
      );
      return {
        success: true,
        skipped: true,
        role: 'researcher',
        status: narrowWorkflowStatus(current?.workflowStatus),
        output: 'skipped: another phase is already executing for this task',
      };
    }

    try {
      return await this.runAdvanceWorkflow(taskId, language);
    } finally {
      releaseTaskExecutionLock(taskId);
    }
  }

  /**
   * Inner implementation of {@link advanceWorkflow}. MUST only be called while
   * the task execution lock is held (advanceWorkflow guarantees this).
   *
   * @param taskId - The task whose workflow should advance. / ワークフローを進めるタスクID
   * @param language - Language for generated content. / 生成コンテンツの言語
   * @returns Result of the phase execution. / フェーズ実行の結果
   */
  private async runAdvanceWorkflow(
    taskId: number,
    language: 'ja' | 'en' = 'ja',
  ): Promise<WorkflowAdvanceResult> {
    const task = await resolveTaskWithThemeAndCategory(taskId);
    if (!task) {
      return {
        success: false,
        role: 'researcher',
        status: 'draft',
        error: TASK_NOT_FOUND,
      };
    }

    // A blocked task awaits user inspection and must NOT be auto-advanced. Without
    // this guard a task blocked by the replan-exhausted path (status='blocked' but
    // workflowStatus still 'plan_approved') gets re-dispatched and re-runs the same
    // block path, re-recording plan_invalid_replan_exhausted every few seconds
    // (observed: 80+ transitions on stale invalid-plan tasks). / ブロック中タスクは
    // 自動実行せずスキップし、exhausted ループの再記録を止める。
    if (task.status === 'blocked') {
      return {
        success: false,
        role: 'researcher',
        status: narrowWorkflowStatus(task.workflowStatus),
        error: 'タスクはブロック中のため自動実行をスキップしました',
      };
    }

    // Build the transition table from the (DB-backed, UI-editable) mode config.
    // Single source of truth — see workflow-mode-config.ts.
    let workflowMode = narrowWorkflowMode(task.workflowMode);
    const { getModeSettings, buildTransitions } = await import('./workflow-mode-config');
    const modeSettings = await getModeSettings(workflowMode);
    const modeTransitions = buildTransitions(modeSettings);

    const currentStatus = narrowWorkflowStatus(task.workflowStatus);
    const transition = modeTransitions[currentStatus];
    if (!transition) {
      return {
        success: false,
        role: 'researcher',
        status: currentStatus,
        error: `ステータス "${currentStatus}" では次のフェーズを実行できません`,
      };
    }

    // Intake quality gate — runs once, just before the first (research) phase.
    // Enriches a thin spec and, per policy, pauses for a single clarifying
    // question (returns early to awaiting_question) or proceeds on best-guess.
    // Fail-open: any error here must NOT block the workflow — fall through to
    // research. Idempotent, so re-entry after a question is answered is safe.
    if (currentStatus === 'draft' && transition.role === 'researcher') {
      try {
        const { ensureIntakeReady } = await import('../intake');
        const intake = await ensureIntakeReady(taskId);
        if (intake.status === 'awaiting_question') {
          return {
            success: true,
            role: transition.role,
            status: 'awaiting_question' as WorkflowStatus,
            output:
              intake.message ?? '仕様が不十分なため確認の質問を作成しました（回答後に再開します）',
          };
        }
      } catch (err) {
        log.warn(
          { err, taskId },
          '[WorkflowOrchestrator] intake gate failed — proceeding to research (fail-open)',
        );
      }
    }

    // Pre-research mode selection: pick the workflow mode from a cheap metadata
    // complexity estimate BEFORE the researcher runs, so the phase chain (does a
    // plan phase exist?) and the researcher's prompt are mode-aware from the
    // start. Without this, every task ran research in the default 'comprehensive'
    // framing and the mode was corrected only AFTER research — producing
    // plan-assuming research.md (and a plan) even for trivial tasks. The
    // research-assessed code-grounded complexity refines (UPGRADES) this later.
    // Respects a user-pinned mode (workflowModeOverride). Fail-open.
    if (
      currentStatus === 'draft' &&
      transition.role === 'researcher' &&
      !task.workflowModeOverride
    ) {
      try {
        // Re-read the spec: the intake gate above may have just enriched it, and
        // a richer spec makes the metadata estimate more accurate.
        const fresh = await prisma.task
          .findUnique({
            where: { id: taskId },
            select: {
              complexityScore: true,
              goals: true,
              constraints: true,
              acceptanceCriteria: true,
            },
          })
          .catch(() => null);
        // The metadata heuristic is computed IN-MEMORY for this provisional
        // mode pick only — it is not persisted. task.complexityScore holds
        // exclusively the research agent's code-grounded assessment
        // (applyResearchAssessedComplexity); the UI shows 複雑度"-" until then.
        let score = fresh?.complexityScore ?? null;
        if (score == null) {
          score = await computeMetadataComplexity({
            ...task,
            goals: fresh?.goals ?? task.goals,
            constraints: fresh?.constraints ?? task.constraints,
            acceptanceCriteria: fresh?.acceptanceCriteria ?? task.acceptanceCriteria,
          }).catch(() => null);
        }
        if (score != null) {
          const { selectProvisionalMode } = await import('./workflow-mode-config');
          const provisional = await selectProvisionalMode(score);
          if (provisional !== workflowMode) {
            await prisma.task.update({
              where: { id: taskId },
              data: { workflowMode: provisional },
            });
            log.info(
              { taskId, score, from: workflowMode, to: provisional },
              '[WorkflowOrchestrator] Pre-research provisional mode selected',
            );
            workflowMode = provisional;
          }
        }
      } catch (err) {
        log.warn(
          { err, taskId },
          '[WorkflowOrchestrator] Pre-research mode selection failed — keeping current mode',
        );
      }
    }

    // Get role configuration
    const roleConfig = await prisma.workflowRoleConfig.findUnique({
      where: { role: transition.role },
      include: { agentConfig: true },
    });
    // An explicitly DISABLED role is a deliberate stop — respect it.
    if (roleConfig && !roleConfig.isEnabled) {
      return {
        success: false,
        role: transition.role,
        status: currentStatus,
        error: `ロール "${transition.role}" は無効化されています`,
      };
    }
    // Resolve the agent for this role. When WorkflowRoleConfig has no agent
    // assigned, fall back to the capability-based recommender — the SAME path
    // execute-route uses. Without this fallback, queue-driven tasks (e.g. split
    // subtasks) hard-failed at the very first phase whenever the user had not
    // manually wired every role in the agent-management page, exhausting all
    // retries in ~30ms with no agent ever spawned.
    let agentConfig: {
      id: number;
      agentType: string;
      name: string;
      modelId: string | null;
      apiKeyEncrypted: string | null;
      endpoint: string | null;
    } | null = roleConfig?.agentConfig ?? null;
    if (!agentConfig) {
      const { recommendAgentForRole } = await import('./role-recommender');
      const recommended = await recommendAgentForRole(transition.role).catch(() => null);
      if (recommended?.agentConfigId) {
        agentConfig = await prisma.aIAgentConfig
          .findUnique({ where: { id: recommended.agentConfigId } })
          .catch(() => null);
      }
      if (agentConfig) {
        log.info(
          { taskId, role: transition.role, agentId: agentConfig.id, agentName: agentConfig.name },
          '[WorkflowOrchestrator] No agent assigned to role — using capability-recommended agent',
        );
      }
    }
    if (!agentConfig) {
      // Last resort: the built-in Claude Code agent (id: -1). This is the SAME
      // default execute-route uses, so a workflow can run even when the DB has
      // zero AIAgentConfig rows and every role is unassigned. The execution
      // layer (task-executor) maps the unknown id back to the built-in and
      // nulls the agentConfig FK so AgentExecution creation does not fail.
      const { getDefaultAgent } = await import('../agent-config/defaults');
      const builtIn = await getDefaultAgent().catch(() => null);
      if (builtIn) {
        agentConfig = {
          id: builtIn.id,
          agentType: builtIn.agentType,
          name: builtIn.name,
          modelId: builtIn.modelId ?? null,
          apiKeyEncrypted: builtIn.apiKeyEncrypted ?? null,
          endpoint: builtIn.endpoint ?? null,
        };
        log.info(
          { taskId, role: transition.role, agentName: agentConfig.name },
          '[WorkflowOrchestrator] No assigned/recommended agent — using built-in default agent',
        );
      }
    }
    if (!agentConfig) {
      return {
        success: false,
        role: transition.role,
        status: currentStatus as WorkflowStatus,
        error: `ロール "${transition.role}" にエージェントが割り当てられていません。エージェント管理ページで設定してください。`,
      };
    }

    // Get system prompt — DB-stored content takes priority.
    // NOTE: If the seed has not been run yet, fall back to the compiled DEFAULT_SYSTEM_PROMPTS
    // so the researcher receives the correct template even on a fresh install.
    let systemPromptContent = '';
    if (roleConfig?.systemPromptKey) {
      systemPromptContent = await resolveSystemPromptContent(roleConfig.systemPromptKey);
    }

    // Resolve workflow directory
    const workflowInfo = await resolveWorkflowDir(taskId);
    if (!workflowInfo) {
      return {
        success: false,
        role: transition.role,
        status: currentStatus as WorkflowStatus,
        error: 'パス解決に失敗しました',
      };
    }

    // Plan-optional framing: the role prompts assume plan.md, but the lightweight
    // (research→implement→verify) workflow produces none. Prepend an authoritative
    // mode directive so the implementer/verifier work from research.md + task
    // requirements instead of a non-existent plan/checklist/planner. Applies to
    // implementer/verifier only; no-op for other roles.
    // Apply the AUTHORITATIVE plan-mode directive ALWAYS — even when the role has
    // no configured system prompt. This was gated behind `if (systemPromptContent)`,
    // but the implementer role's system prompt is EMPTY by default, so the
    // no-plan directive was never prepended: a lightweight implementer then
    // followed CLAUDE.md's generic plan step and created a plan.md (task 229).
    // applyPlanModeDirective handles an empty base prompt (returns just the directive).
    {
      const planContent = await readWorkflowFile(workflowInfo.dir, 'plan');
      systemPromptContent = applyPlanModeDirective(
        transition.role,
        systemPromptContent || '',
        !!planContent?.trim(),
      );
    }

    // Reuse an already-saved phase artifact (skip regeneration) when it exists
    // AND is acceptable. Two deliberate carve-outs:
    //   - verify.md is NEVER reused: a re-run must re-verify the CURRENT state
    //     and overwrite verify.md with fresh results. Reusing a stale verify
    //     would let the completion gate pass/fail on an outdated report.
    //   - research.md / plan.md are reused only when they still pass their
    //     validator (no serious problem); a thin/broken artifact is regenerated.
    if (transition.outputFile && transition.outputFile !== 'verify') {
      const existingContent = await readWorkflowFile(workflowInfo.dir, transition.outputFile);
      if (existingContent && isReusableArtifact(transition.outputFile, existingContent)) {
        log.info(
          `[WorkflowOrchestrator] ${transition.outputFile}.md already exists and is valid for task ${taskId}, skipping regeneration`,
        );
        await prisma.task.update({
          where: { id: taskId },
          data: { workflowStatus: transition.nextStatus },
        });
        return {
          success: true,
          role: transition.role,
          status: transition.nextStatus,
          output: `${transition.outputFile}.md は既存かつ内容に問題がないため、再生成をスキップしました`,
        };
      }
    }

    // Guard against implementing on a BROKEN plan. plan.md/research.md approved
    // BEFORE the log-pollution checks existed (or auto-approved garbage) can be
    // pure agent-log noise — the implementer would then build from nothing
    // (task 223: plan.md was 301 chars of "[System: thinking_tokens]"). The
    // reuse-check above only fires for the phase that PRODUCES an md; the
    // implementer CONSUMES plan.md without re-validating it. So before the
    // implementer runs, re-validate plan.md and roll the workflow back to draft
    // when it is unusable — the researcher/planner reuse-checks then regenerate
    // ONLY the polluted artifacts (a clean one is skipped) before re-implementing.
    // Lightweight mode has NO plan phase, so the implementer legitimately runs
    // with no plan.md — skip the plan-validity guard. Otherwise an empty/absent
    // plan.md reads as "broken plan" and rolls a lightweight task back to re-plan
    // forever (task 229's plan_invalid_replan loop, and why the lightweight
    // research→implement handoff stalled at research_done).
    if (transition.role === 'implementer' && workflowMode !== 'lightweight') {
      const planMd = await readWorkflowFile(workflowInfo.dir, 'plan').catch(() => null);
      if (!planMd || !isReusableArtifact('plan', planMd)) {
        // BOUND the replan loop. Previously this rolled back to draft every time
        // an invalid plan.md was seen, with no limit and WITHOUT removing the bad
        // file — so a plan that kept coming back invalid spun forever
        // (draft→…→plan_approved→rollback, ~1/s, hitting maxIterations then
        // retrying). Count prior replans; once exhausted, block for inspection
        // instead of looping.
        // Window to "recent" so old replans from an unrelated past run don't
        // pre-block a fresh re-run; a real loop trips this within seconds.
        const priorReplans = await countWithFailClosed(
          prisma.workflowTransition.count({
            where: {
              taskId,
              cause: 'plan_invalid_replan',
              createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
            },
          }),
          MAX_PLAN_REPLANS,
          log,
          { taskId },
          'plan-replan',
        );

        if (priorReplans >= MAX_PLAN_REPLANS) {
          log.warn(
            { taskId, priorReplans },
            '[WorkflowOrchestrator] plan.md still invalid after repeated re-plans — blocking instead of looping',
          );
          // Durable block write: this is the write that actually STOPS the
          // plan-invalid-replan loop (downstream schedulers/UI key off
          // status==='blocked' to stop re-dispatching). Swallowing a failure here
          // silently let the loop re-enter on the very next poll. Retry once, and
          // if it still fails, escalate via a Notification so a human intervenes
          // instead of the loop silently repeating.
          await writeBlockedStatusDurable({
            taskId,
            log,
            source: 'WorkflowOrchestrator',
            notification: {
              title: 'ブロック処理の書き込みに失敗',
              message: `タスク #${taskId} を blocked にする更新が2回失敗しました。再計画ループが再発する可能性があるため手動確認が必要です。`,
            },
          });
          await recordTransition({
            taskId,
            fromStatus: 'plan_approved',
            toStatus: 'plan_approved',
            actor: 'system',
            cause: 'plan_invalid_replan_exhausted',
            phase: 'plan',
            metadata: { priorReplans },
            invariantViolation: true,
            invariantMessage:
              'plan.md remained invalid after repeated re-plans; blocked to stop the loop',
          }).catch(() => {});
          import('../communication/notification-service')
            .then(({ createNotification }) =>
              createNotification({
                type: 'system',
                title: '計画の再生成に失敗（ブロック）',
                message: `タスク #${taskId} は plan.md が繰り返し不正なため、再計画を打ち切りブロックしました。手動で確認してください。`,
                link: `/tasks?taskId=${taskId}`,
                metadata: { taskId, priorReplans, reason: 'plan_invalid_replan_exhausted' },
              }),
            )
            .catch(() => {});
          return {
            success: false,
            role: transition.role,
            status: 'plan_approved' as WorkflowStatus,
            error: 'plan.md が繰り返し不正なため再計画を打ち切りブロックしました',
          };
        }

        log.warn(
          `[WorkflowOrchestrator] task ${taskId}: plan.md is log-polluted or non-substantive — archiving it and rolling back to re-plan (attempt ${priorReplans + 1}/${MAX_PLAN_REPLANS})`,
        );
        // Archive the bad plan so the planner MUST regenerate it (it can no
        // longer be reused by the reuse-check), breaking the reuse↔reject loop.
        await archiveWorkflowFile(workflowInfo.dir, 'plan').catch(() => {});
        await prisma.task.update({
          where: { id: taskId },
          data: { workflowStatus: 'draft' },
        });
        await recordTransition({
          taskId,
          fromStatus: 'plan_approved',
          toStatus: 'draft',
          actor: 'system',
          cause: 'plan_invalid_replan',
          phase: 'plan',
          metadata: {
            reason: 'plan.md is log-polluted or non-substantive; archived + regenerating',
          },
        }).catch(() => {});
        return {
          success: true,
          role: transition.role,
          status: 'draft',
          output: 'plan.md が壊れている（ログ汚染/空）ため、退避して再計画にロールバックしました',
        };
      }
    }

    let context = await buildRoleContext(
      taskId,
      transition.role,
      workflowInfo.dir,
      task,
      language,
      workflowMode,
    );

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

    // agentConfig is resolved above (role assignment or capability fallback).
    // Model resolution: role override → agent default → smart auto-select
    const roleModelId = (roleConfig as { modelId?: string | null } | null)?.modelId ?? null;
    let effectiveModelId = roleModelId || agentConfig.modelId;

    // Auto-select: when modelId is 'auto' or unset, use Smart Model Router.
    // The resolver computes `preferredProvider` (role override > global default)
    // and `excludeProviders` (upstream phase's provider for reviewer/verifier
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
          transition.role === 'reviewer' ||
          transition.role === 'verifier' ||
          transition.role === 'auto_verifier'
            ? await readWorkflowFile(workflowInfo.dir, 'plan').catch(() => null)
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

    if (currentStatus === 'draft') {
      // Reconcile the status from EXISTING artifacts before starting. A
      // re-dispatched task whose research.md / plan.md already exist must not
      // restart at `draft` — draft only accepts research/question saves, so the
      // agent would have to RE-SAVE research.md just to escape draft before it can
      // save verify.md (the "verify.md already written but won't advance without a
      // re-save" the user observed on task 267). Mirror resolveImplementEntryStatus:
      // plan.md present → plan_approved, else research.md present → research_done.
      const [hasPlan, hasResearch] = await Promise.all([
        prisma.workflowFile
          .findFirst({ where: { taskId, fileType: 'plan' }, select: { id: true } })
          .catch(() => null),
        prisma.workflowFile
          .findFirst({ where: { taskId, fileType: 'research' }, select: { id: true } })
          .catch(() => null),
      ]);
      const reconciled = hasPlan ? 'plan_approved' : hasResearch ? 'research_done' : 'draft';
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

    const advanceFn = this.advanceWorkflow.bind(this);
    const devConfigFn = this.getOrCreateDevConfig.bind(this);

    // Apply the resolved effectiveModelId uniformly across both execution
    // paths. Previously CLI agents received the raw agentConfig, causing
    // role-specific overrides and Smart Router decisions to be silently
    // dropped — and breaking the cross-provider review safeguard which
    // reads modelName from upstream executions.
    const resolvedAgentConfig = await resolveExecutableAgentConfig(agentConfig, effectiveModelId);

    const runAgent = async (cfg: typeof agentConfig): Promise<WorkflowAdvanceResult> => {
      if (CLI_AGENT_TYPES.has(cfg.agentType)) {
        return await executeCLIAgent(
          taskId,
          task,
          cfg,
          systemPromptContent,
          context,
          transition,
          workflowInfo.dir,
          language,
          advanceFn,
          devConfigFn,
        );
      }
      return await executeAPIAgent(
        taskId,
        task,
        cfg,
        systemPromptContent,
        context,
        transition,
        workflowInfo.dir,
        language,
        advanceFn,
        devConfigFn,
      );
    };

    // Wrap the call in a single-retry fallback: if the chosen provider hits
    // a quota / rate-limit / auth error, mark it cooled-down and re-route
    // through Smart Router (which now skips cooling providers).
    //
    // Note we also treat "success but output contains a provider error" as a
    // failure for fallback purposes — Codex CLI prints "ERROR: You've hit
    // your usage limit..." but exits with code 0, so the success flag alone
    // is unreliable.
    try {
      const first = await runAgent(resolvedAgentConfig);
      const firstHasImplicitError = await hasProviderErrorInOutput(
        `${first.error ?? ''}\n${typeof first.output === 'string' ? first.output : ''}`,
      );
      if (first.success && !firstHasImplicitError) return first;

      const fallback = await tryProviderFallback({
        taskId,
        role: transition.role,
        currentConfig: resolvedAgentConfig,
        firstResult: first,
        runAgent,
      });
      if (fallback) return fallback;
      // Only override to failure when the original run itself failed.
      // If first.success=true but the output contained a provider-error
      // pattern, trust the clean exit rather than forcing failure — the
      // pattern check can false-positive when agents write code that handles
      // Anthropic rate limit errors (e.g. `error.type === 'rate_limit_error'`).
      if (firstHasImplicitError && !first.success) {
        return {
          ...first,
          error: first.error || 'Provider failure detected and no fallback completed successfully',
        };
      }
      return first;
    } catch (error: unknown) {
      // NOTE: Shutdown errors are not agent failures — skip fallback and re-throw so the runner
      // can requeue the item without consuming retry budget.
      if (isShutdownError(error)) {
        log.warn(
          `[WorkflowOrchestrator] ${transition.role} interrupted by shutdown — skipping fallback`,
        );
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[WorkflowOrchestrator] Error in ${transition.role}: ${errorMessage}`);

      // Thrown error path: also try fallback once.
      const fallback = await tryProviderFallback({
        taskId,
        role: transition.role,
        currentConfig: resolvedAgentConfig,
        firstResult: {
          success: false,
          role: transition.role,
          status: currentStatus as WorkflowStatus,
          error: errorMessage,
        },
        runAgent,
      });
      if (fallback?.success) return fallback;

      return {
        success: false,
        role: transition.role,
        status: currentStatus as WorkflowStatus,
        error: `実行エラー: ${errorMessage}`,
      };
    }
  }
}

/**
 * Score and persist a task's complexity so SmartRouter routes by real
 * complexity instead of its 50 default. The score is a heuristic over task
 * METADATA (title / description keywords, structured-spec counts, estimated
 * hours, priority, labels) — it does NOT scan the actual repository code.
 *
 * @param taskId - Task to score. / 対象タスクID
 * @param task - Already-loaded task row (scalar fields). / 取得済みタスク行
 */
/**
 * Compute the METADATA-heuristic complexity (title / description /
 * structured-spec counts) IN MEMORY — never persisted. task.complexityScore is
 * reserved for the research agent's code-grounded assessment; this transient
 * estimate only seeds the provisional workflow-mode pick before research.
 *
 * @param task - Task metadata fields. / タスクのメタデータ
 * @returns Heuristic 0-100 score. / ヒューリスティックスコア
 */
async function computeMetadataComplexity(task: {
  title: string;
  description: string | null;
  estimatedHours: number | null;
  priority: string | null;
  themeId: number | null;
  labels?: unknown;
  goals?: unknown;
  constraints?: unknown;
  acceptanceCriteria?: unknown;
}): Promise<number> {
  const { analyzeTaskComplexity } = await import('./complexity-analyzer');
  // labels/goals/constraints/acceptanceCriteria are persisted as JSON strings
  // (or already arrays). Parse tolerantly — never throw on malformed data.
  const parseArr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    if (typeof v === 'string' && v.trim()) {
      try {
        const p: unknown = JSON.parse(v);
        return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  const scored = analyzeTaskComplexity({
    title: task.title,
    description: task.description,
    estimatedHours: task.estimatedHours,
    labels: parseArr(task.labels),
    priority: task.priority ?? undefined,
    themeId: task.themeId,
    goals: parseArr(task.goals),
    constraints: parseArr(task.constraints),
    acceptanceCriteria: parseArr(task.acceptanceCriteria),
  });
  return scored.complexityScore;
}

async function resolveExecutableAgentConfig<
  T extends {
    id: number;
    agentType: string;
    name: string;
    modelId: string | null;
    apiKeyEncrypted?: string | null;
    endpoint?: string | null;
  },
>(agentConfig: T, effectiveModelId: string | null | undefined): Promise<T> {
  if (!effectiveModelId) return agentConfig;

  const [{ inferProviderFromModelId }, { agentTypeToProvider, findAgentConfigForProvider }] =
    await Promise.all([import('./role-provider-resolver'), import('../ai/agent-fallback')]);

  const modelProvider = inferProviderFromModelId(effectiveModelId);
  const currentProvider = agentTypeToProvider(agentConfig.agentType);
  if (modelProvider === currentProvider) {
    return { ...agentConfig, modelId: effectiveModelId };
  }
  if (!modelProvider) {
    // Unknown family — sending it blindly to the current agent leads to
    // claude-code rejecting `codex-auto-review` etc. with a 1.3s dead-end.
    // Verify the id at least looks like the agent's family; if not, drop
    // the override so the agent runs with its default DB modelId.
    const m = effectiveModelId.toLowerCase();
    const ok =
      (currentProvider === 'claude' && /^(claude|opus|sonnet|haiku|anthropic)/i.test(m)) ||
      (currentProvider === 'openai' && /^(gpt-|o\d|openai|chatgpt|codex)/i.test(m)) ||
      (currentProvider === 'gemini' && /^(gemini|google)/i.test(m)) ||
      (currentProvider === 'ollama' && /(ollama|llama|qwen|mistral|deepseek|phi|gemma)/i.test(m));
    if (!ok) {
      log.warn(
        {
          currentAgent: agentConfig.name,
          currentType: agentConfig.agentType,
          selectedModel: effectiveModelId,
        },
        'Selected model has unrecognised family — dropping override and using agent default',
      );
      return { ...agentConfig };
    }
    return { ...agentConfig, modelId: effectiveModelId };
  }

  const compatible = await findAgentConfigForProvider(modelProvider, {
    excludeConfigId: agentConfig.id,
  });
  if (!compatible) {
    // Foreign-provider model + no compatible agent — DON'T pass the model
    // to the current agent (it will reject it). Use the agent default.
    log.warn(
      {
        currentAgent: agentConfig.name,
        currentType: agentConfig.agentType,
        selectedModel: effectiveModelId,
        selectedProvider: modelProvider,
      },
      'Smart Router selected a model from another provider, but no compatible active agent config was found — dropping override and using agent default',
    );
    return { ...agentConfig };
  }

  log.info(
    {
      fromAgent: agentConfig.name,
      fromType: agentConfig.agentType,
      toAgent: compatible.name,
      toType: compatible.agentType,
      model: effectiveModelId,
    },
    'Switched workflow agent config to match selected model provider',
  );

  return {
    ...agentConfig,
    id: compatible.id,
    agentType: compatible.agentType,
    name: compatible.name,
    modelId: effectiveModelId,
    apiKeyEncrypted: compatible.apiKeyEncrypted,
    endpoint: compatible.endpoint,
  };
}

/**
 * Single-retry fallback when an agent run fails with a quota / rate-limit
 * style error. Classifies the failure, places the offending provider into
 * cooldown, then asks Smart Router for a fresh recommendation that
 * automatically excludes cooled-down providers.
 *
 * Returns null when no fallback is appropriate (auth errors, no
 * alternative, classification miss). The caller should then surface the
 * original failure to the user.
 */
async function tryProviderFallback(args: {
  taskId: number;
  role: WorkflowRole;
  currentConfig: {
    id: number;
    agentType: string;
    name: string;
    modelId: string | null;
    apiKeyEncrypted?: string | null;
    endpoint?: string | null;
  };
  firstResult: WorkflowAdvanceResult;
  runAgent: (cfg: never) => Promise<WorkflowAdvanceResult>;
}): Promise<WorkflowAdvanceResult | null> {
  const errorBlob = `${args.firstResult.error ?? ''}\n${
    typeof args.firstResult.output === 'string' ? args.firstResult.output : ''
  }`;
  if (!errorBlob.trim()) return null;

  const [
    { classifyAgentError },
    { markProviderCooldown },
    { getSmartRoute },
    { findAgentConfigForProvider },
    { inferProviderFromModelId },
  ] = await Promise.all([
    import('../ai/agent-error-classifier'),
    import('../ai/provider-cooldown'),
    import('../ai/smart-model-router'),
    import('../ai/agent-fallback'),
    import('./role-provider-resolver'),
  ]);

  const classified = classifyAgentError(errorBlob);
  if (!classified || !classified.retryWithFallback) return null;

  // This is the DELIBERATE provider-failure re-route the pin cache is meant
  // to defer to: drop this task+role's pinned model so the next ORDINARY
  // retry (a later advanceWorkflow call) recomputes fresh via
  // getStableSmartRoute instead of reusing a pin that is now known-bad (its
  // provider just entered cooldown, or its specific model is unavailable).
  const { invalidateStableRoute } = await import('../ai/model-route-stability');
  invalidateStableRoute(args.taskId, args.role);

  // NOTE: model_unavailable = specific model down, not the whole provider.
  // Retry with same agent config but no --model flag (CLI default). Skip cooldown
  // so the Claude provider remains available for subsequent phases.
  if (classified.reason === 'model_unavailable') {
    log.warn(
      {
        taskId: args.taskId,
        role: args.role,
        unavailableModel: args.currentConfig.modelId,
      },
      'Model unavailable — retrying with same provider, default model (no --model flag)',
    );
    return args.runAgent({ ...args.currentConfig, modelId: null } as never);
  }

  markProviderCooldown(classified.provider, classified.reason, classified.resetAt, {
    model: args.currentConfig.modelId ?? undefined,
    message: classified.rawMessage.slice(0, 200),
  });

  log.warn(
    {
      taskId: args.taskId,
      role: args.role,
      cooledProvider: classified.provider,
      reason: classified.reason,
    },
    'Provider failed — retrying with Smart Router fallback',
  );

  // Re-route. Smart Router will now skip cooled-down providers.
  let alternativeModel: string;
  try {
    const route = await getSmartRoute(args.taskId, {
      excludeProviders: [classified.provider],
    });
    alternativeModel = route.recommendedModel;
  } catch (err) {
    log.warn({ err, taskId: args.taskId }, 'Smart Router fallback failed');
    return null;
  }

  if (!alternativeModel || alternativeModel === args.currentConfig.modelId) {
    return null;
  }

  const provider = inferProviderFromModelId(alternativeModel);
  const fallbackDbConfig = provider
    ? await findAgentConfigForProvider(provider, { excludeConfigId: args.currentConfig.id })
    : null;
  const fallbackConfig = fallbackDbConfig
    ? {
        id: fallbackDbConfig.id,
        agentType: fallbackDbConfig.agentType,
        name: fallbackDbConfig.name,
        modelId: alternativeModel,
        apiKeyEncrypted: fallbackDbConfig.apiKeyEncrypted,
        endpoint: fallbackDbConfig.endpoint,
      }
    : { ...args.currentConfig, modelId: alternativeModel };
  const result = await args.runAgent(fallbackConfig as never);
  if (result.success) {
    log.info(
      { taskId: args.taskId, role: args.role, fallbackModel: alternativeModel },
      'Provider fallback succeeded',
    );
  }
  return result;
}

/**
 * Detect provider quota / rate-limit errors hiding in a successful agent's
 * output. Some CLIs (Codex) exit 0 even when they printed
 * "ERROR: You've hit your usage limit...", so we have to read the body.
 *
 * Uses strict mode so legitimate uses of words like "credit" or "rate limit"
 * in agent prose / code review output don't false-positive as failures.
 */
async function hasProviderErrorInOutput(blob: string): Promise<boolean> {
  if (!blob.trim()) return false;
  const { classifyAgentError } = await import('../ai/agent-error-classifier');
  const classified = classifyAgentError(blob, { strict: true });
  return !!classified && classified.retryWithFallback;
}
