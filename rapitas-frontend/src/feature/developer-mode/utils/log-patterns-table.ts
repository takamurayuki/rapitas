/**
 * log-patterns-table
 *
 * Regex-based classification rules for agent log lines and hidden-line
 * patterns. Rules are ordered most-specific first. No side effects.
 */

import type { UserFriendlyLogEntry } from './log-pattern-rules';

interface LogPatternRule {
  pattern: RegExp;
  transform: (log: string, match: RegExpMatchArray) => UserFriendlyLogEntry;
}

export const LOG_PATTERNS: LogPatternRule[] = [
  // ── Execution lifecycle ──────────────────────────────────────────────
  {
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
      message: `エージェント: ${m[1]}`,
      iconName: 'Bot',
    }),
  },
  {
    pattern: /^\[継続実行\]/,
    transform: () => ({
      category: 'phase-transition',
      message: '追加指示の実行を再開',
      iconName: 'Play',
    }),
  },
  {
    pattern: /^\[System: init\]/,
    transform: () => ({
      category: 'progress',
      message: 'エージェントを初期化中...',
      iconName: 'Loader',
    }),
  },
  {
    pattern: /^\[System Error:\s*(.+)\]/,
    transform: (_l, m) => ({
      category: 'error',
      message: `システムエラー: ${m[1]}`,
      iconName: 'AlertCircle',
    }),
  },

  // ── Result ───────────────────────────────────────────────────────────
  {
    pattern: /^\[Result:\s*(\w+)(?:\s*\(([^)]+)\))?\s*(\$[\d.]+)?\]/,
    transform: (_l, m) => {
      const isOk = m[1] === 'completed' || m[1] === 'success';
      const parts = ['実行完了'];
      if (m[2]) parts.push(m[2]);
      if (m[3]) parts.push(m[3]);
      return {
        category: isOk ? 'success' : 'error',
        message: parts.join(' - '),
        iconName: isOk ? 'CheckCircle' : 'XCircle',
      };
    },
  },

  // ── Workflow phases ───────────────────────────────────────────────────
  {
    pattern: /\[(research)\]/i,
    transform: () => ({
      category: 'phase-transition',
      message: '調査フェーズ',
      iconName: 'Search',
      phase: 'research' as const,
    }),
  },
  {
    pattern: /\[(plan)\]/i,
    transform: () => ({
      category: 'phase-transition',
      message: '計画フェーズ',
      iconName: 'ClipboardList',
      phase: 'plan' as const,
    }),
  },
  {
    pattern: /\[(implement)\]/i,
    transform: () => ({
      category: 'phase-transition',
      message: '実装フェーズ',
      iconName: 'Code',
      phase: 'implement' as const,
    }),
  },
  {
    pattern: /\[(verify)\]/i,
    transform: () => ({
      category: 'phase-transition',
      message: '検証フェーズ',
      iconName: 'ShieldCheck',
      phase: 'verify' as const,
    }),
  },

  // ── Tool calls — file operations ──────────────────────────────────────
  {
    pattern: /^\[Tool: Read\]\s*->\s*(.+)/,
    transform: (_l, m) => ({
      category: 'info',
      message: `読込 ${m[1]}`,
      iconName: 'FileSearch',
    }),
  },
  {
    pattern: /^\[Tool: Edit\]\s*->\s*(.+)/,
    transform: (_l, m) => ({
      category: 'info',
      message: `編集 ${m[1]}`,
      iconName: 'FileEdit',
    }),
  },
  {
    pattern: /^\[Tool: Write\]\s*->\s*(.+)/,
    transform: (_l, m) => ({
      category: 'success',
      message: `作成 ${m[1]}`,
      iconName: 'FilePlus',
    }),
  },

  // ── Tool calls — Bash (multiple sub-cases) ────────────────────────────
  {
    pattern: /^\[Tool: Bash\]\s*\$\s*(.+)/,
    transform: (_l, m) => {
      const cmd = m[1];
      if (/^(bun|npm|yarn|pnpm)\s+(test|run\s+test)/.test(cmd))
        return {
          category: 'progress',
          message: 'テストを実行中...',
          iconName: 'FlaskConical',
        };
      if (/^git\s+commit/.test(cmd))
        return {
          category: 'info',
          message: 'コミット中...',
          iconName: 'GitCommitHorizontal',
        };
      if (/^git\s+push/.test(cmd))
        return {
          category: 'info',
          message: 'リモートにプッシュ中...',
          iconName: 'Upload',
        };
      if (/^git\s+/.test(cmd))
        return {
          category: 'info',
          message: `Git: ${cmd.substring(0, 50)}`,
          iconName: 'GitBranch',
        };
      return {
        category: 'info',
        message: `$ ${cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd}`,
        detail: cmd.length > 60 ? cmd : undefined,
        iconName: 'Terminal',
      };
    },
  },

  // ── Tool calls — search and web ───────────────────────────────────────
  {
    pattern: /^\[Tool: (Glob|Grep)\]\s*(?:pattern:\s*)?(.+)/,
    transform: (_l, m) => ({
      category: 'info',
      message: `検索 ${m[2]}`,
      iconName: 'Search',
    }),
  },
  {
    pattern: /^\[Tool: WebSearch\]\s*"(.+)"/,
    transform: (_l, m) => ({
      category: 'info',
      message: `Web検索: ${m[1]}`,
      iconName: 'Globe',
    }),
  },
  {
    pattern: /^\[Tool: WebFetch\]\s*->\s*(.+)/,
    transform: (_l, m) => ({
      category: 'info',
      message: `Web取得: ${m[1]}`,
      iconName: 'Globe',
    }),
  },
  {
    pattern: /^\[Tool: Agent\]\s*(.*)/,
    transform: (_l, m) => ({
      category: 'progress',
      message: `サブエージェント: ${m[1] || '起動中...'}`.substring(0, 60),
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
          body = Array.isArray(parsed) ? `${parsed.length}件` : '';
        } catch {
          /* not JSON */
        }
      }
      if (body.includes('[object Object]')) body = '(データ)';
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
      message: `${m[1]} でエラー${m[2] ? ` (${m[2]})` : ''}`,
      iconName: 'AlertTriangle',
    }),
  },

  // ── Question ──────────────────────────────────────────────────────────
  {
    pattern: /^\[質問\]\s*(.+)/,
    transform: (_l, m) => ({
      category: 'warning',
      message: `質問: ${m[1].substring(0, 120)}`,
      detail: m[1].length > 120 ? m[1] : undefined,
      iconName: 'HelpCircle',
    }),
  },

  // ── Test results ──────────────────────────────────────────────────────
  {
    pattern: /(\d+)\s+(?:tests?\s+)?passed/i,
    transform: (_l, m) => ({
      category: 'success',
      message: `テスト ${m[1]}件成功`,
      iconName: 'CheckCircle',
    }),
  },
  {
    pattern: /(\d+)\s+(?:tests?\s+)?failed/i,
    transform: (_l, m) => ({
      category: 'error',
      message: `テスト ${m[1]}件失敗`,
      iconName: 'XCircle',
    }),
  },

  // ── Git output ────────────────────────────────────────────────────────
  {
    pattern: /\[(?:master|main|feature\/[^\]]+)\s+[a-f0-9]+\]\s*(.+)/,
    transform: (_l, m) => ({
      category: 'success',
      message: `コミット: ${m[1]}`,
      iconName: 'GitCommitHorizontal',
    }),
  },
  {
    pattern: /To\s+(?:https?:\/\/|git@).*\.git/,
    transform: () => ({
      category: 'success',
      message: 'リモートにプッシュ完了',
      iconName: 'Upload',
    }),
  },

  // ── Status ────────────────────────────────────────────────────────────
  {
    pattern: /^\[WAITING\]/,
    transform: () => ({
      category: 'warning',
      message: '回答を待っています...',
      iconName: 'Clock',
    }),
  },
  {
    pattern: /^\[TIMEOUT\]/,
    transform: () => ({
      category: 'error',
      message: 'タイムアウトしました',
      iconName: 'Timer',
    }),
  },
];

export const HIDDEN_PATTERNS = [
  /^\s*$/,
  /^[{}\[\],:]*$/,
  /^Active code page:/i,
  /^現在のコード ページ:/i,
  /^chcp\s/i,
];
