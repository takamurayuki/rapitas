/**
 * Anthropic API プロバイダー
 * @anthropic-ai/sdk を使用してClaude APIを直接呼び出すプロバイダー
 */

import Anthropic from '@anthropic-ai/sdk';
// @ts-ignore - APIError is exported from @anthropic-ai/sdk
const { APIError } = require('@anthropic-ai/sdk');
import type {
  AgentCapabilities,
  AgentProviderConfig,
  AnthropicAPIProviderConfig,
  AgentHealthStatus,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  ContinuationContext,
  ExecutionMetrics,
} from '../abstraction/types';
import type { IAgentProvider, IAgent } from '../abstraction/interfaces';
import { AbstractAgent } from '../abstraction/abstract-agent';
import { AgentError } from '../abstraction/interfaces';
import { generateAgentId } from '../abstraction';

/**
 * Anthropic API プロバイダー設定
 */
export interface AnthropicApiConfig extends AnthropicAPIProviderConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Claude モデル情報
 */
export const CLAUDE_MODELS = {
  'claude-opus-4-5-20251101': {
    name: 'Claude Opus 4.5',
    contextWindow: 200000,
    maxOutputTokens: 32768,
    inputCostPer1k: 0.015,
    outputCostPer1k: 0.075,
  },
  'claude-sonnet-4-20250514': {
    name: 'Claude Sonnet 4',
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
  },
  'claude-3-5-sonnet-20241022': {
    name: 'Claude 3.5 Sonnet',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
  },
  'claude-3-5-haiku-20241022': {
    name: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPer1k: 0.001,
    outputCostPer1k: 0.005,
  },
} as const;

type ClaudeModelId = keyof typeof CLAUDE_MODELS;

/**
 * 会話履歴のメッセージ型
 */
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Anthropic API エージェント
 */
export class AnthropicApiAgent extends AbstractAgent {
  private config: AnthropicApiConfig;
  private client: InstanceType<typeof Anthropic> | null = null;
  private conversationHistory: ConversationMessage[] = [];
  private abortController: AbortController | null = null;

  constructor(config: AnthropicApiConfig) {
    const modelId = config.model || 'claude-sonnet-4-20250514';
    const modelInfo = CLAUDE_MODELS[modelId as ClaudeModelId];

    super(
      generateAgentId('anthropic-api'),
      modelInfo?.name || 'Anthropic API Agent',
      'anthropic-api',
      {
        version: '1.0.0',
        description: 'Anthropic Messages APIを使用したエージェント',
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
    try {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        return false;
      }

      const client = new Anthropic({ apiKey });
      // 簡単なAPIコールでテスト
      await client.messages.create({
        model: this.config.model || 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return true;
    } catch (error) {
      this.log('error', 'Anthropic API availability check failed', { error });
      return false;
    }
  }

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    const apiKey = this.getApiKey();
    if (!apiKey) {
      errors.push('API key is not configured. Set ANTHROPIC_API_KEY environment variable or provide apiKey in config.');
    }

    if (this.config.model && !CLAUDE_MODELS[this.config.model as ClaudeModelId]) {
      errors.push(`Unknown model: ${this.config.model}. Available models: ${Object.keys(CLAUDE_MODELS).join(', ')}`);
    }

    if (this.config.maxTokens && this.config.maxTokens < 1) {
      errors.push('maxTokens must be a positive number');
    }

    if (this.config.temperature !== undefined && (this.config.temperature < 0 || this.config.temperature > 1)) {
      errors.push('temperature must be between 0 and 1');
    }

    return { valid: errors.length === 0, errors };
  }

  protected async doExecute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const startTime = new Date();
    this.conversationHistory = [];
    this.abortController = new AbortController();

    try {
      const client = this.getClient();
      const prompt = this.buildPrompt(task);
      const modelId = this.config.model || 'claude-sonnet-4-20250514';
      const modelInfo = CLAUDE_MODELS[modelId as ClaudeModelId];

      const maxTokens = this.config.maxTokens || modelInfo?.maxOutputTokens || 8192;

      this.log('info', `Executing with model: ${modelId}`, { promptLength: prompt.length });

      // ユーザーメッセージを履歴に追加
      this.conversationHistory.push({ role: 'user', content: prompt });

      const response = await client.messages.create({
        model: modelId,
        max_tokens: maxTokens,
        temperature: this.config.temperature,
        system: this.config.systemPrompt || this.getDefaultSystemPrompt(context),
        messages: this.conversationHistory.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      });

      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      // アシスタントの応答を取得
      let output = '';
      for (const block of response.content) {
        if (block.type === 'text') {
          output += block.text;
        }
      }

      // アシスタントの応答を履歴に追加
      this.conversationHistory.push({ role: 'assistant', content: output });

      await this.emitOutput(output, false, false);

      const metrics: ExecutionMetrics = {
        startTime,
        endTime,
        durationMs,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        apiCalls: 1,
      };

      // コスト計算
      if (modelInfo) {
        metrics.costUsd =
          (response.usage.input_tokens / 1000) * modelInfo.inputCostPer1k +
          (response.usage.output_tokens / 1000) * modelInfo.outputCostPer1k;
      }

      this.updateMetrics(metrics);

      return {
        success: true,
        state: 'completed',
        output,
        metrics,
        sessionId: this._metadata.id,
      };
    } catch (error) {
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      if (error instanceof APIError) {
        const agentError = this.mapApiError(error);
        await this._events.emitError(agentError, agentError.recoverable);

        return {
          success: false,
          state: 'failed',
          output: '',
          errorMessage: agentError.message,
          metrics: {
            startTime,
            endTime,
            durationMs,
          },
        };
      }

      throw error;
    } finally {
      this.abortController = null;
    }
  }

  protected async doContinue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const startTime = new Date();
    this.abortController = new AbortController();

    try {
      const client = this.getClient();
      const userResponse = continuation.userResponse || '';
      const modelId = this.config.model || 'claude-sonnet-4-20250514';
      const modelInfo = CLAUDE_MODELS[modelId as ClaudeModelId];

      const maxTokens = this.config.maxTokens || modelInfo?.maxOutputTokens || 8192;

      // ユーザーの応答を履歴に追加
      this.conversationHistory.push({ role: 'user', content: userResponse });

      this.log('info', 'Continuing conversation', { historyLength: this.conversationHistory.length });

      const response = await client.messages.create({
        model: modelId,
        max_tokens: maxTokens,
        temperature: this.config.temperature,
        system: this.config.systemPrompt || this.getDefaultSystemPrompt(context),
        messages: this.conversationHistory.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      });

      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      // アシスタントの応答を取得
      let output = '';
      for (const block of response.content) {
        if (block.type === 'text') {
          output += block.text;
        }
      }

      // アシスタントの応答を履歴に追加
      this.conversationHistory.push({ role: 'assistant', content: output });

      await this.emitOutput(output, false, false);

      const metrics: ExecutionMetrics = {
        startTime,
        endTime,
        durationMs,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        apiCalls: 1,
      };

      if (modelInfo) {
        metrics.costUsd =
          (response.usage.input_tokens / 1000) * modelInfo.inputCostPer1k +
          (response.usage.output_tokens / 1000) * modelInfo.outputCostPer1k;
      }

      this.updateMetrics(metrics);

      return {
        success: true,
        state: 'completed',
        output,
        metrics,
        sessionId: this._metadata.id,
      };
    } catch (error) {
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      if (error instanceof APIError) {
        const agentError = this.mapApiError(error);
        await this._events.emitError(agentError, agentError.recoverable);

        return {
          success: false,
          state: 'failed',
          output: '',
          errorMessage: agentError.message,
          metrics: {
            startTime,
            endTime,
            durationMs,
          },
        };
      }

      throw error;
    } finally {
      this.abortController = null;
    }
  }

  protected async doStop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private getApiKey(): string | undefined {
    return this.config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  }

  private getClient(): InstanceType<typeof Anthropic> {
    if (!this.client) {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        throw new AgentError(
          'Anthropic API key is not configured',
          'authentication',
          false,
        );
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  private getDefaultSystemPrompt(context: AgentExecutionContext): string {
    return `You are a helpful AI assistant specializing in software development.
You are working in the directory: ${context.workingDirectory}

Guidelines:
- Provide clear, concise, and accurate responses
- When writing code, follow best practices and include appropriate comments
- If you need clarification, ask specific questions
- Focus on practical solutions

Current time: ${new Date().toISOString()}`;
  }

  private buildPrompt(task: AgentTaskDefinition): string {
    if (task.optimizedPrompt) {
      return task.optimizedPrompt;
    }

    if (task.prompt) {
      return task.prompt;
    }

    const parts: string[] = [];

    parts.push(`# Task: ${task.title}`);

    if (task.description) {
      parts.push('');
      parts.push('## Description');
      parts.push(task.description);
    }

    if (task.analysis) {
      parts.push('');
      parts.push('## Analysis');
      parts.push(`- Complexity: ${task.analysis.complexity}`);
      parts.push(`- Summary: ${task.analysis.summary}`);

      if (task.analysis.subtasks && task.analysis.subtasks.length > 0) {
        parts.push('');
        parts.push('## Subtasks');
        for (const subtask of task.analysis.subtasks) {
          parts.push(`${subtask.order}. ${subtask.title}: ${subtask.description}`);
        }
      }
    }

    return parts.join('\n');
  }

  private mapApiError(error: InstanceType<typeof APIError>): AgentError {
    const status = error.status;
    const message = error.message;

    if (status === 401) {
      return new AgentError(
        `Authentication failed: ${message}`,
        'authentication',
        false,
      );
    }

    if (status === 429) {
      const retryAfter = parseInt(error.headers?.['retry-after'] || '60', 10);
      return new AgentError(
        `Rate limit exceeded: ${message}`,
        'rate_limit',
        true,
        retryAfter * 1000,
      );
    }

    if (status === 500 || status === 502 || status === 503) {
      return new AgentError(
        `Anthropic API error: ${message}`,
        'network',
        true,
        5000,
      );
    }

    if (status === 400) {
      return new AgentError(
        `Invalid request: ${message}`,
        'validation',
        false,
      );
    }

    return new AgentError(
      `Anthropic API error: ${message}`,
      'execution',
      false,
    );
  }
}

/**
 * Anthropic API プロバイダー
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
    const apiKey = this.defaultConfig.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    return !!apiKey;
  }

  async validateConfig(config: AgentProviderConfig): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (config.providerId !== 'anthropic-api') {
      errors.push(`Invalid provider ID: ${config.providerId}`);
    }

    const anthropicConfig = config as AnthropicApiConfig;
    const apiKey = anthropicConfig.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

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
      const apiKey = this.defaultConfig.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

      if (!apiKey) {
        return {
          healthy: false,
          available: false,
          errors: ['API key not configured'],
          lastCheck: new Date(),
        };
      }

      const client = new Anthropic({ apiKey });

      // 軽量なAPIコールでヘルスチェック
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
    return Object.entries(CLAUDE_MODELS).map(([id, info]) => ({
      id,
      ...info,
    }));
  }
}

/**
 * デフォルトの Anthropic API プロバイダーインスタンス
 */
export const anthropicApiProvider = new AnthropicApiProvider();
