/**
 * Workflow Orchestrator — Executable Agent Config
 *
 * Reconciles the resolved model id with the agent config's provider (same
 * provider → apply override, unknown family → sanity-check, foreign provider →
 * switch to a compatible agent). Moved verbatim from workflow-orchestrator.ts
 * (file-size ratchet, task 627); behavior is unchanged.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('workflow-orchestrator');

/**
 * Applies the effective model id to an agent config, switching to another
 * agent config when the model belongs to a different provider.
 *
 * @param agentConfig - Agent config resolved for the role. / ロールに解決されたエージェント設定
 * @param effectiveModelId - Model id to apply (may be null). / 適用するモデルID
 * @returns Agent config to execute with. / 実行に用いるエージェント設定
 */
export async function resolveExecutableAgentConfig<
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
