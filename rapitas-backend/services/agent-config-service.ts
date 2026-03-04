/**
 * Agent Configuration Service
 * エージェント設定のCRUD操作、バリデーション、暗号化処理を管理
 */

import { prisma } from "../config/database";
import { toJsonString, fromJsonString } from "../utils/db-helpers";
import {
  encrypt,
  decrypt,
  maskApiKey,
  isEncryptionKeyConfigured,
} from "../utils/encryption";
import {
  validateApiKeyFormat,
  validateAgentConfig,
  getAgentConfigSchema,
} from "../utils/agent-config-schema";
import {
  logAgentConfigChange,
  calculateChanges,
} from "../utils/agent-audit-log";
import type { AIAgentConfig } from "@prisma/client";

export interface CreateAgentConfigRequest {
  agentType: string;
  name: string;
  apiKey?: string;
  endpoint?: string;
  modelId?: string;
  capabilities?: Record<string, boolean>;
  isDefault?: boolean;
}

export interface UpdateAgentConfigRequest {
  name?: string;
  apiKey?: string;
  endpoint?: string;
  modelId?: string;
  capabilities?: Record<string, boolean>;
  isDefault?: boolean;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export class AgentConfigService {
  /**
   * アクティブなエージェント一覧を取得
   */
  async getActiveAgents() {
    return await prisma.aIAgentConfig.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: [
        { isDefault: "desc" },
        { updatedAt: "desc" },
      ],
    });
  }

  /**
   * 全エージェント一覧を取得
   */
  async getAllAgents() {
    return await prisma.aIAgentConfig.findMany({
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: [
        { isDefault: "desc" },
        { isActive: "desc" },
        { updatedAt: "desc" },
      ],
    });
  }

  /**
   * エージェントをIDで取得
   */
  async getAgentById(id: number) {
    return await prisma.aIAgentConfig.findUnique({
      where: { id },
    });
  }

  /**
   * デフォルトエージェントを取得
   */
  async getDefaultAgent() {
    const defaultAgent = await prisma.aIAgentConfig.findFirst({
      where: { isDefault: true, isActive: true },
    });

    if (!defaultAgent) {
      // DBにデフォルトエージェントが設定されていない場合、組み込みのClaude Codeをフォールバックとして返す
      return {
        id: -1,
        agentType: "claude-code",
        name: "Claude Code (Built-in)",
        isDefault: true,
        isActive: true,
        apiKeyEncrypted: null,
        endpoint: null,
        modelId: null,
        capabilities: "{}",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return defaultAgent;
  }

  /**
   * エージェント設定を作成
   */
  async createAgentConfig(config: CreateAgentConfigRequest): Promise<AIAgentConfig> {
    const { agentType, name, apiKey, endpoint, modelId, capabilities, isDefault } = config;

    // バリデーション実行
    const validation = await this.validateAgentConfig({
      agentType,
      apiKey,
      endpoint,
      modelId,
      additionalConfig: capabilities,
    });

    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
    }

    // デフォルトエージェントの場合、既存のデフォルトを解除
    if (isDefault) {
      await this.clearDefaultAgent();
    }

    // APIキーの暗号化
    let apiKeyEncrypted: string | null = null;
    if (apiKey) {
      if (!isEncryptionKeyConfigured()) {
        console.warn("[AgentConfigService] Encryption key not configured - storing API key as null");
      } else {
        apiKeyEncrypted = encrypt(apiKey);
      }
    }

    const created = await prisma.aIAgentConfig.create({
      data: {
        agentType,
        name,
        apiKeyEncrypted,
        endpoint,
        modelId,
        capabilities: toJsonString(capabilities || {}) ?? "{}",
        isDefault: isDefault || false,
      },
    });

    // 監査ログを記録
    await logAgentConfigChange({
      agentConfigId: created.id,
      action: "create",
      newValues: {
        agentType,
        name,
        hasApiKey: !!apiKeyEncrypted,
        endpoint,
        modelId,
        capabilities: capabilities || {},
        isDefault: isDefault || false,
      },
    });

    console.log(`[AgentConfigService] Created agent config: ${name} (${agentType})`);
    return created;
  }

  /**
   * エージェント設定を更新
   */
  async updateAgentConfig(id: number, updates: UpdateAgentConfigRequest): Promise<AIAgentConfig> {
    const { name, apiKey, endpoint, modelId, capabilities, isDefault } = updates;

    // 更新前の値を取得
    const previous = await this.getAgentById(id);
    if (!previous) {
      throw new Error(`Agent config not found: ${id}`);
    }

    // デフォルトエージェントの場合、既存のデフォルトを解除
    if (isDefault) {
      await this.clearDefaultAgent();
    }

    // APIキーの処理
    let apiKeyEncrypted: string | undefined = undefined;
    if (apiKey !== undefined) {
      if (apiKey === null || apiKey === "") {
        apiKeyEncrypted = null;
      } else {
        if (!isEncryptionKeyConfigured()) {
          console.warn("[AgentConfigService] Encryption key not configured - not updating API key");
        } else {
          apiKeyEncrypted = encrypt(apiKey);
        }
      }
    }

    // 更新データの構築
    const updateData: Record<string, string | boolean | null | undefined> = {};
    if (name !== undefined) updateData.name = name;
    if (apiKeyEncrypted !== undefined) updateData.apiKeyEncrypted = apiKeyEncrypted;
    if (endpoint !== undefined) updateData.endpoint = endpoint;
    if (modelId !== undefined) updateData.modelId = modelId;
    if (capabilities !== undefined) {
      updateData.capabilities = toJsonString(capabilities) ?? "{}";
    }
    if (isDefault !== undefined) updateData.isDefault = isDefault;

    const updated = await prisma.aIAgentConfig.update({
      where: { id },
      data: updateData,
    });

    // 監査ログを記録
    const changes = calculateChanges(previous, updated);
    if (Object.keys(changes).length > 0) {
      await logAgentConfigChange({
        agentConfigId: id,
        action: "update",
        previousValues: changes.previous,
        newValues: changes.new,
        changeDetails: changes.details,
      });
    }

    console.log(`[AgentConfigService] Updated agent config: ${updated.name} (${updated.agentType})`);
    return updated;
  }

  /**
   * エージェントのアクティブ状態を切り替え
   */
  async toggleAgentActive(id: number): Promise<AIAgentConfig> {
    const agent = await this.getAgentById(id);
    if (!agent) {
      throw new Error(`Agent config not found: ${id}`);
    }

    const updated = await prisma.aIAgentConfig.update({
      where: { id },
      data: { isActive: !agent.isActive },
    });

    // 監査ログを記録
    await logAgentConfigChange({
      agentConfigId: id,
      action: "update",
      changeDetails: {
        isActive: { from: agent.isActive, to: updated.isActive },
      },
    });

    console.log(`[AgentConfigService] Toggled active state for agent: ${updated.name} -> ${updated.isActive}`);
    return updated;
  }

  /**
   * エージェント設定を削除（論理削除）
   */
  async deleteAgentConfig(id: number): Promise<AIAgentConfig> {
    const previous = await this.getAgentById(id);
    if (!previous) {
      throw new Error(`Agent config not found: ${id}`);
    }

    const result = await prisma.aIAgentConfig.update({
      where: { id },
      data: { isActive: false },
    });

    // 監査ログを記録
    await logAgentConfigChange({
      agentConfigId: id,
      action: "delete",
      previousValues: {
        agentType: previous.agentType,
        name: previous.name,
        isActive: previous.isActive,
      },
    });

    console.log(`[AgentConfigService] Deleted agent config: ${previous.name} (${previous.agentType})`);
    return result;
  }

  /**
   * デフォルトエージェントを設定
   */
  async setDefaultAgent(id: number): Promise<AIAgentConfig> {
    const agent = await this.getAgentById(id);
    if (!agent) {
      throw new Error(`Agent config not found: ${id}`);
    }

    // 既存のデフォルトを解除
    await this.clearDefaultAgent();

    // 新しいデフォルトを設定
    const updated = await prisma.aIAgentConfig.update({
      where: { id },
      data: { isDefault: true },
    });

    // 監査ログを記録
    await logAgentConfigChange({
      agentConfigId: id,
      action: "update",
      previousValues: { isDefault: false },
      newValues: { isDefault: true },
      changeDetails: { isDefault: { from: false, to: true } },
    });

    console.log(`[AgentConfigService] Set default agent: ${updated.name} (${updated.agentType})`);
    return updated;
  }

  /**
   * デフォルトエージェントをクリア
   */
  async clearDefaultAgent(): Promise<void> {
    await prisma.aIAgentConfig.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }

  /**
   * APIキーを設定
   */
  async setApiKey(id: number, apiKey: string): Promise<void> {
    const agent = await this.getAgentById(id);
    if (!agent) {
      throw new Error(`Agent config not found: ${id}`);
    }

    if (!isEncryptionKeyConfigured()) {
      throw new Error("Encryption key is not configured");
    }

    // APIキーフォーマットの検証
    const validationResult = validateApiKeyFormat(agent.agentType, apiKey);
    if (!validationResult.valid) {
      throw new Error(`Invalid API key format: ${validationResult.message}`);
    }

    const apiKeyEncrypted = encrypt(apiKey);

    await prisma.aIAgentConfig.update({
      where: { id },
      data: { apiKeyEncrypted },
    });

    // 監査ログを記録
    await logAgentConfigChange({
      agentConfigId: id,
      action: "api_key_set",
      changeDetails: {
        hadApiKeyBefore: !!agent.apiKeyEncrypted,
      },
    });

    console.log(`[AgentConfigService] API key set for agent: ${agent.name} (${agent.agentType})`);
  }

  /**
   * APIキーを削除
   */
  async deleteApiKey(id: number): Promise<void> {
    const agent = await this.getAgentById(id);
    if (!agent) {
      throw new Error(`Agent config not found: ${id}`);
    }

    await prisma.aIAgentConfig.update({
      where: { id },
      data: { apiKeyEncrypted: null },
    });

    // 監査ログを記録
    await logAgentConfigChange({
      agentConfigId: id,
      action: "api_key_delete",
    });

    console.log(`[AgentConfigService] API key deleted for agent: ${agent.name} (${agent.agentType})`);
  }

  /**
   * APIキーを取得（復号化済み）
   */
  async getApiKey(id: number): Promise<string | null> {
    const agent = await this.getAgentById(id);
    if (!agent || !agent.apiKeyEncrypted) {
      return null;
    }

    if (!isEncryptionKeyConfigured()) {
      console.warn(`[AgentConfigService] Cannot decrypt API key for agent ${id} - encryption key not configured`);
      return null;
    }

    try {
      return decrypt(agent.apiKeyEncrypted);
    } catch (error) {
      console.error(`[AgentConfigService] Failed to decrypt API key for agent ${id}:`, error);
      return null;
    }
  }

  /**
   * エージェント設定の検証
   */
  async validateAgentConfig(config: {
    agentType: string;
    apiKey?: string;
    endpoint?: string;
    modelId?: string;
    additionalConfig?: Record<string, boolean>;
  }): Promise<ValidationResult> {
    const { agentType, apiKey, endpoint, modelId, additionalConfig } = config;
    const errors: ValidationError[] = [];

    try {
      // 基本的な検証
      const basicValidation = validateAgentConfig(
        agentType,
        {
          endpoint,
          modelId,
          additionalConfig
        }
      );

      if (!basicValidation.valid) {
        errors.push({
          field: 'config',
          message: basicValidation.errors.join(', ') || 'Invalid configuration'
        });
      }

      // APIキーフォーマットの検証
      if (apiKey) {
        const apiKeyValidation = validateApiKeyFormat(agentType, apiKey);
        if (!apiKeyValidation.valid) {
          errors.push({
            field: 'apiKey',
            message: apiKeyValidation.message || 'Invalid API key format'
          });
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      errors.push({
        field: 'general',
        message: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });

      return {
        isValid: false,
        errors,
      };
    }
  }

  /**
   * エージェント設定のスキーマ情報を取得
   */
  getConfigSchema(agentType: string) {
    return getAgentConfigSchema(agentType);
  }

  /**
   * エージェントのAPIキーをマスク表示
   */
  async getMaskedApiKey(id: number): Promise<string | null> {
    const agent = await this.getAgentById(id);
    if (!agent || !agent.apiKeyEncrypted) {
      return null;
    }

    const apiKey = await this.getApiKey(id);
    if (!apiKey) {
      return null;
    }

    return maskApiKey(apiKey);
  }

  /**
   * エージェントの機能設定を取得
   */
  async getCapabilities(id: number): Promise<Record<string, boolean>> {
    const agent = await this.getAgentById(id);
    if (!agent) {
      throw new Error(`Agent config not found: ${id}`);
    }

    try {
      return fromJsonString(agent.capabilities) || {};
    } catch (error) {
      console.warn(`[AgentConfigService] Failed to parse capabilities for agent ${id}:`, error);
      return {};
    }
  }

  /**
   * エージェントの機能設定を更新
   */
  async updateCapabilities(id: number, capabilities: Record<string, boolean>): Promise<AIAgentConfig> {
    const agent = await this.getAgentById(id);
    if (!agent) {
      throw new Error(`Agent config not found: ${id}`);
    }

    const updated = await prisma.aIAgentConfig.update({
      where: { id },
      data: {
        capabilities: toJsonString(capabilities) ?? "{}",
      },
    });

    // 監査ログを記録
    await logAgentConfigChange({
      agentConfigId: id,
      action: "update",
      changeDetails: {
        capabilities: {
          from: fromJsonString(agent.capabilities) || {},
          to: capabilities,
        },
      },
    });

    console.log(`[AgentConfigService] Updated capabilities for agent: ${updated.name}`);
    return updated;
  }
}

// シングルトンインスタンスをエクスポート
export const agentConfigService = new AgentConfigService();