/**
 * Agent Config CRUD Operations
 *
 * Handles create, read, update, delete, and default-management operations
 * for AIAgentConfig records. API key and capabilities logic live in api-key.ts.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { toJsonString } from '../../utils/database/db-helpers';
import { encrypt, isEncryptionKeyConfigured } from '../../utils/common/encryption';
import { logAgentConfigChange, calculateChanges } from '../../utils/agent/agent-audit-log';
import type { AIAgentConfig } from '@prisma/client';
import type { CreateAgentConfigRequest, UpdateAgentConfigRequest } from './types';
import { validateConfig } from './validation';

// Re-exported for consumers who import from this module path
export type { ValidationError, ValidationResult } from './types';
export { validateConfig } from './validation';

const log = createLogger('agent-config-crud');

/** Retrieves all active agent configurations. */
export async function getActiveAgents() {
  return await prisma.aIAgentConfig.findMany({
    where: { isActive: true },
    include: {
      _count: { select: { executions: true } },
    },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  });
}

/** Retrieves all agent configurations including inactive ones. */
export async function getAllAgents() {
  return await prisma.aIAgentConfig.findMany({
    include: {
      _count: { select: { executions: true } },
    },
    orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { updatedAt: 'desc' }],
  });
}

/**
 * Finds an agent configuration by its ID.
 *
 * @param id - Primary key of the AIAgentConfig record / AIAgentConfigレコードの主キー
 * @returns The matching record, or null if not found
 */
export async function getAgentById(id: number) {
  return await prisma.aIAgentConfig.findUnique({
    where: { id },
  });
}

// NOTE: getDefaultAgent lives in defaults.ts to keep this file under 300 lines.
export { getDefaultAgent } from './defaults';

/**
 * Creates a new agent configuration with validation and optional API key encryption.
 *
 * @param config - Creation request payload / 作成リクエストペイロード
 * @returns The newly created AIAgentConfig record
 * @throws {Error} When validation fails or the config is malformed
 */
export async function createAgentConfig(config: CreateAgentConfigRequest): Promise<AIAgentConfig> {
  const { agentType, name, apiKey, endpoint, modelId, capabilities, isDefault } = config;

  const validation = await validateConfig({
    agentType,
    apiKey,
    endpoint,
    modelId,
    additionalConfig: capabilities,
  });
  if (!validation.isValid) {
    throw new Error(
      `Validation failed: ${validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ')}`,
    );
  }

  if (isDefault) {
    await clearDefaultAgent();
  }

  let apiKeyEncrypted: string | null = null;
  if (apiKey) {
    if (!isEncryptionKeyConfigured()) {
      log.warn('[AgentConfigCrud] Encryption key not configured - storing API key as null');
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
      capabilities: toJsonString(capabilities || {}) ?? '{}',
      isDefault: isDefault || false,
    },
  });

  await logAgentConfigChange({
    agentConfigId: created.id,
    action: 'create',
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

  log.info(`[AgentConfigCrud] Created agent config: ${name} (${agentType})`);
  return created;
}

/**
 * Updates an existing agent configuration.
 *
 * @param id - ID of the record to update / 更新するレコードのID
 * @param updates - Partial update payload / 部分更新ペイロード
 * @returns The updated AIAgentConfig record
 * @throws {Error} When the record is not found
 */
export async function updateAgentConfig(
  id: number,
  updates: UpdateAgentConfigRequest,
): Promise<AIAgentConfig> {
  const { name, apiKey, endpoint, modelId, capabilities, isDefault } = updates;

  const previous = await getAgentById(id);
  if (!previous) {
    throw new Error(`Agent config not found: ${id}`);
  }

  if (isDefault) {
    await clearDefaultAgent();
  }

  let apiKeyEncrypted: string | undefined = undefined;
  if (apiKey !== undefined) {
    if (apiKey === null || apiKey === '') {
      apiKeyEncrypted = undefined;
    } else {
      if (!isEncryptionKeyConfigured()) {
        log.warn('[AgentConfigCrud] Encryption key not configured - not updating API key');
      } else {
        apiKeyEncrypted = encrypt(apiKey);
      }
    }
  }

  const updateData: Record<string, string | boolean | null | undefined> = {};
  if (name !== undefined) updateData.name = name;
  if (apiKeyEncrypted !== undefined) updateData.apiKeyEncrypted = apiKeyEncrypted;
  if (endpoint !== undefined) updateData.endpoint = endpoint;
  if (modelId !== undefined) updateData.modelId = modelId;
  if (capabilities !== undefined) {
    updateData.capabilities = toJsonString(capabilities) ?? '{}';
  }
  if (isDefault !== undefined) updateData.isDefault = isDefault;

  const updated = await prisma.aIAgentConfig.update({
    where: { id },
    data: updateData,
  });

  const changes = calculateChanges(previous, updated);
  if (Object.keys(changes).length > 0) {
    await logAgentConfigChange({
      agentConfigId: id,
      action: 'update',
      previousValues: changes.previous,
      newValues: changes.new,
      changeDetails: changes.details,
    });
  }

  log.info(`[AgentConfigCrud] Updated agent config: ${updated.name} (${updated.agentType})`);
  return updated;
}

/**
 * Toggles the active state of an agent configuration.
 *
 * @param id - ID of the agent config / エージェント設定のID
 * @returns The updated AIAgentConfig record
 * @throws {Error} When the record is not found
 */
export async function toggleAgentActive(id: number): Promise<AIAgentConfig> {
  const agent = await getAgentById(id);
  if (!agent) {
    throw new Error(`Agent config not found: ${id}`);
  }

  const updated = await prisma.aIAgentConfig.update({
    where: { id },
    data: { isActive: !agent.isActive },
  });

  await logAgentConfigChange({
    agentConfigId: id,
    action: 'update',
    changeDetails: {
      isActive: { from: agent.isActive, to: updated.isActive },
    },
  });

  log.info(
    `[AgentConfigCrud] Toggled active state for agent: ${updated.name} -> ${updated.isActive}`,
  );
  return updated;
}

/**
 * Soft-deletes an agent configuration by deactivating it.
 *
 * @param id - ID of the agent config to delete / 削除するエージェント設定のID
 * @returns The deactivated AIAgentConfig record
 * @throws {Error} When the record is not found
 */
export async function deleteAgentConfig(id: number): Promise<AIAgentConfig> {
  const previous = await getAgentById(id);
  if (!previous) {
    throw new Error(`Agent config not found: ${id}`);
  }

  const result = await prisma.aIAgentConfig.update({
    where: { id },
    data: { isActive: false },
  });

  await logAgentConfigChange({
    agentConfigId: id,
    action: 'delete',
    previousValues: {
      agentType: previous.agentType,
      name: previous.name,
      isActive: previous.isActive,
    },
  });

  log.info(`[AgentConfigCrud] Deleted agent config: ${previous.name} (${previous.agentType})`);
  return result;
}

/**
 * Sets a specific agent as the default, clearing any previously set default first.
 *
 * @param id - ID of the agent to set as default / デフォルトに設定するエージェントのID
 * @returns The updated AIAgentConfig record
 * @throws {Error} When the record is not found
 */
export async function setDefaultAgent(id: number): Promise<AIAgentConfig> {
  const agent = await getAgentById(id);
  if (!agent) {
    throw new Error(`Agent config not found: ${id}`);
  }

  await clearDefaultAgent();

  const updated = await prisma.aIAgentConfig.update({
    where: { id },
    data: { isDefault: true },
  });

  await logAgentConfigChange({
    agentConfigId: id,
    action: 'update',
    previousValues: { isDefault: false },
    newValues: { isDefault: true },
    changeDetails: { isDefault: { from: false, to: true } },
  });

  log.info(`[AgentConfigCrud] Set default agent: ${updated.name} (${updated.agentType})`);
  return updated;
}

/** Clears the default flag on all agents. */
export async function clearDefaultAgent(): Promise<void> {
  await prisma.aIAgentConfig.updateMany({
    where: { isDefault: true },
    data: { isDefault: false },
  });
}
