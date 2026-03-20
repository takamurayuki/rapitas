/**
 * SystemPrompts (barrel)
 *
 * Re-exports the Elysia route plugin and default prompt data from the
 * system-prompts sub-module.
 * Exists solely for backward compatibility — all new code should import
 * directly from ./system-prompts/*.
 */

export { systemPromptsRoutes } from './system-prompts/routes';
export { DEFAULT_SYSTEM_PROMPTS } from './system-prompts/default-prompts';
