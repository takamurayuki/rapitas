/**
 * Agent Config API Key and Capabilities Operations
 *
 * Handles encryption, decryption, masking, and storage of API keys,
 * as well as reading and writing the capabilities JSON field.
 * CRUD operations (create/update/delete) live in crud.ts.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { toJsonString, fromJsonString } from '../../utils/db-helpers';
import { encrypt, decrypt, maskApiKey, isEncryptionKeyConfigured } from '../../utils/common/encryption';
import { validateApiKeyFormat } from '../../utils/agent-config-schema';
import { logAgentConfigChange } from '../../utils/agent-audit-log';
import type { AIAgentConfig } from '@prisma/client';
import { getAgentById } from './crud';

const log = createLogger('agent-config-api-key');

/**
 * Sets and encrypts an API key for a specific agent.
 *
 * @param id - ID of the agent config / エージェント設定のID
 * @param apiKey - Plain-text API key to encrypt and store / 暗号化して保存する平文APIキー
 * @throws {Error} When the record is not found, encryption is unconfigured, or the key format is invalid
 */
export async function setApiKey(id: number, apiKey: string): Promise<void> {
  const agent = await getAgentById(id);
  if (!agent) {
    throw new Error(`Agent config not found: ${id}`);
  }

  if (!isEncryptionKeyConfigured()) {
    throw new Error('Encryption key is not configured');
  }

  const validationResult = validateApiKeyFormat(agent.agentType, apiKey);
  if (!validationResult.valid) {
    throw new Error(`Invalid API key format: ${validationResult.message}`);
  }

  const apiKeyEncrypted = encrypt(apiKey);

  await prisma.aIAgentConfig.update({
    where: { id },
    data: { apiKeyEncrypted },
  });

  await logAgentConfigChange({
    agentConfigId: id,
    action: 'api_key_set',
    changeDetails: {
      hadApiKeyBefore: !!agent.apiKeyEncrypted,
    },
  });

  log.info(`[AgentConfigApiKey] API key set for agent: ${agent.name} (${agent.agentType})`);
}

/**
 * Removes the API key from an agent configuration.
 *
 * @param id - ID of the agent config / エージェント設定のID
 * @throws {Error} When the record is not found
 */
export async function deleteApiKey(id: number): Promise<void> {
  const agent = await getAgentById(id);
  if (!agent) {
    throw new Error(`Agent config not found: ${id}`);
  }

  await prisma.aIAgentConfig.update({
    where: { id },
    data: { apiKeyEncrypted: null },
  });

  await logAgentConfigChange({
    agentConfigId: id,
    action: 'api_key_delete',
  });

  log.info(`[AgentConfigApiKey] API key deleted for agent: ${agent.name} (${agent.agentType})`);
}

/**
 * Retrieves and decrypts the API key for a given agent.
 *
 * @param id - ID of the agent config / エージェント設定のID
 * @returns Decrypted API key, or null if absent or decryption fails
 */
export async function getApiKey(id: number): Promise<string | null> {
  const agent = await getAgentById(id);
  if (!agent || !agent.apiKeyEncrypted) {
    return null;
  }

  if (!isEncryptionKeyConfigured()) {
    log.warn(
      `[AgentConfigApiKey] Cannot decrypt API key for agent ${id} - encryption key not configured`,
    );
    return null;
  }

  try {
    return decrypt(agent.apiKeyEncrypted);
  } catch (error) {
    log.error({ err: error }, `[AgentConfigApiKey] Failed to decrypt API key for agent ${id}`);
    return null;
  }
}

/**
 * Returns a masked version of the agent's API key for display purposes.
 *
 * @param id - ID of the agent config / エージェント設定のID
 * @returns Masked API key string, or null if no key is set
 */
export async function getMaskedApiKey(id: number): Promise<string | null> {
  const agent = await getAgentById(id);
  if (!agent || !agent.apiKeyEncrypted) {
    return null;
  }

  const apiKey = await getApiKey(id);
  if (!apiKey) {
    return null;
  }

  return maskApiKey(apiKey);
}

/**
 * Retrieves the capabilities configuration for an agent.
 *
 * @param id - ID of the agent config / エージェント設定のID
 * @returns Parsed capabilities map, or an empty object on parse failure
 * @throws {Error} When the record is not found
 */
export async function getCapabilities(id: number): Promise<Record<string, boolean>> {
  const agent = await getAgentById(id);
  if (!agent) {
    throw new Error(`Agent config not found: ${id}`);
  }

  try {
    return fromJsonString(agent.capabilities) || {};
  } catch (error) {
    log.warn({ err: error }, `[AgentConfigApiKey] Failed to parse capabilities for agent ${id}`);
    return {};
  }
}

/**
 * Updates the capabilities configuration for an agent.
 *
 * @param id - ID of the agent config / エージェント設定のID
 * @param capabilities - New capabilities map / 新しいケイパビリティマップ
 * @returns The updated AIAgentConfig record
 * @throws {Error} When the record is not found
 */
export async function updateCapabilities(
  id: number,
  capabilities: Record<string, boolean>,
): Promise<AIAgentConfig> {
  const agent = await getAgentById(id);
  if (!agent) {
    throw new Error(`Agent config not found: ${id}`);
  }

  const updated = await prisma.aIAgentConfig.update({
    where: { id },
    data: {
      capabilities: toJsonString(capabilities) ?? '{}',
    },
  });

  await logAgentConfigChange({
    agentConfigId: id,
    action: 'update',
    changeDetails: {
      capabilities: {
        from: fromJsonString(agent.capabilities) || {},
        to: capabilities,
      },
    },
  });

  log.info(`[AgentConfigApiKey] Updated capabilities for agent: ${updated.name}`);
  return updated;
}
