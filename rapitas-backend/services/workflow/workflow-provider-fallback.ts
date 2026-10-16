/**
 * workflow-provider-fallback
 *
 * Single-retry provider fallback for workflow phase executions. Extracted
 * verbatim from workflow-orchestrator.ts (file-size ratchet — that file may
 * not grow), then instrumented with recovery-metrics recording (task 641).
 * Recording is fire-and-forget and never alters the fallback control flow.
 */
import { createLogger } from '../../config/logger';
import type { WorkflowRole, WorkflowAdvanceResult } from './workflow-types';
import type { RecoveryAttemptInput } from '../ai/recovery-metrics/recovery-metrics.types';

const log = createLogger('workflow-orchestrator');

/** Attempt facts shared by every record emitted for one failure. */
type AttemptBase = Pick<
  RecoveryAttemptInput,
  'taskId' | 'phase' | 'errorType' | 'fromProvider' | 'fromModel'
>;

/**
 * Fire-and-forget recovery-metrics write. The dynamic import mirrors this
 * module's other lazy service imports; any failure is swallowed — measurement
 * must never affect the fallback path it observes.
 */
function recordAttempt(input: RecoveryAttemptInput): void {
  void import('../ai/recovery-metrics')
    .then(({ recordRecoveryAttempt }) => recordRecoveryAttempt(input, Date.now()))
    .catch(() => {});
}

/**
 * Best-effort costUsd lookup for the fallback run's AgentExecution row.
 * Prisma stores costUsd as Decimal — normalized to number here.
 */
async function lookupExecutionCost(executionId: number | undefined): Promise<number | null> {
  if (!executionId) return null;
  try {
    const { prisma } = await import('../../config/database');
    const row = await prisma.agentExecution.findUnique({
      where: { id: executionId },
      select: { costUsd: true },
    });
    return row?.costUsd === null || row?.costUsd === undefined ? null : Number(row.costUsd);
  } catch {
    return null;
  }
}

/**
 * Record the outcome of an actually-executed fallback run. Success requires a
 * clean exit AND no provider-error pattern in the output (strict mode) — the
 * same verdict rule the manual executor path applies to its retries.
 */
function recordRunOutcome(
  base: AttemptBase,
  strategy: 'reroute' | 'model-strip',
  toProvider: string | null,
  result: WorkflowAdvanceResult,
  latencyMs: number,
): void {
  void (async () => {
    const blob = `${result.error ?? ''}\n${typeof result.output === 'string' ? result.output : ''}`;
    const { classifyAgentError } = await import('../ai/agent-error-classifier');
    const strictClassified = blob.trim() ? classifyAgentError(blob, { strict: true }) : null;
    const succeeded = result.success && !strictClassified?.retryWithFallback;
    const costUsd = await lookupExecutionCost(result.executionId);
    const { recordRecoveryAttempt } = await import('../ai/recovery-metrics');
    recordRecoveryAttempt(
      {
        ...base,
        strategy,
        toProvider,
        outcome: succeeded ? 'success' : 'failure',
        latencyMs,
        costUsd,
        failureReason: succeeded ? null : (strictClassified?.reason ?? null),
      },
      Date.now(),
    );
  })().catch(() => {});
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
export async function tryProviderFallback(args: {
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
    { findAgentConfigForProvider, agentTypeToProvider },
    { inferProviderFromModelId },
  ] = await Promise.all([
    import('../ai/agent-error-classifier'),
    import('../ai/provider-cooldown'),
    import('../ai/smart-model-router'),
    import('../ai/agent-fallback'),
    import('./role-provider-resolver'),
  ]);

  const classified = classifyAgentError(errorBlob);
  const base: AttemptBase = {
    taskId: args.taskId,
    phase: args.role,
    errorType: classified?.reason ?? 'unclassified',
    fromProvider:
      classified?.provider ??
      agentTypeToProvider(args.currentConfig.agentType) ??
      args.currentConfig.agentType,
    fromModel: args.currentConfig.modelId,
  };
  if (!classified || !classified.retryWithFallback) {
    recordAttempt({ ...base, strategy: 'none', outcome: 'no_candidate' });
    return null;
  }

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
    const stripStartedMs = Date.now();
    const stripResult = await args.runAgent({ ...args.currentConfig, modelId: null } as never);
    recordRunOutcome(
      base,
      'model-strip',
      base.fromProvider,
      stripResult,
      Date.now() - stripStartedMs,
    );
    return stripResult;
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
    // Audit trail: record the failure-driven re-route (api_call). Fire-and-forget;
    // dynamic import mirrors this function's other lazy service imports.
    const rerouteModel = alternativeModel;
    void import('../observability/decision-trace')
      .then(({ recordDecision }) =>
        recordDecision({
          taskId: args.taskId,
          nodeKey: `task${args.taskId}:provider-fallback:${Date.now()}`,
          kind: 'api_call',
          summary: `プロバイダフォールバック: ${rerouteModel}`,
          input: {
            role: args.role,
            failedProvider: classified.provider,
            failureReason: classified.reason,
            previousModel: args.currentConfig.modelId,
          },
          candidates: [{ id: rerouteModel, label: 'フォールバック候補' }],
          adoptedId: rerouteModel,
          adoptedReason: `プロバイダ ${classified.provider} が ${classified.reason} で cooldown に入ったための再ルーティング`,
        }),
      )
      .catch(() => {});
  } catch (err) {
    log.warn({ err, taskId: args.taskId }, 'Smart Router fallback failed');
    recordAttempt({ ...base, strategy: 'none', outcome: 'no_candidate' });
    return null;
  }

  if (!alternativeModel || alternativeModel === args.currentConfig.modelId) {
    recordAttempt({ ...base, strategy: 'none', outcome: 'no_candidate' });
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
  const rerouteStartedMs = Date.now();
  const result = await args.runAgent(fallbackConfig as never);
  recordRunOutcome(base, 'reroute', provider ?? null, result, Date.now() - rerouteStartedMs);
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
export async function hasProviderErrorInOutput(blob: string): Promise<boolean> {
  if (!blob.trim()) return false;
  const { classifyAgentError } = await import('../ai/agent-error-classifier');
  const classified = classifyAgentError(blob, { strict: true });
  return !!classified && classified.retryWithFallback;
}
