/**
 * agentSettingsApi
 *
 * Low-level API calls for the agent settings feature.
 * Encapsulates fetch calls so useAgentSettings stays focused on state.
 */

import { API_BASE_URL } from '@/utils/api';
import {
  validateUrl,
  validateApiKey,
  collectErrors,
  validateConfigOnServer,
  type ValidationResult,
} from '@/utils/validation';

type SaveParams = {
  id: string;
  agentType: string;
  endpoint: string;
  modelId: string;
  apiKey: string;
  capabilities: Record<string, boolean>;
  settingsEndpointLabel: string;
};

type SaveResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string | null>; message: string };

/**
 * Validates then persists agent config and optional API key.
 *
 * @param params - SaveParams
 * @returns SaveResult with field errors on failure / 失敗時はフィールドエラーを返す
 */
export async function saveAgentSettings(
  params: SaveParams,
): Promise<SaveResult> {
  const {
    id,
    agentType,
    endpoint,
    modelId,
    apiKey,
    capabilities,
    settingsEndpointLabel,
  } = params;

  const endpointEditable =
    agentType === 'custom' ||
    agentType === 'openai' ||
    agentType === 'azure-openai';

  const endpointResult: ValidationResult = endpointEditable
    ? validateUrl(
        endpoint,
        settingsEndpointLabel,
        agentType === 'custom' || agentType === 'azure-openai',
      )
    : { valid: true };

  const apiKeyResult: ValidationResult = apiKey
    ? validateApiKey(apiKey, agentType)
    : { valid: true };

  const { valid, errors } = collectErrors(endpointResult, apiKeyResult);

  if (!valid) {
    return {
      ok: false,
      fieldErrors: {
        endpoint: endpointResult.valid ? null : (endpointResult.error ?? null),
        apiKey: apiKeyResult.valid ? null : (apiKeyResult.error ?? null),
      },
      message: errors.join('、'),
    };
  }

  const serverResult = await validateConfigOnServer(API_BASE_URL, {
    agentType,
    apiKey: apiKey || undefined,
    endpoint: endpoint || undefined,
    modelId: modelId || undefined,
  });

  if (!serverResult.valid) {
    return {
      ok: false,
      fieldErrors: {},
      message: serverResult.errors.join('、'),
    };
  }

  const configRes = await fetch(`${API_BASE_URL}/agents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: endpoint || null,
      modelId: modelId || null,
      capabilities,
    }),
  });

  if (!configRes.ok) throw new Error('settingsSaveFailed');

  if (apiKey) {
    const keyRes = await fetch(`${API_BASE_URL}/agents/${id}/api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (!keyRes.ok) throw new Error('apiKeySaveFailed');
  }

  return { ok: true };
}

/**
 * Deletes the stored API key for an agent.
 *
 * @param id - Agent ID / エージェントID
 * @throws Error when the request fails
 */
export async function deleteAgentApiKey(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/agents/${id}/api-key`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('apiKeyDeleteFailed');
}

/**
 * Permanently deletes an agent.
 *
 * @param id - Agent ID / エージェントID
 * @throws Error when the request fails
 */
export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/agents/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('deleteFailed');
}
