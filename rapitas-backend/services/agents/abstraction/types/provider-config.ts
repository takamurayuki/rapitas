/**
 * Provider configuration type definitions.
 */

import type { AgentProviderId, AgentCapabilities } from './agent-identification';

/**
 * Common provider configuration.
 */
export interface AgentProviderConfigBase {
  providerId: AgentProviderId;
  enabled: boolean;

  // Authentication
  apiKey?: string;
  apiKeyEnvVar?: string;

  // Endpoint
  endpoint?: string;

  // Defaults
  defaultModel?: string;
  defaultTimeout?: number;
  maxConcurrentExecutions?: number;

  // Feature flags
  features?: Partial<AgentCapabilities>;

  // Custom settings
  customConfig?: Record<string, unknown>;
}

export interface ClaudeCodeProviderConfig extends AgentProviderConfigBase {
  providerId: 'claude-code';
  cliPath?: string;
  dangerouslySkipPermissions?: boolean;
}

export interface OpenAIProviderConfig extends AgentProviderConfigBase {
  providerId: 'openai-codex';
  organization?: string;
}

export interface GeminiProviderConfig extends AgentProviderConfigBase {
  providerId: 'gemini';
  projectId?: string;
  location?: string;
}

export interface GeminiCliProviderConfig extends AgentProviderConfigBase {
  providerId: 'google-gemini';
  cliPath?: string;
  projectId?: string;
  location?: string;
  sandboxMode?: boolean;
  yolo?: boolean;
  checkpointId?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
}

export interface AnthropicAPIProviderConfig extends AgentProviderConfigBase {
  providerId: 'anthropic-api';
  anthropicVersion?: string;
}

/**
 * Union of all provider configurations.
 */
export type AgentProviderConfig =
  | ClaudeCodeProviderConfig
  | OpenAIProviderConfig
  | GeminiProviderConfig
  | GeminiCliProviderConfig
  | AnthropicAPIProviderConfig
  | AgentProviderConfigBase;
