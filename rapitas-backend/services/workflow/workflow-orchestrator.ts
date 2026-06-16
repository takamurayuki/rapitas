/**
 * Workflow Orchestrator
 *
 * Manages automatic progression of workflow phases and executes AI agents assigned to each phase.
 * CLI agents (claude-code, gemini, codex) run via AgentOrchestrator.
 * API agents (anthropic-api, openai, etc.) call APIs directly and save output files on their behalf.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { resolveWorkflowDir, readWorkflowFile } from './workflow-file-utils';
import { buildRoleContext, applyPlanModeDirective } from './workflow-context-builder';
import {
  executeCLIAgent,
  executeAPIAgent,
  type RoleTransition,
  type WorkflowAdvanceResult,
} from './workflow-agent-executor';
import {
  acquireTaskExecutionLock,
  releaseTaskExecutionLock,
  WORKFLOW_LOCK_TTL_MS,
} from '../agents/task-execution-lock';
import { DEFAULT_SYSTEM_PROMPTS } from '../../routes/ai/system-prompts/default-prompts';
import { isReusableArtifact } from './phase-output-validator';

// Re-export sub-module helpers so existing imports from this path keep working.
export { resolveWorkflowDir, readWorkflowFile, writeWorkflowFile } from './workflow-file-utils';
export type { WorkflowFileType } from './workflow-file-utils';
export { buildRoleContext } from './workflow-context-builder';
export { callAnthropicAPI, callOpenAIAPI, decryptApiKey } from './workflow-api-callers';
export type { WorkflowAdvanceResult } from './workflow-agent-executor';

const log = createLogger('workflow-orchestrator');

type WorkflowRole =
  | 'researcher'
  | 'planner'
  | 'reviewer'
  | 'implementer'
  | 'verifier'
  | 'auto_verifier';
type WorkflowFileType = 'research' | 'question' | 'plan' | 'verify';
type WorkflowStatus =
  | 'draft'
  | 'research_done'
  | 'plan_created'
  | 'plan_approved'
  | 'in_progress'
  | 'verify_done'
  | 'completed';
type WorkflowMode = 'lightweight' | 'standard' | 'comprehensive';

// NOTE: The per-mode transition tables were moved to workflow-mode-config.ts,
// which builds them from DB-backed, UI-editable settings (single source of
// truth, shared with role-resolver and the frontend). Research is mandatory in
// every mode; the tiers diverge by ceremony (plan / review / auto-verify).

const CLI_AGENT_TYPES = new Set(['claude-code', 'codex', 'gemini']);

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
    // WORKFLOW_LOCK_TTL_MS (15min) intentionally exceeds the WorkflowRunner's
    // 10-min per-phase timeout so a long phase cannot have its lock stolen.
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
        status: ((current?.workflowStatus as WorkflowStatus) || 'draft') as WorkflowStatus,
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
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { theme: { include: { category: true } } },
    });
    if (!task) {
      return {
        success: false,
        role: 'researcher',
        status: 'draft',
        error: 'タスクが見つかりません',
      };
    }

    // Build the transition table from the (DB-backed, UI-editable) mode config.
    // Single source of truth — see workflow-mode-config.ts.
    const workflowMode = (task.workflowMode as WorkflowMode) || 'comprehensive';
    const { getModeSettings, buildTransitions } = await import('./workflow-mode-config');
    const modeSettings = await getModeSettings(workflowMode);
    const modeTransitions = buildTransitions(modeSettings);

    const currentStatus = (task.workflowStatus as string) || 'draft';
    const transition = modeTransitions[currentStatus];
    if (!transition) {
      return {
        success: false,
        role: 'researcher',
        status: currentStatus as WorkflowStatus,
        error: `ステータス "${currentStatus}" では次のフェーズを実行できません`,
      };
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
        status: currentStatus as WorkflowStatus,
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
    if (systemPromptContent) {
      const planContent = await readWorkflowFile(workflowInfo.dir, 'plan');
      systemPromptContent = applyPlanModeDirective(
        transition.role,
        systemPromptContent,
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

    const context = await buildRoleContext(
      taskId,
      transition.role,
      workflowInfo.dir,
      task,
      language,
    );

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
        // Ensure the task has a complexity score BEFORE routing. Only the manual
        // execute-route scored it; the auto-run path never did, so every
        // auto-run phase fell back to SmartRouter's complexity=50 default
        // ('standard'). NOTE: this score is a metadata heuristic (title /
        // description / structured-spec counts), NOT a scan of the actual repo
        // code — an a-priori estimate, refined by history elsewhere.
        if (task.complexityScore == null) {
          await scoreTaskComplexity(taskId, task).catch((err) =>
            log.warn({ err, taskId }, '[WorkflowOrchestrator] Complexity scoring failed'),
          );
        }

        const [
          { getSmartRoute },
          { resolveRoleProviderPreferences },
          { computeMinTier, detectHighRisk },
          { WorkflowQueueService },
        ] = await Promise.all([
          import('../ai/smart-model-router'),
          import('./role-provider-resolver'),
          import('./routing-policy'),
          import('./workflow-queue'),
        ]);
        const prefs = await resolveRoleProviderPreferences(transition.role, taskId);

        // Failure escalation: a phase that already failed (queue retryCount > 0)
        // gets a STRONGER model on the retry instead of re-running the same weak
        // one. Reuses the existing per-task queue retry counter.
        const queueItem = await WorkflowQueueService.getInstance()
          .findByTaskId(taskId)
          .catch(() => null);
        const escalation = queueItem?.retryCount ?? 0;

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

        // Role floor + escalation + risk → the minimum tier SmartRouter may not
        // go below (it still RAISES further when complexity is high).
        const minTier = computeMinTier({ role: transition.role, escalation, riskHigh });
        const route = await getSmartRoute(taskId, {
          ...prefs,
          minTier,
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
            escalation,
            riskHigh,
            riskReason: riskReason ?? null,
            preferredProvider: prefs.preferredProvider ?? null,
            excludeProviders: prefs.excludeProviders ?? [],
          },
          'Auto-selected model via Smart Router',
        );
      } catch {
        effectiveModelId = 'claude-haiku-4-5-20251001';
        log.warn({ taskId }, 'Smart Router failed, falling back to Haiku');
      }
    }

    if (currentStatus === 'draft') {
      await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: 'draft', status: 'in-progress' },
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
      if (firstHasImplicitError) {
        return {
          ...first,
          success: false,
          error: first.error || 'Provider failure detected and no fallback completed successfully',
        };
      }
      return first;
    } catch (error: unknown) {
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
async function scoreTaskComplexity(
  taskId: number,
  task: {
    title: string;
    description: string | null;
    estimatedHours: number | null;
    priority: string | null;
    themeId: number | null;
    labels?: unknown;
    goals?: unknown;
    constraints?: unknown;
    acceptanceCriteria?: unknown;
  },
): Promise<void> {
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
  await prisma.task.update({
    where: { id: taskId },
    data: { complexityScore: scored.complexityScore },
  });
  log.info(
    { taskId, complexityScore: scored.complexityScore },
    '[WorkflowOrchestrator] Scored task complexity for routing',
  );
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
