/**
 * Anthropic API Agent
 *
 * Concrete IAgent implementation that calls the Anthropic Messages API for task
 * execution and multi-turn conversation continuation. Handles API error mapping
 * and per-request abort control. Does not manage provider-level concerns.
 */

import Anthropic from '@anthropic-ai/sdk';
import { APIError } from '@anthropic-ai/sdk';
import { getApiKeyForProvider } from '../../../../utils/ai-client';
import type {
  AgentCapabilities,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  ContinuationContext,
  ExecutionMetrics,
} from '../../abstraction/types';
import { AbstractAgent } from '../../abstraction/abstract-agent';
import { AgentError } from '../../abstraction/interfaces';
import { generateAgentId } from '../../abstraction';
import {
  CLAUDE_MODELS,
  type AnthropicApiConfig,
  type ClaudeModelId,
  type ConversationMessage,
} from './models';
import { buildPrompt, getDefaultSystemPrompt, mapApiError } from './agent-utils';

/**
 * Anthropic API Agent
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
      const apiKey = await this.getApiKey();
      if (!apiKey) return false;

      const client = new Anthropic({ apiKey });
      // Lightweight API call to verify connectivity
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

    const apiKey = await this.getApiKey();
    if (!apiKey) {
      errors.push(
        'API key is not configured. Set ANTHROPIC_API_KEY environment variable or provide apiKey in config.',
      );
    }

    if (this.config.model && !CLAUDE_MODELS[this.config.model as ClaudeModelId]) {
      errors.push(
        `Unknown model: ${this.config.model}. Available models: ${Object.keys(CLAUDE_MODELS).join(', ')}`,
      );
    }

    if (this.config.maxTokens && this.config.maxTokens < 1) {
      errors.push('maxTokens must be a positive number');
    }

    if (
      this.config.temperature !== undefined &&
      (this.config.temperature < 0 || this.config.temperature > 1)
    ) {
      errors.push('temperature must be between 0 and 1');
    }

    return { valid: errors.length === 0, errors };
  }

  protected async doExecute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.conversationHistory = [];
    const userMessage = buildPrompt(task);
    this.conversationHistory.push({ role: 'user', content: userMessage });

    const modelId = this.config.model || 'claude-sonnet-4-20250514';
    this.log('info', `Executing with model: ${modelId}`, { promptLength: userMessage.length });

    return this.callApi(context);
  }

  protected async doContinue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const userResponse = continuation.userResponse || '';
    this.conversationHistory.push({ role: 'user', content: userResponse });

    this.log('info', 'Continuing conversation', {
      historyLength: this.conversationHistory.length,
    });

    return this.callApi(context);
  }

  protected async doStop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Sends the current conversationHistory to the API and returns an AgentExecutionResult.
   * Used by both doExecute and doContinue to avoid duplication.
   *
   * @param context - Execution context for system prompt generation / システムプロンプト生成に使用する実行コンテキスト
   * @returns Execution result with metrics / メトリクス付きの実行結果
   */
  private async callApi(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startTime = new Date();
    this.abortController = new AbortController();

    try {
      const client = await this.getClient();
      const modelId = this.config.model || 'claude-sonnet-4-20250514';
      const modelInfo = CLAUDE_MODELS[modelId as ClaudeModelId];
      const maxTokens = this.config.maxTokens || modelInfo?.maxOutputTokens || 8192;

      const response = await client.messages.create({
        model: modelId,
        max_tokens: maxTokens,
        temperature: this.config.temperature,
        system: this.config.systemPrompt || getDefaultSystemPrompt(context),
        messages: this.conversationHistory.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      });

      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      let output = '';
      for (const block of response.content) {
        if (block.type === 'text') {
          output += block.text;
        }
      }

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
        const agentError = mapApiError(error);
        await this._events.emitError(agentError, agentError.recoverable);

        return {
          success: false,
          state: 'failed',
          output: '',
          errorMessage: agentError.message,
          metrics: { startTime, endTime, durationMs },
        };
      }

      throw error;
    } finally {
      this.abortController = null;
    }
  }

  private async getApiKey(): Promise<string | undefined> {
    // Priority: config > DB-stored key (decrypted via getApiKeyForProvider) > env var
    if (this.config.apiKey) return this.config.apiKey;
    const dbKey = await getApiKeyForProvider('claude');
    if (dbKey) return dbKey;
    return process.env.ANTHROPIC_API_KEY;
  }

  private async getClient(): Promise<InstanceType<typeof Anthropic>> {
    if (!this.client) {
      const apiKey = await this.getApiKey();
      if (!apiKey) {
        throw new AgentError('Anthropic API key is not configured', 'authentication', false);
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }
}
