/**
 * AI Agent Providers - Entry Point
 *
 * Exports implementations of each AI provider.
 */

// Claude Code provider
export { ClaudeCodeProvider, ClaudeCodeAgentV2, claudeCodeProvider } from './claude-code-provider';
export type { ClaudeCodeConfig } from './claude-code-provider';

// Anthropic API provider
export {
  AnthropicApiProvider,
  AnthropicApiAgent,
  anthropicApiProvider,
  CLAUDE_MODELS,
} from './anthropic-api-provider';
export type { AnthropicApiConfig } from './anthropic-api-provider';

// OpenAI provider (stub)
export { OpenAIProvider, OpenAIAgent, openaiProvider, OPENAI_MODELS } from './openai-provider';
export type { OpenAIConfig } from './openai-provider';

// Gemini API provider (stub)
export { GeminiProvider, GeminiAgent, geminiProvider, GEMINI_MODELS } from './gemini-provider';
export type { GeminiConfig } from './gemini-provider';

// Gemini CLI provider
export { GeminiCliProvider, GeminiCliAgentV2, geminiCliProvider } from './gemini-cli-provider';
export type { GeminiCliConfig } from './gemini-cli-provider';

import { createLogger } from '../../../config/logger';

const log = createLogger('agent-providers');

import { agentRegistry } from '../abstraction';
import { claudeCodeProvider } from './claude-code-provider';
import { anthropicApiProvider } from './anthropic-api-provider';
import { openaiProvider } from './openai-provider';
import { geminiProvider } from './gemini-provider';
import { geminiCliProvider } from './gemini-cli-provider';

/**
 * Provider registration options
 */
export interface RegisterProvidersOptions {
  claudeCode?: boolean;
  anthropicApi?: boolean;
  openai?: boolean;
  gemini?: boolean;
  geminiCli?: boolean;
}

/**
 * Registers default providers with the agent registry.
 */
export function registerDefaultProviders(options?: RegisterProvidersOptions): void {
  const opts: RegisterProvidersOptions = {
    claudeCode: true,
    anthropicApi: true,
    openai: false, // Disabled by default — stub implementation
    gemini: false, // Disabled by default — API version is stub
    geminiCli: true, // Enabled by default — CLI version is fully implemented
    ...options,
  };

  if (opts.claudeCode) {
    agentRegistry.registerProvider(claudeCodeProvider);
  }

  if (opts.anthropicApi) {
    agentRegistry.registerProvider(anthropicApiProvider);
  }

  if (opts.openai) {
    agentRegistry.registerProvider(openaiProvider);
  }

  if (opts.gemini) {
    agentRegistry.registerProvider(geminiProvider);
  }

  if (opts.geminiCli) {
    agentRegistry.registerProvider(geminiCliProvider);
  }

  log.info(
    {
      providers: {
        claudeCode: opts.claudeCode,
        anthropicApi: opts.anthropicApi,
        openai: opts.openai,
        gemini: opts.gemini,
        geminiCli: opts.geminiCli,
      },
    },
    'Default providers registered',
  );
}

/**
 * Registers all providers including stubs.
 */
export function registerAllProviders(): void {
  registerDefaultProviders({
    claudeCode: true,
    anthropicApi: true,
    openai: true,
    gemini: true,
    geminiCli: true,
  });
}

/**
 * List of available provider IDs
 */
export const AVAILABLE_PROVIDERS = [
  'claude-code',
  'anthropic-api',
  'openai-codex',
  'gemini',
  'google-gemini',
] as const;

/**
 * Provider display information
 */
export const PROVIDER_INFO = {
  'claude-code': {
    name: 'Claude Code',
    description: 'Claude Code CLI を使用したフル機能エージェント',
    status: 'stable' as const,
  },
  'anthropic-api': {
    name: 'Anthropic API',
    description: 'Anthropic Messages APIを直接使用するエージェント',
    status: 'stable' as const,
  },
  'openai-codex': {
    name: 'OpenAI',
    description: 'OpenAI APIを使用するエージェント',
    status: 'stub' as const,
  },
  gemini: {
    name: 'Google Gemini API',
    description: 'Google Gemini APIを使用するエージェント',
    status: 'stub' as const,
  },
  'google-gemini': {
    name: 'Gemini CLI',
    description: 'Google Gemini CLIを使用したフル機能エージェント',
    status: 'stable' as const,
  },
} as const;
