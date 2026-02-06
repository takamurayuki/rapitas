/**
 * OpenAI プロバイダー（スタブ実装）
 * OpenAI API を使用したエージェントプロバイダー
 *
 * 注意: このファイルはインターフェースの定義のみで、実際の実装は
 * openai パッケージをインストールした後に完成させる必要があります。
 */

import type {
  AgentCapabilities,
  AgentProviderConfig,
  OpenAIProviderConfig,
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
 * OpenAI プロバイダー設定
 */
export interface OpenAIConfig extends OpenAIProviderConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * OpenAI モデル情報
 */
export const OPENAI_MODELS = {
  'gpt-4o': {
    name: 'GPT-4o',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputCostPer1k: 0.005,
    outputCostPer1k: 0.015,
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputCostPer1k: 0.00015,
    outputCostPer1k: 0.0006,
  },
  'gpt-4-turbo': {
    name: 'GPT-4 Turbo',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputCostPer1k: 0.01,
    outputCostPer1k: 0.03,
  },
  'o1-preview': {
    name: 'o1 Preview',
    contextWindow: 128000,
    maxOutputTokens: 32768,
    inputCostPer1k: 0.015,
    outputCostPer1k: 0.06,
  },
  'o1-mini': {
    name: 'o1 Mini',
    contextWindow: 128000,
    maxOutputTokens: 65536,
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.012,
  },
} as const;

type OpenAIModelId = keyof typeof OPENAI_MODELS;

/**
 * 会話履歴のメッセージ型
 */
interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * OpenAI エージェント
 * 注意: 実際のAPI呼び出しは openai パッケージのインストール後に実装
 */
export class OpenAIAgent extends AbstractAgent {
  private config: OpenAIConfig;
  private conversationHistory: ConversationMessage[] = [];
  private abortController: AbortController | null = null;

  constructor(config: OpenAIConfig) {
    const modelId = config.model || 'gpt-4o';
    const modelInfo = OPENAI_MODELS[modelId as OpenAIModelId];

    super(
      generateAgentId('openai-codex'),
      modelInfo?.name || 'OpenAI Agent',
      'openai-codex',
      {
        version: '1.0.0',
        description: 'OpenAI APIを使用したエージェント',
        modelId,
      },
    );
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
      errors.push('API key is not configured. Set OPENAI_API_KEY environment variable or provide apiKey in config.');
    }

    if (this.config.model && !OPENAI_MODELS[this.config.model as OpenAIModelId]) {
      errors.push(`Unknown model: ${this.config.model}. Available models: ${Object.keys(OPENAI_MODELS).join(', ')}`);
    }

    return { valid: errors.length === 0, errors };
  }

  protected async doExecute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    // スタブ実装 - 実際のAPI呼び出しは openai パッケージ導入後に実装
    throw new AgentError(
      'OpenAI provider is not yet fully implemented. Please install the openai package and complete the implementation.',
      'configuration',
      false,
    );
  }

  protected async doContinue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    throw new AgentError(
      'OpenAI provider is not yet fully implemented.',
      'configuration',
      false,
    );
  }

  protected async doStop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private getApiKey(): string | undefined {
    return this.config.apiKey || process.env.OPENAI_API_KEY;
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
 * OpenAI プロバイダー
 */
export class OpenAIProvider implements IAgentProvider {
  readonly providerId = 'openai-codex' as const;
  readonly providerName = 'OpenAI';
  readonly version = '1.0.0';

  private defaultConfig: OpenAIConfig;

  constructor(config?: Partial<OpenAIConfig>) {
    this.defaultConfig = {
      providerId: 'openai-codex',
      enabled: true,
      model: 'gpt-4o',
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
    const apiKey = this.defaultConfig.apiKey || process.env.OPENAI_API_KEY;
    return !!apiKey;
  }

  async validateConfig(config: AgentProviderConfig): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (config.providerId !== 'openai-codex') {
      errors.push(`Invalid provider ID: ${config.providerId}`);
    }

    const openaiConfig = config as OpenAIConfig;
    const apiKey = openaiConfig.apiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      errors.push('API key is required');
    }

    if (openaiConfig.model && !OPENAI_MODELS[openaiConfig.model as OpenAIModelId]) {
      errors.push(`Unknown model: ${openaiConfig.model}`);
    }

    return { valid: errors.length === 0, errors };
  }

  async healthCheck(): Promise<AgentHealthStatus> {
    const apiKey = this.defaultConfig.apiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return {
        healthy: false,
        available: false,
        errors: ['API key not configured'],
        lastCheck: new Date(),
      };
    }

    // スタブ実装 - 実際のヘルスチェックは openai パッケージ導入後に実装
    return {
      healthy: true,
      available: true,
      lastCheck: new Date(),
      details: {
        note: 'Stub implementation - full health check requires openai package',
      },
    };
  }

  createAgent(config: AgentProviderConfig): IAgent {
    const mergedConfig: OpenAIConfig = {
      ...this.defaultConfig,
      ...config,
    } as OpenAIConfig;

    return new OpenAIAgent(mergedConfig);
  }

  /**
   * 利用可能なモデル一覧を取得
   */
  getAvailableModels(): Array<{
    id: string;
    name: string;
    contextWindow: number;
    maxOutputTokens: number;
    inputCostPer1k: number;
    outputCostPer1k: number;
  }> {
    return Object.entries(OPENAI_MODELS).map(([id, info]) => ({
      id,
      ...info,
    }));
  }
}

/**
 * デフォルトの OpenAI プロバイダーインスタンス
 */
export const openaiProvider = new OpenAIProvider();
