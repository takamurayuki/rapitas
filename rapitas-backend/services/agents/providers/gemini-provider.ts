/**
 * Google Gemini Provider (stub)
 *
 * Agent provider using Google AI Studio / Vertex AI Gemini models.
 * NOTE: This file only defines the interface. Full implementation requires
 * installing the @google/generative-ai package.
 */

import type {
  AgentCapabilities,
  AgentProviderConfig,
  GeminiProviderConfig,
  AgentHealthStatus,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  ContinuationContext,
} from '../abstraction/types';
import type { IAgentProvider, IAgent } from '../abstraction/interfaces';
import { AbstractAgent } from '../abstraction/abstract-agent';
import { AgentError } from '../abstraction/interfaces';
import { generateAgentId } from '../abstraction';

/**
 * Gemini provider configuration
 */
export interface GeminiConfig extends GeminiProviderConfig {
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Gemini model information
 */
export const GEMINI_MODELS = {
  'gemini-2.0-flash': {
    name: 'Gemini 2.0 Flash',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    inputCostPer1k: 0.00015,
    outputCostPer1k: 0.0006,
  },
  'gemini-2.0-flash-thinking': {
    name: 'Gemini 2.0 Flash Thinking',
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    inputCostPer1k: 0.00015,
    outputCostPer1k: 0.0006,
  },
  'gemini-1.5-pro': {
    name: 'Gemini 1.5 Pro',
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    inputCostPer1k: 0.00125,
    outputCostPer1k: 0.005,
  },
  'gemini-1.5-flash': {
    name: 'Gemini 1.5 Flash',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    inputCostPer1k: 0.000075,
    outputCostPer1k: 0.0003,
  },
} as const;

type GeminiModelId = keyof typeof GEMINI_MODELS;

/**
 * Conversation history message type
 */
interface ConversationMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

/**
 * Gemini Agent
 *
 * NOTE: Actual API calls require installing the @google/generative-ai package.
 */
export class GeminiAgent extends AbstractAgent {
  private config: GeminiConfig;
  private conversationHistory: ConversationMessage[] = [];
  private abortController: AbortController | null = null;

  constructor(config: GeminiConfig) {
    const modelId = config.model || 'gemini-2.0-flash';
    const modelInfo = GEMINI_MODELS[modelId as GeminiModelId];

    super(generateAgentId('gemini'), modelInfo?.name || 'Gemini Agent', 'gemini', {
      version: '1.0.0',
      description: 'Google Gemini APIを使用したエージェント',
      modelId,
    });
    this.config = config;
  }

  get capabilities(): AgentCapabilities {
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
    const apiKey = this.getApiKey();
    return !!apiKey;
  }

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    const apiKey = this.getApiKey();
    if (!apiKey) {
      errors.push(
        'API key is not configured. Set GOOGLE_AI_API_KEY or GEMINI_API_KEY environment variable or provide apiKey in config.',
      );
    }

    if (this.config.model && !GEMINI_MODELS[this.config.model as GeminiModelId]) {
      errors.push(
        `Unknown model: ${this.config.model}. Available models: ${Object.keys(GEMINI_MODELS).join(', ')}`,
      );
    }

    return { valid: errors.length === 0, errors };
  }

  protected async doExecute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    // TODO: Implement actual API calls after installing @google/generative-ai package
    throw new AgentError(
      'Gemini provider is not yet fully implemented. Please install the @google/generative-ai package and complete the implementation.',
      'configuration',
      false,
    );
  }

  protected async doContinue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    throw new AgentError('Gemini provider is not yet fully implemented.', 'configuration', false);
  }

  protected async doStop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private getApiKey(): string | undefined {
    return this.config.apiKey || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  }

  private getDefaultSystemPrompt(context: AgentExecutionContext): string {
    return `You are a helpful AI assistant specializing in software development.
You are working in the directory: ${context.workingDirectory}

Guidelines:
- Provide clear, concise, and accurate responses
- When writing code, follow best practices and include appropriate comments
- If you need clarification, ask specific questions
- Focus on practical solutions`;
  }

  private buildPrompt(task: AgentTaskDefinition): string {
    if (task.optimizedPrompt) {
      return task.optimizedPrompt;
    }

    if (task.prompt) {
      return task.prompt;
    }

    return `# Task: ${task.title}\n\n${task.description || ''}`;
  }
}

/**
 * Gemini Provider
 */
export class GeminiProvider implements IAgentProvider {
  readonly providerId = 'gemini' as const;
  readonly providerName = 'Google Gemini';
  readonly version = '1.0.0';

  private defaultConfig: GeminiConfig;

  constructor(config?: Partial<GeminiConfig>) {
    this.defaultConfig = {
      providerId: 'gemini',
      enabled: true,
      model: 'gemini-2.0-flash',
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
      this.defaultConfig.apiKey || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    return !!apiKey;
  }

  async validateConfig(config: AgentProviderConfig): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (config.providerId !== 'gemini') {
      errors.push(`Invalid provider ID: ${config.providerId}`);
    }

    const geminiConfig = config as GeminiConfig;
    const apiKey =
      geminiConfig.apiKey || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      errors.push('API key is required');
    }

    if (geminiConfig.model && !GEMINI_MODELS[geminiConfig.model as GeminiModelId]) {
      errors.push(`Unknown model: ${geminiConfig.model}`);
    }

    return { valid: errors.length === 0, errors };
  }

  async healthCheck(): Promise<AgentHealthStatus> {
    const apiKey =
      this.defaultConfig.apiKey || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        healthy: false,
        available: false,
        errors: ['API key not configured'],
        lastCheck: new Date(),
      };
    }

    // TODO: Implement full health check after installing @google/generative-ai package
    return {
      healthy: true,
      available: true,
      lastCheck: new Date(),
      details: {
        note: 'Stub implementation - full health check requires @google/generative-ai package',
      },
    };
  }

  createAgent(config: AgentProviderConfig): IAgent {
    const mergedConfig: GeminiConfig = {
      ...this.defaultConfig,
      ...config,
    } as GeminiConfig;

    return new GeminiAgent(mergedConfig);
  }

  /**
   * Returns the list of available models with pricing info.
   */
  getAvailableModels(): Array<{
    id: string;
    name: string;
    contextWindow: number;
    maxOutputTokens: number;
    inputCostPer1k: number;
    outputCostPer1k: number;
  }> {
    return Object.entries(GEMINI_MODELS).map(([id, info]) => ({
      id,
      ...info,
    }));
  }
}

/**
 * Default Gemini provider instance
 */
export const geminiProvider = new GeminiProvider();
