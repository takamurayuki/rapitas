/**
 * Anthropic API Provider — Model Definitions
 *
 * Declares the CLAUDE_MODELS registry with pricing and capability metadata,
 * plus shared config interfaces. Contains no runtime logic.
 */

import type { AnthropicAPIProviderConfig } from '../../abstraction/types';

/**
 * Anthropic API provider configuration
 */
export interface AnthropicApiConfig extends AnthropicAPIProviderConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Claude model information
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

export type ClaudeModelId = keyof typeof CLAUDE_MODELS;

/**
 * Conversation history message type
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}
