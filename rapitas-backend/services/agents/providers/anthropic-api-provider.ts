/**
 * Anthropic API Provider
 *
 * Re-exports all public symbols from the anthropic-api-provider sub-modules.
 * Maintained for backward compatibility — consumers should prefer importing
 * from the sub-modules directly for tree-shaking benefits.
 */

export type { AnthropicApiConfig, ConversationMessage } from './anthropic-api-provider/models';
export { CLAUDE_MODELS } from './anthropic-api-provider/models';
export type { ClaudeModelId } from './anthropic-api-provider/models';

export {
  buildPrompt,
  getDefaultSystemPrompt,
  mapApiError,
} from './anthropic-api-provider/agent-utils';

export { AnthropicApiAgent } from './anthropic-api-provider/agent';

export { AnthropicApiProvider, anthropicApiProvider } from './anthropic-api-provider/provider';
