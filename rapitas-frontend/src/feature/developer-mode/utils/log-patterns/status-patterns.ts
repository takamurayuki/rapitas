/**
 * log-patterns/status-patterns
 *
 * Classification rules for question/warning markers, test result counts,
 * git output, and waiting/timeout status markers. Split out of
 * log-patterns-table.ts per COMPONENT_SPLITTING_POLICY.
 *
 * NOTE: `pattern` regexes match raw tags emitted by the backend agent runner —
 * a wire-format contract, not UI text; do NOT translate them.
 */

import type { LogTranslate } from '../log-pattern-rules';
import type { LogPatternRule } from './types';

/**
 * Builds the question/test/git/status rule group.
 *
 * @param t - Translator scoped to `devMode.logTransformer`. / `devMode.logTransformer` にスコープした翻訳関数
 * @returns Ordered status classification rules. / ステータス分類ルール
 */
export function getStatusPatterns(t: LogTranslate): LogPatternRule[] {
  return [
    // ── Question ──────────────────────────────────────────────────────────
    {
      pattern: /^\[質問\]\s*(.+)/,
      transform: (_l, m) => ({
        category: 'warning',
        message: t('questionPrefix', { text: m[1].substring(0, 120) }),
        detail: m[1].length > 120 ? m[1] : undefined,
        iconName: 'HelpCircle',
      }),
    },
    {
      // NOTE: The captured text (m[1]) is raw content from the backend agent
      // runner and is shown verbatim (not translated). It carries the WHY of
      // gate verdicts / bounces, so the full text is kept in `detail`.
      pattern: /^\[警告\]\s*(.+)/,
      transform: (_l, m) => ({
        category: 'warning',
        message: m[1].substring(0, 120),
        detail: m[1].length > 120 ? m[1] : undefined,
        iconName: 'AlertTriangle',
      }),
    },

    // ── Test results ──────────────────────────────────────────────────────
    {
      pattern: /(\d+)\s+(?:tests?\s+)?passed/i,
      transform: (_l, m) => ({
        category: 'success',
        message: t('testsPassedCount', { count: m[1] }),
        iconName: 'CheckCircle',
      }),
    },
    {
      pattern: /(\d+)\s+(?:tests?\s+)?failed/i,
      transform: (_l, m) => ({
        category: 'error',
        message: t('testsFailedCount', { count: m[1] }),
        iconName: 'XCircle',
      }),
    },
    {
      pattern: /typecheck|type-check|tsc --noEmit/i,
      transform: () => ({
        category: 'progress',
        message: t('typecheckRunning'),
        iconName: 'ShieldCheck',
      }),
    },

    // ── Git output ────────────────────────────────────────────────────────
    {
      pattern: /\[(?:master|main|feature\/[^\]]+)\s+[a-f0-9]+\]\s*(.+)/,
      transform: (_l, m) => ({
        category: 'success',
        message: t('commitMessage', { message: m[1] }),
        iconName: 'GitCommitHorizontal',
      }),
    },
    {
      pattern: /To\s+(?:https?:\/\/|git@).*\.git/,
      transform: () => ({
        category: 'success',
        message: t('pushCompleted'),
        iconName: 'Upload',
      }),
    },

    // ── Status ────────────────────────────────────────────────────────────
    {
      pattern: /^\[WAITING\]/,
      transform: () => ({
        category: 'warning',
        message: t('waitingForAnswer'),
        iconName: 'Clock',
      }),
    },
    {
      pattern: /^\[TIMEOUT\]/,
      transform: () => ({
        category: 'error',
        message: t('timedOut'),
        iconName: 'Timer',
      }),
    },
  ];
}
