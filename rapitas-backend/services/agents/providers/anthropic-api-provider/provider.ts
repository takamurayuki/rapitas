/**
 * Anthropic API Provider
 *
 * IAgentProvider implementation for the Anthropic Messages API. Manages
 * provider-level health checks, config validation, and agent instantiation.
 * The singleton `anthropicApiProvider` is the default export for registration.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getApiKeyForProvider } from '../../../../utils/ai-client';
import type {
  AgentCapabilities,
  AgentProviderConfig,
  AgentHealthStatus,
} from '../../abstraction/types';
import type { IAgentProvider, IAgent } from '../../abstraction/interfaces';
import { CLAUDE_MODELS, type AnthropicApiConfig, type ClaudeModelId } from './models';
import { AnthropicApiAgent } from './agent';

/**
 * Anthropic API Provider
 */
export class AnthropicApiProvider implements IAgentProvider {
  readonly providerId = 'anthropic-api' as const;
  readonly providerName = 'Anthropic API';
  readonly version = '1.0.0';

  private defaultConfig: AnthropicApiConfig;

  constructor(config?: Partial<AnthropicApiConfig>) {
    this.defaultConfig = {
      providerId: 'anthropic-api',
      enabled: true,
      model: 'claude-sonnet-4-20250514',
      ...config,
    };
  }

  getCapabilities(): AgentCapabilities {
    return {
      codeGeneration: true,
      codeReview: true,
      codeExecution: false,
      fileRead: false,
      fileWrite: false,
      fileEdit: false,
      terminalAccess: false,
      gitOperations: false,
      webSearch: false,
      webFetch: false,
      taskAnalysis: true,
      taskPlanning: true,
      parallelExecution: false,
      questionAsking: true,
      conversationMemory: true,
      sessionContinuation: true,
    };
  }

  async isAvailable(): Promise<boolean> {
    const apiKey =
      this.defaultConfig.apiKey ||
      (await getApiKeyForProvider('claude')) ||
      process.env.ANTHROPIC_API_KEY;
    return !!apiKey;
  }

  async validateConfig(config: AgentProviderConfig): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (config.providerId !== 'anthropic-api') {
      errors.push(`Invalid provider ID: ${config.providerId}`);
    }

    const anthropicConfig = config as AnthropicApiConfig;
    const apiKey =
      anthropicConfig.apiKey ||
      (await getApiKeyForProvider('claude')) ||
      process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      errors.push('API key is required');
    }

    if (anthropicConfig.model && !CLAUDE_MODELS[anthropicConfig.model as ClaudeModelId]) {
      errors.push(`Unknown model: ${anthropicConfig.model}`);
    }

    return { valid: errors.length === 0, errors };
  }

  async healthCheck(): Promise<AgentHealthStatus> {
    const startTime = Date.now();

    try {
      const apiKey =
        this.defaultConfig.apiKey ||
        (await getApiKeyForProvider('claude')) ||
        process.env.ANTHROPIC_API_KEY;

      if (!apiKey) {
        return {
          healthy: false,
          available: false,
          errors: ['API key not configured'],
          lastCheck: new Date(),
        };
      }

      const client = new Anthropic({ apiKey });

      // NOTE: Uses cheapest model (Haiku) for health check to minimize cost
      await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }],
      });

      const latency = Date.now() - startTime;

      return {
        healthy: true,
        available: true,
        latency,
        lastCheck: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        available: false,
        errors: [error instanceof Error ? error.message : String(error)],
        lastCheck: new Date(),
      };
    }
  }

  createAgent(config: AgentProviderConfig): IAgent {
    const mergedConfig: AnthropicApiConfig = {
      ...this.defaultConfig,
      ...config,
    } as AnthropicApiConfig;

    return new AnthropicApiAgent(mergedConfig);
  }

  /**
   * Returns the list of available models with pricing info.
   *
   * @returns Array of model metadata / モデルメタデータの配列
   */
  getAvailableModels(): Array<{
    id: string;
    name: string;
    contextWindow: number;
    maxOutputTokens: number;
    inputCostPer1k: number;
    outputCostPer1k: number;
  }> {
    return Object.entries(CLAUDE_MODELS).map(([id, info]) => ({
      id,
      ...info,
    }));
  }
}

/**
 * Default Anthropic API provider instance
 */
export const anthropicApiProvider = new AnthropicApiProvider();
