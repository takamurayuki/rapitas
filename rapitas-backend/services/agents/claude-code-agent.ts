/**
 * ClaudeCodeAgent
 *
 * Backward-compatibility re-export barrel. Implementation has been split into:
 *   - claude-code/agent-core.ts  — ClaudeCodeAgent class and execute() logic
 *   - claude-code/cli-utils.ts   — CLI path resolution and spawn command helpers
 *   - claude-code/prompt-builder.ts — Structured prompt construction from task analysis
 *   - claude-code/git-diff-checker.ts — Git working-tree change detection
 *   - claude-code/question-extractor.ts — AskUserQuestion tool input parsing
 */

export { ClaudeCodeAgent } from './claude-code/agent-core';
export type { ClaudeCodeAgentConfig } from './claude-code/agent-core';
