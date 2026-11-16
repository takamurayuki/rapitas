/**
 * model-provider-alignment
 *
 * Makes the executor agent able to run the model chosen for a manual run:
 * switches to an agent of the model's provider, or drops a model override the
 * current agent cannot run. Not responsible for choosing the model itself
 * (WorkflowRoleConfig / Smart Router in execute-route.ts).
 *
 * NOTE: Extracted from routes/execute-route.ts unchanged (file-size baseline);
 * it mirrors `resolveExecutableAgentConfig` in workflow-orchestrator.
 */
import { prisma } from '../../../../config/database';
import { createLogger } from '../../../../config/logger';

const log = createLogger('routes:agent-execution:execute');

/**
 * Switch the executor agent to one matching the chosen model's provider.
 *
 * When SmartRouter (or a per-role explicit model) selects a model from a
 * different provider than the resolved agent's CLI, the original agent (e.g.
 * claude-code) cannot honor `--model gpt-...` and silently falls back to its
 * default. Picking a compatible agent (codex for openai, gemini-cli for
 * gemini, …) is what makes preferredProviderOverride take effect end-to-end.
 * Never throws: a lookup failure leaves both values as they were.
 *
 * @param p.taskId - Task being executed (log context) / 実行するタスク
 * @param p.role - Workflow role, when resolved (log context) / ワークフローのロール
 * @param p.agentConfigId - Agent resolved so far / 現在のエージェント設定ID
 * @param p.modelId - Model chosen for the run / 選ばれたモデル
 * @returns The agent to run and the model to pass (undefined = agent default) / 実行するエージェントと渡すモデル
 */
export async function alignAgentWithModelProvider(p: {
  taskId: number;
  role: string | undefined;
  agentConfigId: number;
  modelId: string;
}): Promise<{ agentConfigId: number; modelId: string | undefined }> {
  const { taskId, role } = p;
  let agentConfigId = p.agentConfigId;
  let modelId: string | undefined = p.modelId;
  try {
    const [{ inferProviderFromModelId }, { agentTypeToProvider, findAgentConfigForProvider }] =
      await Promise.all([
        import('../../../../services/workflow/role-provider-resolver'),
        import('../../../../services/ai/agent-fallback'),
      ]);
    const targetProvider = inferProviderFromModelId(modelId);
    const currentAgent = await prisma.aIAgentConfig
      .findUnique({
        where: { id: agentConfigId },
        select: { id: true, agentType: true, name: true },
      })
      .catch(() => null);
    const currentProvider = agentTypeToProvider(currentAgent?.agentType);
    if (targetProvider && currentProvider && targetProvider !== currentProvider) {
      const compatible = await findAgentConfigForProvider(targetProvider, {
        excludeConfigId: agentConfigId,
      });
      if (compatible) {
        log.info(
          {
            taskId,
            role,
            model: modelId,
            fromAgent: currentAgent?.name,
            fromType: currentAgent?.agentType,
            toAgent: compatible.name,
            toType: compatible.agentType,
          },
          '[API] Switched executor agent to match selected model provider',
        );
        agentConfigId = compatible.id;
      } else {
        // No compatible agent — passing the foreign-provider model to
        // the current agent will make the CLI reject it (e.g.
        // claude-code seeing `codex-auto-review`). Drop the override
        // so the agent uses its DB-configured default model instead.
        log.warn(
          {
            taskId,
            role,
            model: modelId,
            targetProvider,
            currentAgentType: currentAgent?.agentType,
          },
          '[API] No compatible agent for selected model provider — DROPPING modelIdOverride and falling back to agent default',
        );
        modelId = undefined;
      }
    } else if (!targetProvider) {
      // We picked a model whose family we cannot infer (new release
      // naming, custom alias, …). Sending an unknown id to claude-code
      // produces "There's an issue with the selected model" and a 1.3s
      // dead-end. Verify the model name at least starts with a hint
      // matching the current agent's provider; otherwise drop the
      // override so the agent uses its default.
      const looksLikeOurFamily =
        (currentProvider === 'claude' && /^(claude|opus|sonnet|haiku|anthropic)/i.test(modelId)) ||
        (currentProvider === 'openai' && /^(gpt-|o\d|openai|chatgpt|codex)/i.test(modelId)) ||
        (currentProvider === 'gemini' && /^(gemini|google)/i.test(modelId)) ||
        (currentProvider === 'ollama' &&
          /(ollama|llama|qwen|mistral|deepseek|phi|gemma)/i.test(modelId));
      if (!looksLikeOurFamily) {
        log.warn(
          {
            taskId,
            role,
            model: modelId,
            currentAgentType: currentAgent?.agentType,
          },
          '[API] Selected model does not match agent provider family — DROPPING modelIdOverride',
        );
        modelId = undefined;
      }
    }
  } catch (switchErr) {
    log.warn(
      { err: switchErr, taskId },
      '[API] Failed to align executor agent with model provider',
    );
  }
  return { agentConfigId, modelId };
}
