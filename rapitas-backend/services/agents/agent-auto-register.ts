/**
 * Agent Auto-Register
 *
 * Registers AIAgentConfig rows for ONLY the providers that are actually
 * available right now (detected by the model-discovery probes — installed CLI
 * or a reachable API). Idempotent: existing rows are reactivated rather than
 * duplicated. Ensures exactly one default (prefers Claude Code).
 *
 * This is why a fresh/reset DB starts with zero agents — there is no implicit
 * seed; the user (or this routine) must register the agents they can use.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { discoverModels } from '../ai/model-discovery';

const log = createLogger('agent-auto-register');

/** Discovery provider → the AIAgentConfig.agentType used for it. */
const PROVIDER_AGENT_TYPE: Record<string, string> = {
  claude: 'claude-code',
  openai: 'codex',
  gemini: 'gemini-cli',
  ollama: 'ollama',
};

const PROVIDER_NAME: Record<string, string> = {
  claude: 'Claude Code',
  openai: 'Codex',
  gemini: 'Gemini CLI',
  ollama: 'Ollama',
};

export interface AutoRegisterResult {
  registered: Array<{
    id: number;
    agentType: string;
    name: string;
    modelId: string | null;
    isDefault: boolean;
  }>;
  skipped: Array<{ provider: string; reason: string }>;
}

/**
 * Detect available providers and register an agent config for each. Only valid
 * (available) providers are registered; unavailable ones are reported as skipped.
 *
 * @returns Registered agents + skipped providers with reasons. / 登録結果
 */
export async function autoRegisterAvailableAgents(): Promise<AutoRegisterResult> {
  const { providers, models } = await discoverModels();

  const registered: AutoRegisterResult['registered'] = [];
  const skipped: AutoRegisterResult['skipped'] = [];

  for (const probe of providers) {
    const agentType = PROVIDER_AGENT_TYPE[probe.provider];
    if (!agentType) continue;
    if (!probe.available) {
      skipped.push({ provider: probe.provider, reason: probe.reason || '利用不可' });
      continue;
    }

    // Prefer the first discovered model for this provider as the default.
    const defaultModel = models.find((m) => m.provider === probe.provider)?.id ?? null;

    const existing = await prisma.aIAgentConfig.findFirst({ where: { agentType } });
    const row = existing
      ? await prisma.aIAgentConfig.update({
          where: { id: existing.id },
          // Reactivate; only seed a model if none was set so we don't clobber a
          // user's explicit choice.
          data: {
            isActive: true,
            isInstalled: true,
            ...(existing.modelId ? {} : { modelId: defaultModel }),
          },
        })
      : await prisma.aIAgentConfig.create({
          data: {
            agentType,
            name: PROVIDER_NAME[probe.provider] ?? agentType,
            isActive: true,
            isInstalled: true,
            modelId: defaultModel,
          },
        });
    registered.push({
      id: row.id,
      agentType: row.agentType,
      name: row.name,
      modelId: row.modelId,
      isDefault: row.isDefault,
    });
  }

  // Ensure exactly one default among the active agents (prefer Claude Code).
  const active = await prisma.aIAgentConfig.findMany({ where: { isActive: true } });
  if (active.length > 0 && !active.some((a) => a.isDefault)) {
    const pick = active.find((a) => a.agentType === 'claude-code') ?? active[0];
    await prisma.aIAgentConfig.update({ where: { id: pick.id }, data: { isDefault: true } });
    const hit = registered.find((r) => r.id === pick.id);
    if (hit) hit.isDefault = true;
  }

  log.info(
    { registered: registered.length, skipped: skipped.map((s) => s.provider) },
    '[agent-auto-register] Completed',
  );
  return { registered, skipped };
}
