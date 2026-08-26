/**
 * probe-targets
 *
 * The two probe target implementations run before every phase transition: DB
 * connectivity and the assigned agent's endpoint/CLI reachability. Adding a
 * new target means adding one entry here — no other module needs to change.
 */
import { prisma } from '../../../config/database';
import { agentTypeToProvider } from '../../ai/agent-fallback';
import { discoverModels } from '../../ai/model-discovery';
import type { ProbeContext, ProbeTarget } from './probe.types';

/**
 * Confirms the database connection is alive. Same query as /health.
 *
 * @param _ctx - Unused; DB connectivity does not depend on the task/agent. / 未使用
 */
async function runDbProbe(_ctx: ProbeContext): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

/**
 * Confirms the role's assigned agent is reachable. Unknown agent types are
 * out of scope for this probe (prepareAgentAndPrompt already validates agent
 * assignment before the probe stage runs) — the probe silently no-ops rather
 * than failing on a concern it does not own.
 *
 * @param ctx - Probe context carrying the resolved agentConfig. / probeコンテキスト
 * @param attempt - Zero-based attempt index; forces discoverModels to bypass
 *   its own cache on retry, otherwise a retry would just re-read the same
 *   stale negative result. / 0始まりの試行インデックス
 */
async function runAgentEndpointProbe(ctx: ProbeContext, attempt: number): Promise<void> {
  const provider = agentTypeToProvider(ctx.agentConfig.agentType);
  if (!provider) return;
  const { providers } = await discoverModels(attempt > 0, { cliOnly: true });
  const found = providers.find((p) => p.provider === provider);
  if (!found?.available) {
    throw new Error(`agent endpoint unavailable for provider "${provider}"`);
  }
}

/** All probe targets run before a phase transition, in declaration order. */
export const PROBE_TARGETS: ProbeTarget[] = [
  { id: 'db', run: runDbProbe },
  { id: 'agent-endpoint', run: runAgentEndpointProbe },
];
