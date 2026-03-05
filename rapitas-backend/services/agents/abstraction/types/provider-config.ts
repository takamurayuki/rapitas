/**
 * プロバイダー設定の型定義
 */

import type { AgentProviderId, AgentCapabilities } from './agent-identification';

/**
 * プロバイダー共通設定
 */
export interface AgentProviderConfigBase {
  providerId: AgentProviderId;
  enabled: boolean;

  // 認証
  apiKey?: string;
  apiKeyEnvVar?: string;        // 環境変数から取得する場合

  // エンドポイント
  endpoint?: string;

  // デフォルト設定
  defaultModel?: string;
  defaultTimeout?: number;
  maxConcurrentExecutions?: number;

  // 機能フラグ
  features?: Partial<AgentCapabilities>;

  // カスタム設定
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
 * 全プロバイダー設定のユニオン
 */
export type AgentProviderConfig =
  | ClaudeCodeProviderConfig
  | OpenAIProviderConfig
  | GeminiProviderConfig
  | GeminiCliProviderConfig
  | AnthropicAPIProviderConfig
  | AgentProviderConfigBase;
