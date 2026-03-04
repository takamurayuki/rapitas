/**
 * AIエージェントプロバイダー - エントリーポイント
 *
 * 各AIプロバイダーの実装とレジストリへの登録を管理
 */

// プロバイダー実装のエクスポート
export { ClaudeCodeProvider, claudeCodeProvider } from './claude-code-provider';
export { ClaudeCodeAgentAdapter } from './claude-code-agent-adapter';

import { createLogger } from '../../../../config/logger';

const log = createLogger('abstraction-providers');

// レジストリ
import { AgentRegistry } from '../registry';
import { ClaudeCodeProvider } from './claude-code-provider';

/**
 * 全ての組み込みプロバイダーをレジストリに登録
 */
export function registerBuiltinProviders(): void {
  const registry = AgentRegistry.getInstance();

  // Claude Code Provider
  const claudeCodeProvider = new ClaudeCodeProvider();
  registry.registerProvider(claudeCodeProvider);

  log.info('[Agent Providers] Builtin providers registered');
}

/**
 * 特定のプロバイダーのみを登録
 */
export function registerProvider(providerId: 'claude-code' | 'openai-codex' | 'gemini' | 'anthropic-api'): void {
  const registry = AgentRegistry.getInstance();

  switch (providerId) {
    case 'claude-code':
      registry.registerProvider(new ClaudeCodeProvider());
      break;
    case 'openai-codex':
      log.warn(`[Agent Providers] Provider '${providerId}' is not yet implemented`);
      break;
    case 'gemini':
      log.warn(`[Agent Providers] Provider '${providerId}' is not yet implemented`);
      break;
    case 'anthropic-api':
      log.warn(`[Agent Providers] Provider '${providerId}' is not yet implemented`);
      break;
    default:
      log.warn(`[Agent Providers] Unknown provider: ${providerId}`);
  }
}

/**
 * プロバイダーの自動初期化
 * アプリケーション起動時に呼び出す
 */
export async function initializeProviders(): Promise<{
  registered: string[];
  available: string[];
  errors: string[];
}> {
  const registry = AgentRegistry.getInstance();
  const registered: string[] = [];
  const available: string[] = [];
  const errors: string[] = [];

  // Claude Code Provider
  try {
    const claudeProvider = new ClaudeCodeProvider();
    registry.registerProvider(claudeProvider);
    registered.push('claude-code');

    // 利用可能かチェック
    const isAvailable = await claudeProvider.isAvailable();
    if (isAvailable) {
      available.push('claude-code');
    }
  } catch (error) {
    errors.push(`Failed to register Claude Code Provider: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 将来の追加プロバイダー用のプレースホルダー
  // OpenAI Codex, Gemini等の実装時にここに追加

  log.info(`[Agent Providers] Initialization complete: ${registered.length} registered, ${available.length} available`);

  return {
    registered,
    available,
    errors,
  };
}
