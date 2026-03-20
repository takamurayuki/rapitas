/**
 * Anthropic API Agent Utilities
 *
 * Stateless helper functions used by AnthropicApiAgent: prompt construction from
 * a task definition, default system prompt generation, and Anthropic APIError
 * mapping to the internal AgentError type. No class state is accessed here.
 */

import { APIError } from '@anthropic-ai/sdk';
import type { AgentExecutionContext, AgentTaskDefinition } from '../../abstraction/types';
import { AgentError } from '../../abstraction/interfaces';

/**
 * Builds the plain-text prompt to send to the model from a task definition.
 *
 * @param task - Task definition with optional pre-built prompt / タスク定義
 * @returns Prompt string / プロンプト文字列
 */
export function buildPrompt(task: AgentTaskDefinition): string {
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

/**
 * Returns the default system prompt for a given execution context.
 *
 * @param context - Execution context providing the working directory / 実行コンテキスト
 * @returns System prompt string / システムプロンプト文字列
 */
export function getDefaultSystemPrompt(context: AgentExecutionContext): string {
  return `You are a helpful AI assistant specializing in software development.
You are working in the directory: ${context.workingDirectory}

Guidelines:
- Provide clear, concise, and accurate responses
- When writing code, follow best practices and include appropriate comments
- If you need clarification, ask specific questions
- Focus on practical solutions

Current time: ${new Date().toISOString()}`;
}

/**
 * Maps an Anthropic APIError to an internal AgentError with recoverability info.
 *
 * @param error - Raw Anthropic SDK API error / AnthropicのSDKエラー
 * @returns Typed AgentError / 型付きのAgentError
 */
export function mapApiError(error: InstanceType<typeof APIError>): AgentError {
  const status = error.status;
  const message = error.message;

  if (status === 401) {
    return new AgentError(`Authentication failed: ${message}`, 'authentication', false);
  }

  if (status === 429) {
    const retryAfter = parseInt(error.headers?.get('retry-after') || '60', 10);
    return new AgentError(
      `Rate limit exceeded: ${message}`,
      'rate_limit',
      true,
      retryAfter * 1000,
    );
  }

  if (status === 500 || status === 502 || status === 503) {
    return new AgentError(`Anthropic API error: ${message}`, 'network', true, 5000);
  }

  if (status === 400) {
    return new AgentError(`Invalid request: ${message}`, 'validation', false);
  }

  return new AgentError(`Anthropic API error: ${message}`, 'execution', false);
}
