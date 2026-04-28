/**
 * agent-display-name
 *
 * Maps agent type identifiers to human-friendly display names. Used both for
 * generating the `name` of newly created `AIAgentConfig` records and for
 * rewriting legacy `Development Agent (<type>)` names at read time so the UI
 * shows "Claude Code" / "Gemini" / "Codex" instead of the generic prefix.
 */

/** Display labels per known agent type. Add new entries when a type appears. */
const TYPE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  claude: 'Claude Code',
  gemini: 'Gemini',
  'gemini-cli': 'Gemini',
  codex: 'Codex',
  'codex-cli': 'Codex',
  openai: 'OpenAI',
  chatgpt: 'OpenAI',
  ollama: 'Ollama',
  local: 'Local LLM',
};

/**
 * Convert an agent type identifier to a friendly label.
 *
 * @param type - Agent type as stored in `AIAgentConfig.agentType`. / エージェント種別
 * @returns Friendly display label; falls back to the type itself with the first letter capitalised. / 表示用ラベル
 */
export function getAgentTypeLabel(type: string): string {
  if (TYPE_LABELS[type]) return TYPE_LABELS[type];
  if (!type) return 'Agent';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Default `name` for a newly created agent record.
 *
 * @param type - Agent type. / エージェント種別
 * @param purpose - Optional discriminator appended in parentheses (e.g. `Review`). / 用途
 */
export function getDefaultAgentName(type: string, purpose?: 'development' | 'review'): string {
  const label = getAgentTypeLabel(type);
  return purpose === 'review' ? `${label} (Review)` : label;
}

/** Match the legacy generic name pattern emitted by previous versions. */
const LEGACY_DEV_PATTERN = /^Development Agent \((.+)\)$/;
const LEGACY_REVIEW_PATTERN = /^Review Agent \((.+)\)$/;

/**
 * Rewrite a stored agent name into its modern display form. Idempotent —
 * names that already match the new convention are returned unchanged so the
 * helper can be applied unconditionally on every read.
 *
 * @param name - Stored agent name from DB. / DB保存名
 * @param type - Agent type from DB (used as fallback when the legacy regex misses). / エージェント種別
 */
export function formatAgentDisplayName(name: string, type: string): string {
  if (!name) return getAgentTypeLabel(type);
  const dev = LEGACY_DEV_PATTERN.exec(name);
  if (dev) return getAgentTypeLabel(dev[1] || type);
  const review = LEGACY_REVIEW_PATTERN.exec(name);
  if (review) return `${getAgentTypeLabel(review[1] || type)} (Review)`;
  return name;
}

/**
 * Detect whether an agent record represents the project's "development" preset.
 * Tolerates both the legacy `Development Agent (...)` name and the new
 * convention where the friendly name has no purpose suffix and `metadata.purpose`
 * carries the marker.
 *
 * @param name - Stored agent name. / DB保存名
 * @param metadata - Parsed `AIAgentConfig.metadata` JSON object (or unknown). / メタデータ
 */
export function isDevelopmentAgent(name: string, metadata: unknown): boolean {
  if (LEGACY_DEV_PATTERN.test(name)) return true;
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as { purpose?: string }).purpose === 'development'
  ) {
    return true;
  }
  return false;
}

/**
 * Detect whether an agent record represents the project's "review" preset.
 *
 * @param name - Stored agent name. / DB保存名
 * @param metadata - Parsed `AIAgentConfig.metadata` JSON object (or unknown). / メタデータ
 */
export function isReviewAgent(name: string, metadata: unknown): boolean {
  if (LEGACY_REVIEW_PATTERN.test(name)) return true;
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as { purpose?: string }).purpose === 'review'
  ) {
    return true;
  }
  return false;
}
