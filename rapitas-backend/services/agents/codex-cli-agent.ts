/**
 * CodexCliAgent — Public Entry Point
 *
 * Re-exports all public symbols from the codex-cli-agent sub-module
 * to maintain backward compatibility with existing imports.
 * Implementation has been split into:
 *   - codex-cli-agent/types.ts         (config type + resolveCliPath)
 *   - codex-cli-agent/prompt-builder.ts (buildStructuredPrompt)
 *   - codex-cli-agent/output-parser.ts  (parseArtifacts, parseCommits, formatToolInfo)
 *   - codex-cli-agent/process-runner.ts (spawnCodexProcess)
 *   - codex-cli-agent/index.ts          (CodexCliAgent class)
 */

export { CodexCliAgent, resolveCliPath } from './codex-cli-agent/index';
export type { CodexCliAgentConfig } from './codex-cli-agent/types';
