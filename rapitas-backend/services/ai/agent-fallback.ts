/**
 * Agent Fallback
 *
 * Helpers used by execution paths to recover from a provider quota / rate-limit
 * / auth failure: classify the error, mark cooldown, and pick a different
 * AIAgentConfig that uses an unaffected provider.
 *
 * Used by:
 *   - services/workflow/workflow-orchestrator (research/plan/verify phases)
 *   - services/agents/orchestrator/task-executor (manual /agents/execute and
 *     parallel-execution paths)
 *
 * The helper is intentionally cheap (single DB lookup) so callers can invoke
 * it inline after the first failure without orchestration overhead.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { classifyAgentError, type ClassifiedError } from './agent-error-classifier';
import { isProviderInCooldown, markProviderCooldown, type Provider } from './provider-cooldown';

const log = createLogger('agent-fallback');

/**
 * Map a stored agentType string to the canonical Provider used by the
 * cooldown registry and Smart Router. Free-form strings are tolerated to
 * keep us aligned with whatever the DB already contains.
 */
export function agentTypeToProvider(agentType: string | null | undefined): Provider | null {
  if (!agentType) return null;
  const t = agentType.toLowerCase();
  if (t === 'claude-code' || t === 'anthropic-api' || t === 'claude') return 'claude';
  if (t === 'codex' || t === 'codex-cli' || t === 'openai' || t === 'chatgpt') return 'openai';
  if (t === 'gemini-cli' || t === 'gemini' || t === 'google-gemini') return 'gemini';
  if (t === 'ollama' || t === 'ollama-cli') return 'ollama';
  return null;
}

export function providerToAgentTypes(provider: Provider): string[] {
  switch (provider) {
    case 'claude':
      return ['claude-code', 'anthropic-api', 'claude'];
    case 'openai':
      return ['codex', 'codex-cli', 'openai', 'chatgpt'];
    case 'gemini':
      return ['gemini-cli', 'gemini', 'google-gemini'];
    case 'ollama':
      return ['ollama', 'ollama-cli'];
  }
}

/**
 * Find an active agent config that can execute a model/provider selected by
 * Smart Router. This prevents invalid combinations such as `claude-code`
 * with a `gpt-*` model id.
 */
export async function findAgentConfigForProvider(
  provider: Provider,
  opts?: { excludeConfigId?: number },
): Promise<Awaited<ReturnType<typeof prisma.aIAgentConfig.findFirst>> | null> {
  if (isProviderInCooldown(provider)) return null;
  const agentTypes = providerToAgentTypes(provider);
  const candidates = await prisma.aIAgentConfig.findMany({
    where: { isActive: true, agentType: { in: agentTypes } },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  });
  return candidates.find((c) => c.id !== opts?.excludeConfigId) ?? candidates[0] ?? null;
}

/**
 * Look at a failed agent execution and decide whether to retry with a
 * different agent config. Side-effects: places the failed provider into
 * cooldown when the error matches a known quota/rate-limit pattern.
 *
 * @param errorBlob - errorMessage + tail of stdout from the failed run
 * @param currentAgentType - agentType of the agent that just failed
 * @returns The fallback agent config to try next, or null when no
 *   alternative is available or fallback is inappropriate (auth errors).
 */
export async function findFallbackAgentConfig(
  errorBlob: string,
  currentAgentType: string | null | undefined,
): Promise<{
  agentConfig: Awaited<ReturnType<typeof prisma.aIAgentConfig.findFirst>>;
  classified: ClassifiedError;
} | null> {
  if (!errorBlob.trim()) return null;

  const currentProvider = agentTypeToProvider(currentAgentType);
  const classified = classifyAgentError(errorBlob, currentProvider ?? undefined);
  if (!classified || !classified.retryWithFallback) return null;

  // Place the failed provider into cooldown so subsequent automatic routing
  // (Smart Router, listActiveCooldowns, this very lookup) skips it.
  markProviderCooldown(classified.provider, classified.reason, classified.resetAt, {
    message: classified.rawMessage.slice(0, 200),
  });

  // Pick the most appropriate alternative: prefer the user's default,
  // otherwise the most recently updated active config from a different
  // provider that isn't itself in cooldown.
  const candidates = await prisma.aIAgentConfig.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  });

  for (const c of candidates) {
    const provider = agentTypeToProvider(c.agentType);
    if (!provider) continue;
    if (provider === classified.provider) continue;
    if (isProviderInCooldown(provider)) continue;
    log.info(
      {
        cooledProvider: classified.provider,
        chosenProvider: provider,
        chosenAgent: c.name,
      },
      'Falling back to alternative agent config',
    );
    return { agentConfig: c, classified };
  }

  log.warn(
    { cooledProvider: classified.provider },
    'No alternative agent config available for fallback',
  );
  return null;
}
