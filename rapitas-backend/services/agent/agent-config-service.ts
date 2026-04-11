/**
 * Agent Configuration Service
 *
 * Re-exports all agent configuration operations and the AgentConfigService class
 * for backward compatibility. Implementation has been split into sub-modules
 * under services/agent-config/.
 */

export type {
  CreateAgentConfigRequest,
  UpdateAgentConfigRequest,
  ValidationError,
  ValidationResult,
} from '../agent-config/types';

export {
  getActiveAgents,
  getAllAgents,
  getAgentById,
  getDefaultAgent,
  createAgentConfig,
  updateAgentConfig,
  toggleAgentActive,
  deleteAgentConfig,
  setDefaultAgent,
  clearDefaultAgent,
} from '../agent-config/crud';

export { validateConfig } from '../agent-config/validation';

export {
  setApiKey,
  deleteApiKey,
  getApiKey,
  getMaskedApiKey,
  getCapabilities,
  updateCapabilities,
} from '../agent-config/api-key';

import { createLogger } from '../../config/logger';
import { getAgentConfigSchema } from '../../utils/agent/agent-config-schema';
import {
  getActiveAgents,
  getAllAgents,
  getAgentById,
  getDefaultAgent,
  createAgentConfig,
  updateAgentConfig,
  toggleAgentActive,
  deleteAgentConfig,
  setDefaultAgent,
  clearDefaultAgent,
} from '../agent-config/crud';
import { validateConfig } from '../agent-config/validation';
import {
  setApiKey,
  deleteApiKey,
  getApiKey,
  getMaskedApiKey,
  getCapabilities,
  updateCapabilities,
} from '../agent-config/api-key';
import type {
  CreateAgentConfigRequest,
  UpdateAgentConfigRequest,
  ValidationResult,
} from '../agent-config/types';

// NOTE: AgentConfigService class preserved for backward compatibility with callers that
// instantiate the service via `new AgentConfigService()` or use the singleton export.
export class AgentConfigService {
  /** Retrieves all active agent configurations. */
  async getActiveAgents() {
    return getActiveAgents();
  }

  /** Retrieves all agent configurations including inactive ones. */
  async getAllAgents() {
    return getAllAgents();
  }

  /**
   * Finds an agent configuration by its ID.
   *
   * @param id - Primary key of the record / レコードの主キー
   */
  async getAgentById(id: number) {
    return getAgentById(id);
  }

  /** Returns the default active agent, falling back to a built-in Claude Code config. */
  async getDefaultAgent() {
    return getDefaultAgent();
  }

  /**
   * Creates a new agent configuration with validation and encryption.
   *
   * @param config - Creation request payload / 作成リクエストペイロード
   */
  async createAgentConfig(config: CreateAgentConfigRequest) {
    return createAgentConfig(config);
  }

  /**
   * Updates an existing agent configuration.
   *
   * @param id - ID of the record to update / 更新するレコードのID
   * @param updates - Partial update payload / 部分更新ペイロード
   */
  async updateAgentConfig(id: number, updates: UpdateAgentConfigRequest) {
    return updateAgentConfig(id, updates);
  }

  /**
   * Toggles the active state of an agent configuration.
   *
   * @param id - ID of the agent config / エージェント設定のID
   */
  async toggleAgentActive(id: number) {
    return toggleAgentActive(id);
  }

  /**
   * Soft-deletes an agent configuration by deactivating it.
   *
   * @param id - ID of the record / レコードのID
   */
  async deleteAgentConfig(id: number) {
    return deleteAgentConfig(id);
  }

  /**
   * Sets a specific agent as the default.
   *
   * @param id - ID of the agent to set as default / デフォルトに設定するエージェントのID
   */
  async setDefaultAgent(id: number) {
    return setDefaultAgent(id);
  }

  /** Clears the default flag on all agents. */
  async clearDefaultAgent() {
    return clearDefaultAgent();
  }

  /**
   * Sets and encrypts an API key for a specific agent.
   *
   * @param id - ID of the agent config / エージェント設定のID
   * @param apiKey - Plain-text API key / 平文APIキー
   */
  async setApiKey(id: number, apiKey: string) {
    return setApiKey(id, apiKey);
  }

  /**
   * Removes the API key from an agent configuration.
   *
   * @param id - ID of the agent config / エージェント設定のID
   */
  async deleteApiKey(id: number) {
    return deleteApiKey(id);
  }

  /**
   * Retrieves and decrypts the API key for a given agent.
   *
   * @param id - ID of the agent config / エージェント設定のID
   */
  async getApiKey(id: number) {
    return getApiKey(id);
  }

  /**
   * Validates an agent configuration including API key format.
   *
   * @param config - Configuration values to validate / バリデーション対象の設定値
   */
  async validateAgentConfig(config: {
    agentType: string;
    apiKey?: string;
    endpoint?: string;
    modelId?: string;
    additionalConfig?: Record<string, boolean>;
  }): Promise<ValidationResult> {
    return validateConfig(config);
  }

  /**
   * Returns the configuration schema for a given agent type.
   *
   * @param agentType - Agent type identifier / エージェントタイプの識別子
   */
  getConfigSchema(agentType: string) {
    return getAgentConfigSchema(agentType);
  }

  /**
   * Returns a masked version of the agent's API key for display.
   *
   * @param id - ID of the agent config / エージェント設定のID
   */
  async getMaskedApiKey(id: number) {
    return getMaskedApiKey(id);
  }

  /**
   * Retrieves the capabilities configuration for an agent.
   *
   * @param id - ID of the agent config / エージェント設定のID
   */
  async getCapabilities(id: number) {
    return getCapabilities(id);
  }

  /**
   * Updates the capabilities configuration for an agent.
   *
   * @param id - ID of the agent config / エージェント設定のID
   * @param capabilities - New capabilities map / 新しいケイパビリティマップ
   */
  async updateCapabilities(id: number, capabilities: Record<string, boolean>) {
    return updateCapabilities(id, capabilities);
  }
}

// Singleton instance
export const agentConfigService = new AgentConfigService();
