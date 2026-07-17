/**
 * log-patterns-table
 *
 * Backward-compatibility re-export shim. The 568-line rule table was split
 * into log-patterns/ (lifecycle / tool / status / hidden) per
 * COMPONENT_SPLITTING_POLICY; import from './log-patterns' in new code.
 */

export { getLogPatterns, HIDDEN_PATTERNS } from './log-patterns';
export type { LogPatternRule } from './log-patterns';
