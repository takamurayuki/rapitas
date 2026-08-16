/**
 * utilization-colors
 *
 * Single source of the fixed role→color and CLI-agent→color mappings shared by
 * the utilization charts and the usage-breakdown widget, so the same entity
 * always renders in the same color across the metrics page.
 */

// NOTE: Fixed role→color mapping (color follows the entity, never its rank).
// Palette validated for light (#fff) and dark (#18181b) surfaces incl. CVD
// separation; 'other' is intentionally neutral.
export const ROLE_COLORS: Record<string, string> = {
  researcher: '#2563eb',
  planner: '#7c3aed',
  implementer: '#059669',
  verifier: '#d97706',
  auto_verifier: '#ea580c',
  other: '#71717a',
};

// NOTE: Same values as the local map in CliAgentUsageWidget — consolidated here
// so the utilization chart cannot drift from the usage widget's colors.
export const CLI_AGENT_COLORS: Record<string, string> = {
  'claude-code': '#6366f1',
  codex: '#0d9488',
  gemini: '#d97706',
  other: '#71717a',
};
