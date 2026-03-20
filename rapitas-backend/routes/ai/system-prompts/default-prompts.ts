/**
 * SystemPrompts / DefaultPrompts
 *
 * Aggregates core and workflow default prompt records into a single
 * DEFAULT_SYSTEM_PROMPTS array used for seeding and resetting prompts.
 * Not responsible for the prompt content itself
 * (see default-prompts-core.ts and default-prompts-workflow.ts).
 */

export type { DefaultPromptRecord } from './default-prompts-core';
export { CORE_DEFAULT_PROMPTS } from './default-prompts-core';
export { WORKFLOW_DEFAULT_PROMPTS } from './default-prompts-workflow';

import { CORE_DEFAULT_PROMPTS } from './default-prompts-core';
import { WORKFLOW_DEFAULT_PROMPTS } from './default-prompts-workflow';

/**
 * All default system prompts — core prompts followed by workflow-role prompts.
 */
export const DEFAULT_SYSTEM_PROMPTS = [...CORE_DEFAULT_PROMPTS, ...WORKFLOW_DEFAULT_PROMPTS];
