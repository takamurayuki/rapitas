/**
 * log-patterns/tool-patterns
 *
 * Classification rules for tool invocations ([Tool: ...], [Command] ...) and
 * tool results ([Tool Done/Error: ...]). Split out of log-patterns-table.ts
 * per COMPONENT_SPLITTING_POLICY.
 *
 * NOTE: `pattern` regexes match raw tags emitted by the backend agent runner —
 * a wire-format contract, not UI text; do NOT translate them. Tool names,
 * paths, commands, and durations shown in messages are raw data, not
 * app-authored copy, so they are shown verbatim.
 */

import type { LogTranslate } from '../log-pattern-rules';
import type { LogPatternRule } from './types';

/**
 * Builds the tool-call / tool-result rule group.
 *
 * @param t - Translator scoped to `devMode.logTransformer`. / `devMode.logTransformer` にスコープした翻訳関数
 * @returns Ordered tool classification rules. / ツール分類ルール
 */
export function getToolPatterns(t: LogTranslate): LogPatternRule[] {
  return [
    // ── Tool calls — file operations ──────────────────────────────────────
    {
      pattern: /^\[Tool: Read\]\s*->\s*(.+)/,
      transform: (_l, m) => ({
        category: 'info',
        message: t('toolRead', { path: m[1] }),
        iconName: 'FileSearch',
      }),
    },
    {
      pattern: /^\[Tool: Edit\]\s*->\s*(.+)/,
      transform: (_l, m) => ({
        category: 'info',
        message: t('toolEdit', { path: m[1] }),
        iconName: 'FileEdit',
      }),
    },
    {
      pattern: /^\[Tool: Write\]\s*->\s*(.+)/,
      transform: (_l, m) => ({
        category: 'success',
        message: t('toolWrite', { path: m[1] }),
        iconName: 'FilePlus',
      }),
    },

    // ── Tool calls — Bash (multiple sub-cases) ────────────────────────────
    {
      pattern: /^\[Command\]\s*(.+)/,
      transform: (_l, m) => {
        const cmd = m[1].trim();
        if (/(?:^|\s)(bun|npm|yarn|pnpm)\s+(?:test|run\s+test|vitest)/i.test(cmd))
          return {
            category: 'progress',
            message: t('testRunning'),
            detail: cmd,
            iconName: 'TestTube',
          };
        if (/(?:^|\s)(tsc|cargo\s+clippy|cargo\s+test|prettier)\b/i.test(cmd))
          return {
            category: 'progress',
            message: t('verifyRunning'),
            detail: cmd,
            iconName: 'ShieldCheck',
          };
        if (/\bgit\s+commit\b/i.test(cmd))
          return {
            category: 'info',
            message: t('committing'),
            detail: cmd,
            iconName: 'GitCommitHorizontal',
          };
        if (/\bgit\s+push\b/i.test(cmd))
          return {
            category: 'info',
            message: t('pushing'),
            detail: cmd,
            iconName: 'Upload',
          };
        // NOTE: commands carry the FULL text — the viewer's CSS `truncate`
        // handles real overflow, so no hard character slicing here.
        if (/\bgit\b/i.test(cmd))
          return {
            category: 'info',
            message: t('gitCommand', { cmd }),
            iconName: 'GitBranch',
          };
        if (/\b(rg|grep|Select-String|Get-Content|cat|sed|ls|Get-ChildItem)\b/i.test(cmd))
          return {
            category: 'info',
            message: t('searchCommand', { cmd }),
            iconName: 'Search',
          };
        return {
          category: 'info',
          message: t('shellCommand', { cmd }),
          iconName: 'Terminal',
        };
      },
    },
    {
      pattern: /^\[Tool: Bash\]\s*\$\s*(.+)/,
      transform: (_l, m) => {
        const cmd = m[1];
        if (/^(bun|npm|yarn|pnpm)\s+(test|run\s+test)/.test(cmd))
          return {
            category: 'progress',
            message: t('testRunning'),
            iconName: 'FlaskConical',
          };
        if (/^git\s+commit/.test(cmd))
          return {
            category: 'info',
            message: t('committing'),
            iconName: 'GitCommitHorizontal',
          };
        if (/^git\s+push/.test(cmd))
          return {
            category: 'info',
            message: t('pushing'),
            iconName: 'Upload',
          };
        if (/^git\s+/.test(cmd))
          return {
            category: 'info',
            message: t('gitCommand', { cmd }),
            iconName: 'GitBranch',
          };
        // NOTE: full command text — CSS `truncate` decides overflow, no slicing.
        return {
          category: 'info',
          message: t('shellCommand', { cmd }),
          iconName: 'Terminal',
        };
      },
    },

    // ── Tool calls — search and web ───────────────────────────────────────
    {
      pattern: /^\[Tool: (Glob|Grep)\]\s*(?:pattern:\s*)?(.+)/,
      transform: (_l, m) => ({
        category: 'info',
        message: t('toolSearch', { query: m[2] }),
        iconName: 'Search',
      }),
    },
    {
      pattern: /^\[Tool: WebSearch\]\s*"(.+)"/,
      transform: (_l, m) => ({
        category: 'info',
        message: t('webSearch', { query: m[1] }),
        iconName: 'Globe',
      }),
    },
    {
      pattern: /^\[Tool: WebFetch\]\s*->\s*(.+)/,
      transform: (_l, m) => ({
        category: 'info',
        message: t('webFetch', { url: m[1] }),
        iconName: 'Globe',
      }),
    },
    {
      pattern: /^\[Tool: Agent\]\s*(.*)/,
      // NOTE: the "起動中..." fallback below is baked into the raw content
      // slot (not a separate translatable literal) to keep the 60-char
      // substring truncation identical to the previous behavior.
      transform: (_l, m) => ({
        category: 'progress',
        message: t('subAgent', { text: m[1] || t('subAgentStarting') }).substring(0, 60),
        iconName: 'Bot',
      }),
    },

    // ── Tool calls — generic fallback ─────────────────────────────────────
    {
      pattern: /^\[Tool: (\w+)\]\s*(.*)/,
      transform: (_l, m) => {
        const name = m[1];
        let body = m[2] || '';
        let detail: string | undefined;
        // NOTE: Parse JSON data or handle "[object Object]" from improperly serialized tool input
        if (body.startsWith('[') || body.startsWith('{')) {
          try {
            const parsed = JSON.parse(body);
            detail = JSON.stringify(parsed, null, 2);
            body = Array.isArray(parsed) ? t('itemCount', { count: parsed.length }) : '';
          } catch {
            /* not JSON */
          }
        }
        if (body.includes('[object Object]')) body = t('objectDataPlaceholder');
        return {
          category: 'info' as const,
          message: `${name}${body ? ' ' + body.substring(0, 50) : ''}`,
          detail,
          iconName: 'Wrench',
        };
      },
    },

    // ── Tool results ──────────────────────────────────────────────────────
    {
      pattern: /^\[Tool Done: (\w+)\]\s*\(([^)]+)\)/,
      transform: (_l, m) => ({
        category: 'tool-result',
        message: `${m[1]} (${m[2]})`,
        iconName: 'Check',
      }),
    },
    {
      // NOTE: Bash tool errors are routine (non-zero exit codes from grep, git diff, etc.)
      // so they are shown at tool-result level, not warning.
      pattern: /^\[Tool Error: Bash\](?:\s*\(([^)]+)\))?/,
      transform: (_l, m) => ({
        category: 'tool-result',
        message: `Bash${m[1] ? ` (${m[1]})` : ''}`,
        iconName: 'Terminal',
      }),
    },
    {
      pattern: /^\[Tool Error: (\w+)\](?:\s*\(([^)]+)\))?/,
      transform: (_l, m) => ({
        category: 'warning',
        message: `${t('toolErrorSuffix', { name: m[1] })}${m[2] ? ` (${m[2]})` : ''}`,
        iconName: 'AlertTriangle',
      }),
    },
  ];
}
