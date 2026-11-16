/**
 * cli-model-alias
 *
 * The single mapping from a requested Claude model id to the `--model` alias
 * the Claude Code CLI is actually started with. Shared by the CLI provider
 * (which spawns with it) and the jury (which must know when two seats end up
 * on the same model). Not responsible for spawning or model discovery.
 */

/**
 * Map a full model id (or undefined) to a Claude Code `--model` alias.
 * Unspecified or unrecognised ids default to Haiku — aux calls should stay
 * light on the shared subscription rate limit.
 *
 * @param model - Requested model id, if any / 要求モデルID（任意）
 * @returns CLI model alias / CLIのモデルエイリアス
 */
export function toCliModelAlias(model?: string): 'opus' | 'sonnet' | 'haiku' {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  return 'haiku';
}
