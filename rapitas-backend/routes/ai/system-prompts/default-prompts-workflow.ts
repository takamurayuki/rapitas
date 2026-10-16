/**
 * SystemPrompts / DefaultPromptsWorkflow
 *
 * Aggregates workflow-role default prompt seed records for all workflow agent
 * roles (researcher / planner / implementer / verifier / auto_verifier).
 * Content lives in per-role sub-files to keep each under 300 lines.
 * Not responsible for core prompts (see default-prompts-core.ts).
 */

import type { DefaultPromptRecord } from './default-prompts-core';
export type { DefaultPromptRecord };

import { WORKFLOW_PROMPTS_RESEARCH_PLAN } from './default-prompts-workflow-rp';
import { WORKFLOW_PROMPTS_IMPL_VERIFY } from './default-prompts-workflow-riv';

/**
 * All workflow-role default prompts in pipeline order.
 */
export const WORKFLOW_DEFAULT_PROMPTS: DefaultPromptRecord[] = [
  ...WORKFLOW_PROMPTS_RESEARCH_PLAN,
  ...WORKFLOW_PROMPTS_IMPL_VERIFY,
];
