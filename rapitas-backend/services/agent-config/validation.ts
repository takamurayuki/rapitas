/**
 * Agent Config Validation
 *
 * Validates agent configuration fields including API key format.
 * Does not perform any database reads or writes.
 */

import { validateApiKeyFormat, validateAgentConfig } from '../../utils/agent-config-schema';
import type { ValidationError, ValidationResult } from './types';

/**
 * Validates an agent configuration including API key format.
 *
 * @param config - Configuration values to validate / バリデーション対象の設定値
 * @returns Validation result with any field-level errors
 */
export async function validateConfig(config: {
  agentType: string;
  apiKey?: string;
  endpoint?: string;
  modelId?: string;
  additionalConfig?: Record<string, boolean>;
}): Promise<ValidationResult> {
  const { agentType, apiKey, endpoint, modelId, additionalConfig } = config;
  const errors: ValidationError[] = [];

  try {
    const basicValidation = validateAgentConfig(agentType, { endpoint, modelId, additionalConfig });
    if (!basicValidation.valid) {
      errors.push({
        field: 'config',
        message: basicValidation.errors.join(', ') || 'Invalid configuration',
      });
    }

    if (apiKey) {
      const apiKeyValidation = validateApiKeyFormat(agentType, apiKey);
      if (!apiKeyValidation.valid) {
        errors.push({
          field: 'apiKey',
          message: apiKeyValidation.message || 'Invalid API key format',
        });
      }
    }

    return { isValid: errors.length === 0, errors };
  } catch (error) {
    errors.push({
      field: 'general',
      message: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
    return { isValid: false, errors };
  }
}
