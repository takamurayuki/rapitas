/**
 * GeminiCliAgent — ConfigValidator
 *
 * Validates GeminiCliAgentConfig at runtime: checks CLI availability and
 * working directory existence.
 * Not responsible for process lifecycle or output parsing.
 */

import type { GeminiCliAgentConfig } from './types';
import { checkGeminiAvailability } from './process-manager';
import { createLogger } from '../../../config/logger';

const logger = createLogger('gemini-cli-agent:config-validator');

/**
 * Validate a GeminiCliAgentConfig and return any errors found.
 *
 * @param config - Agent configuration to validate / バリデーション対象の設定
 * @param logPrefix - Log prefix for identification / ログ識別プレフィックス
 * @returns Object with valid flag and array of error strings
 */
export async function validateAgentConfig(
  config: GeminiCliAgentConfig,
  logPrefix: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const available = await checkGeminiAvailability();
  if (!available) {
    errors.push(
      'Gemini CLI is not installed or not available in PATH. Install with: npm install -g @google/gemini-cli',
    );
  }

  // NOTE: GEMINI_API_KEY is optional — Gemini CLI also supports Google account authentication
  if (config.apiKey) {
    logger.info(`${logPrefix} Using provided API key`);
  } else if (process.env.GEMINI_API_KEY) {
    logger.info(`${logPrefix} Using GEMINI_API_KEY from environment`);
  } else {
    logger.info(`${logPrefix} No API key provided - will use Google account authentication`);
  }

  if (config.workingDirectory) {
    try {
      const fs = await import('fs/promises');
      const stats = await fs.stat(config.workingDirectory);
      if (!stats.isDirectory()) {
        errors.push(`Working directory is not a directory: ${config.workingDirectory}`);
      }
    } catch {
      errors.push(`Working directory does not exist: ${config.workingDirectory}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
