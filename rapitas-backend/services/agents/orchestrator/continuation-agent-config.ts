/**
 * ContinuationAgentConfig
 *
 * Builds the AgentConfigInput for a continuation execution from DB records.
 * Does NOT start agents, manage state, or interact with the event bus.
 */
import type { AgentConfigInput, AgentType } from '../agent-factory';
import { resolveStoredSecret } from '../../../utils/common/secret-store';
import { createLogger } from '../../../config/logger';
import type { ExecutionOptions } from './types';

const logger = createLogger('continuation-agent-config');

/** Minimal execution shape needed to build an agent config. */
export interface ExecutionForConfig {
  agentConfigId: number | null;
  claudeSessionId: string | null;
  session: {
    config?: {
      task?: {
        workingDirectory?: string | null;
      } | null;
    } | null;
  };
}

/** Minimal AIAgentConfig row returned from Prisma. */
export interface DbAgentConfig {
  id: number;
  agentType: string | null;
  name: string;
  endpoint: string | null;
  apiKeyEncrypted: string | null;
  modelId: string | null;
}

/**
 * Builds an AgentConfigInput for a continuation by optionally merging a persisted DB config.
 * Falls back to a default claude-code config when no DB config is associated.
 *
 * @param execution - Execution record with session/config nested / セッション・設定がネストされた実行レコード
 * @param options - Execution options (timeout, etc.) / 実行オプション
 * @param dbConfig - Optional persisted AI agent config row / 任意の保存されたAIエージェント設定行
 * @returns AgentConfigInput ready for agentFactory.createAgent / agentFactory.createAgentに渡せるAgentConfigInput
 */
export function buildContinuationAgentConfig(
  execution: ExecutionForConfig,
  options: Partial<ExecutionOptions>,
  dbConfig?: DbAgentConfig | null,
): AgentConfigInput {
  const task = execution.session.config?.task;
  const claudeSessionId = execution.claudeSessionId;

  const baseConfig: AgentConfigInput = {
    type: 'claude-code',
    name: 'Claude Code Agent',
    workingDirectory: task?.workingDirectory || undefined,
    timeout: options.timeout,
    dangerouslySkipPermissions: true,
    resumeSessionId: claudeSessionId || undefined,
    continueConversation: !claudeSessionId,
  };

  if (!dbConfig) {
    return baseConfig;
  }

  let decryptedApiKey: string | undefined;
  if (dbConfig.apiKeyEncrypted) {
    try {
      decryptedApiKey = resolveStoredSecret(dbConfig.apiKeyEncrypted) ?? undefined;
    } catch (e) {
      logger.error(
        { err: e, agentId: dbConfig.id },
        `[ContinuationAgentConfig] Failed to decrypt API key for agent`,
      );
    }
  }

  return {
    type: (dbConfig.agentType as AgentType) || 'claude-code',
    name: dbConfig.name,
    endpoint: dbConfig.endpoint || undefined,
    apiKey: decryptedApiKey,
    modelId: dbConfig.modelId || undefined,
    workingDirectory: task?.workingDirectory || undefined,
    timeout: options.timeout,
    dangerouslySkipPermissions: true,
    yoloMode: true,
    resumeSessionId: claudeSessionId || undefined,
    continueConversation: !claudeSessionId,
  };
}
