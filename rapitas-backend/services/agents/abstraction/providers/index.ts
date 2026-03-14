/**
 * Agent Providers - Entry Point
 *
 * Manages provider implementations and their registration with the registry.
 */

// Provider implementation exports
export { ClaudeCodeProvider, claudeCodeProvider } from './claude-code-provider';
export { ClaudeCodeAgentAdapter } from './claude-code-agent-adapter';

import { createLogger } from '../../../../config/logger';

const log = createLogger('abstraction-providers');

// Registry
import { AgentRegistry } from '../registry';
import { ClaudeCodeProvider } from './claude-code-provider';

/**
 * Registers all built-in providers with the registry.
 */
export function registerBuiltinProviders(): void {
  const registry = AgentRegistry.getInstance();

  // Claude Code Provider
  const claudeCodeProvider = new ClaudeCodeProvider();
  registry.registerProvider(claudeCodeProvider);

  log.info('[Agent Providers] Builtin providers registered');
}

/**
 * Registers a specific provider.
 */
export function registerProvider(
  providerId: 'claude-code' | 'openai-codex' | 'gemini' | 'anthropic-api',
): void {
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
 * Auto-initializes providers.
 * Should be called at application startup.
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

    // Check availability
    const isAvailable = await claudeProvider.isAvailable();
    if (isAvailable) {
      available.push('claude-code');
    }
  } catch (error) {
    errors.push(
      `Failed to register Claude Code Provider: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // TODO: Add OpenAI Codex, Gemini, etc. providers here when implemented.

  log.info(
    `[Agent Providers] Initialization complete: ${registered.length} registered, ${available.length} available`,
  );

  return {
    registered,
    available,
    errors,
  };
}
