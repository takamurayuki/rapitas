/**
 * log-patterns/lifecycle-patterns
 *
 * Classification rules for execution lifecycle lines: legacy phase/file/test
 * markers, agent runner lifecycle tags, system events, and the final result.
 * Split out of log-patterns-table.ts per COMPONENT_SPLITTING_POLICY.
 *
 * NOTE: `pattern` regexes match raw tags emitted by the backend agent runner
 * (e.g. `[実行開始]`, `[System: init]`) — these are a wire-format contract,
 * not UI text, and must NOT be translated. Only the human-readable `message`
 * built inside each `transform()` is user-visible; those are resolved via the
 * `t` translator passed in.
 */

import type { LogTranslate } from '../log-pattern-rules';
import type { LogPatternRule } from './types';

/**
 * Builds the lifecycle rule group (legacy markers + runner lifecycle + result).
 *
 * @param t - Translator scoped to `devMode.logTransformer`. / `devMode.logTransformer` にスコープした翻訳関数
 * @returns Ordered lifecycle classification rules. / ライフサイクル分類ルール
 */
export function getLifecyclePatterns(t: LogTranslate): LogPatternRule[] {
  return [
    // ── Legacy plain log formats used by existing tests ─────────────────
    {
      pattern: /\[(research)\]/i,
      transform: () => ({
        category: 'progress',
        message: t('phaseStart.research'),
        iconName: 'Search',
        phase: 'research' as const,
      }),
    },
    {
      pattern: /\[(plan)\]/i,
      transform: () => ({
        category: 'progress',
        message: t('phaseStart.plan'),
        iconName: 'ClipboardList',
        phase: 'plan' as const,
      }),
    },
    {
      pattern: /\[(implement)\]/i,
      transform: () => ({
        category: 'progress',
        message: t('phaseStart.implement'),
        iconName: 'Code',
        phase: 'implement' as const,
      }),
    },
    {
      pattern: /\[(verify)\]/i,
      transform: () => ({
        category: 'progress',
        message: t('phaseStart.verify'),
        iconName: 'ShieldCheck',
        phase: 'verify' as const,
      }),
    },
    {
      pattern: /^file_edit\s+(.+)/,
      transform: (_l, m) => {
        const file = m[1];
        const basename = file.split(/[\\/]/).pop() || file;
        return {
          category: 'info',
          message: t('fileEdited', { basename }),
          detail: file,
          iconName: 'FileEdit',
        };
      },
    },
    {
      pattern: /^file_create\s+(.+)/,
      transform: (_l, m) => ({
        category: 'success',
        message: t('fileCreated', { name: m[1] }),
        iconName: 'FileEdit',
      }),
    },
    {
      pattern: /^error:/i,
      transform: (log) => ({
        category: 'error',
        message: t('errorOccurred'),
        detail: log,
        iconName: 'AlertCircle',
      }),
    },
    {
      pattern: /test passed|all tests completed successfully|✓/i,
      transform: () => ({
        category: 'success',
        message: t('testsCompleted'),
        iconName: 'TestTube',
      }),
    },
    {
      pattern: /^git\s+commit\b/i,
      transform: () => ({
        category: 'success',
        message: t('committed'),
        iconName: 'GitBranch',
      }),
    },
    {
      pattern: /^(processing|waiting for response)/i,
      transform: (log) => ({
        category: 'progress',
        message: t('processing'),
        detail: log,
        iconName: 'Loader',
      }),
    },
    // ── Execution lifecycle ──────────────────────────────────────────────
    {
      // NOTE: The captured text (m[1]) is raw content emitted by the backend
      // agent runner, not app-authored UI text — it is shown verbatim and is
      // NOT translated.
      pattern: /^\[実行開始\]\s*(.+)/,
      transform: (_l, m) => ({
        category: 'phase-transition',
        message: m[1],
        iconName: 'Play',
      }),
    },
    {
      pattern: /^\[エージェント\]\s*(.+)/,
      transform: (_l, m) => ({
        category: 'info',
        message: t('agentPrefix', { text: m[1] }),
        iconName: 'Bot',
      }),
    },
    {
      pattern: /^\[継続実行\]/,
      transform: () => ({
        category: 'phase-transition',
        message: t('continuationResumed'),
        iconName: 'Play',
      }),
    },
    {
      pattern: /^\[System: init\]/,
      transform: () => ({
        category: 'progress',
        message: t('agentInitializing'),
        iconName: 'Loader',
      }),
    },
    {
      // NOTE: thinking_tokens events carry NO thinking text (the backend emits
      // only the subtype marker) — render one quiet entry; consecutive repeats
      // are merged into a ×N counter by dedupeConsecutiveEntries at render prep.
      pattern: /^\[System:\s*thinking\w*\]/,
      transform: () => ({
        category: 'progress',
        message: t('thinking'),
        iconName: 'Loader',
      }),
    },
    {
      pattern: /^\[System Error:\s*(.+)\]/,
      transform: (_l, m) => ({
        category: 'error',
        message: t('systemError', { detail: m[1] }),
        iconName: 'AlertCircle',
      }),
    },
    {
      // Generic system events ([System: api_retry] etc.) — quiet tool-result
      // level so they never compete with the agent narrative.
      pattern: /^\[System:\s*([\w-]+)\]/,
      transform: (_l, m) => ({
        category: 'tool-result',
        message: t('systemEvent', { name: m[1] }),
        iconName: 'Settings',
      }),
    },
    {
      pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Starting execution/i,
      transform: (_l, m) => ({
        category: 'phase-transition',
        message: t('providerStarting', { provider: m[1] }),
        iconName: 'Play',
      }),
    },
    {
      pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Working directory:\s*(.+)/i,
      transform: (_l, m) => ({
        category: 'info',
        // NOTE: full path inline (CSS truncates on real overflow only); the
        // copyText field adds a copy-to-clipboard button at the row edge.
        message: t('workingDirectory', { dir: m[2] }),
        copyText: m[2],
        iconName: 'FileSearch',
      }),
    },
    {
      pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Process PID:\s*(\d+)/i,
      transform: (_l, m) => ({
        category: 'info',
        message: t('processStarted', { pid: m[2] }),
        iconName: 'Terminal',
      }),
    },
    {
      pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Timeout:\s*(.+)/i,
      transform: (_l, m) => ({
        category: 'info',
        message: t('timeoutSetting', { timeout: m[2] }),
        iconName: 'Timer',
      }),
    },
    {
      pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*(?:Execution )?timed out/i,
      transform: (_l, m) => ({
        category: 'error',
        message: t('providerTimedOut', { provider: m[1] }),
        iconName: 'Timer',
      }),
    },
    {
      pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Error:\s*(.+)/i,
      transform: (_l, m) => ({
        category: 'error',
        message: t('providerError', { provider: m[1], detail: m[2].substring(0, 100) }),
        detail: m[2].length > 100 ? m[2] : undefined,
        iconName: 'AlertCircle',
      }),
    },

    // ── Result ───────────────────────────────────────────────────────────
    {
      pattern: /^\[Result:\s*(\w+)(?:\s*\(([^)]+)\))?\s*(\$[\d.]+)?\]/,
      transform: (_l, m) => {
        const isOk = m[1] === 'completed' || m[1] === 'success';
        // NOTE: failed results name the outcome so the verdict is scannable;
        // the WHY (result text) follows as a narrative line in the stream.
        const parts = [isOk ? t('executionCompleted') : t('executionFailed', { status: m[1] })];
        if (m[2]) parts.push(m[2]); // duration only
        // m[3] is the per-run cost ($0.xxxx) — intentionally NOT shown in the log;
        // actual usage/cost is surfaced separately.
        return {
          category: isOk ? 'success' : 'error',
          message: parts.join(' - '),
          iconName: isOk ? 'CheckCircle' : 'XCircle',
        };
      },
    },
  ];
}
