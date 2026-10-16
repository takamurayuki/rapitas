/**
 * log-patterns
 *
 * Barrel for the log-classification rule table, split by concern
 * (lifecycle / tool / status / hidden). `getLogPatterns` preserves the
 * original single-table rule ordering: most-specific rules first.
 */

import type { LogTranslate } from '../log-pattern-rules';
import { getLifecyclePatterns } from './lifecycle-patterns';
import { getToolPatterns } from './tool-patterns';
import { getStatusPatterns } from './status-patterns';
import type { LogPatternRule } from './types';

/**
 * Builds the ordered log-classification rule table.
 *
 * @param t - Translator scoped to `devMode.logTransformer`, used to resolve each
 *   rule's human-readable `message`. / `devMode.logTransformer` にスコープした翻訳関数
 * @returns Ordered classification rules (most specific first). / 分類ルール（詳細な順）
 */
export function getLogPatterns(t: LogTranslate): LogPatternRule[] {
  return [...getLifecyclePatterns(t), ...getToolPatterns(t), ...getStatusPatterns(t)];
}

export { HIDDEN_PATTERNS } from './hidden-patterns';
export type { LogPatternRule } from './types';
