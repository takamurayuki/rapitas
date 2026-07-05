/**
 * CLI Agent Classifier
 *
 * Maps an execution's recorded modelName / agentType onto the coding-CLI
 * "agent" it ran through (Claude Code / Codex / Gemini), powering the
 * per-agent usage view. Name-pattern based so new model ids slot in without
 * code changes; the registered agentType is the fallback when the model id
 * is missing (runs that died before reporting usage).
 */

/** The CLI agents whose usage is broken out individually. */
export type CliAgentKind = 'claude-code' | 'codex' | 'gemini' | 'other';

/** Display order for CLI agents (most used first in this project). */
export const CLI_AGENT_ORDER: readonly CliAgentKind[] = ['claude-code', 'codex', 'gemini', 'other'];

/**
 * Classify one execution onto its CLI agent.
 *
 * @param modelName - Recorded model id (e.g. "claude-sonnet-4-6") / モデルID
 * @param agentType - Registered AIAgentConfig.agentType fallback / エージェント種別
 * @returns The CLI agent bucket / CLIエージェント区分
 */
export function classifyCliAgent(
  modelName: string | null | undefined,
  agentType: string | null | undefined,
): CliAgentKind {
  const m = (modelName ?? '').toLowerCase();
  if (m.startsWith('claude')) return 'claude-code';
  if (m.startsWith('gpt') || m.includes('codex') || /^o\d/.test(m)) return 'codex';
  if (m.startsWith('gemini')) return 'gemini';

  const t = (agentType ?? '').toLowerCase();
  if (t.includes('claude')) return 'claude-code';
  if (t.includes('codex') || t.includes('openai')) return 'codex';
  if (t.includes('gemini')) return 'gemini';
  return 'other';
}
