/**
 * queue-provider-gate
 *
 * Answers one question for the workflow queue: is ANY configured agent
 * provider usable right now, or is every one of them in cooldown?
 *
 * The queue uses this to PAUSE instead of destroying work when a provider
 * outage (quota exhaustion, rate limiting) makes every attempt fail. It never
 * chooses a provider — that stays with the Smart Router.
 */
import { prisma } from '../../config/database';
import { isProviderInCooldown } from '../ai/provider-cooldown';
import { agentTypeToProvider } from '../ai/agent-fallback';

/**
 * Whether at least one active agent config belongs to a provider that is not
 * currently cooling down.
 *
 * Fails OPEN: if the lookup throws, or no config maps to a known provider, the
 * answer is `true` so a bookkeeping problem can never wedge the queue.
 *
 * @returns true when work can be dispatched right now. / 実行可能なプロバイダがあれば true
 */
export async function hasUsableProvider(): Promise<boolean> {
  try {
    const configs = await prisma.aIAgentConfig.findMany({
      where: { isActive: true },
      select: { agentType: true },
    });
    const providers = configs
      .map((c) => agentTypeToProvider(c.agentType))
      .filter((p): p is NonNullable<ReturnType<typeof agentTypeToProvider>> => p !== null);
    if (providers.length === 0) return true;
    return providers.some((p) => !isProviderInCooldown(p));
  } catch {
    return true;
  }
}

/**
 * Whether a phase failure was caused by the PROVIDER being unavailable rather
 * than by anything the workflow did.
 *
 * Retrying such a failure is free of information — the run never reached the
 * model — so the queue must not spend one of the task's finite retries on it.
 * Measured 2026-08-19: a spend-limit outage consumed all three retries of
 * every runnable task within ten minutes and left them permanently blocked.
 *
 * @param reason - The recorded failure message, if any. / 失敗理由
 * @returns true for quota / rate-limit style provider outages. / プロバイダ側障害なら true
 */
export async function isProviderOutageFailure(reason?: string | null): Promise<boolean> {
  const text = (reason ?? '').trim();
  if (!text) return false;
  const { classifyAgentError } = await import('../ai/agent-error-classifier');
  const classified = classifyAgentError(text);
  return classified?.reason === 'quota' || classified?.reason === 'rate_limit';
}
