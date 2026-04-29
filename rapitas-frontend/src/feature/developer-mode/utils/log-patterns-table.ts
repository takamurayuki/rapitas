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
  // ── Legacy plain log formats used by existing tests ─────────────────
  {
    pattern: /\[(research)\]/i,
    transform: () => ({
      category: 'progress',
      message: '📊 調査フェーズを開始しました',
      iconName: 'Search',
      phase: 'research' as const,
    }),
  },
  {
    pattern: /\[(plan)\]/i,
    transform: () => ({
      category: 'progress',
      message: '📋 計画フェーズを開始しました',
      iconName: 'ClipboardList',
      phase: 'plan' as const,
    }),
  },
  {
    pattern: /\[(implement)\]/i,
    transform: () => ({
      category: 'progress',
      message: '💻 実装フェーズを開始しました',
      iconName: 'Code',
      phase: 'implement' as const,
    }),
  },
  {
    pattern: /\[(verify)\]/i,
    transform: () => ({
      category: 'progress',
      message: '🧪 検証フェーズを開始しました',
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
        message: `📝 ${basename} を編集しました`,
        detail: file,
        iconName: 'FileEdit',
      };
    },
  },
  {
    pattern: /^file_create\s+(.+)/,
    transform: (_l, m) => ({
      category: 'success',
      message: `✨ 新しいファイル ${m[1]} を作成しました`,
      iconName: 'FileEdit',
    }),
  },
  {
    pattern: /^error:/i,
    transform: (log) => ({
      category: 'error',
      message: '❌ エラーが発生しました',
      detail: log,
      iconName: 'AlertCircle',
    }),
  },
  {
    pattern: /test passed|all tests completed successfully|✓/i,
    transform: () => ({
      category: 'success',
      message: '✅ テストが正常に完了しました',
      iconName: 'TestTube',
    }),
  },
  {
    pattern: /^git\s+commit\b/i,
    transform: () => ({
      category: 'success',
      message: '💾 変更をコミットしました',
      iconName: 'GitBranch',
    }),
  },
  {
    pattern: /^(processing|waiting for response)/i,
    transform: (log) => ({
      category: 'progress',
      message: '⏳ 処理中です',
      detail: log,
      iconName: 'Loader',
    }),
  },
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
  {
    pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Starting execution/i,
    transform: (_l, m) => ({
      category: 'phase-transition',
      message: `${m[1]} の実行を開始`,
      iconName: 'Play',
    }),
  },
  {
    pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Working directory:\s*(.+)/i,
    transform: (_l, m) => ({
      category: 'info',
      message: `作業ディレクトリ: ${m[2].split(/[\\/]/).pop() || m[2]}`,
      detail: m[2],
      iconName: 'FileSearch',
    }),
  },
  {
    pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Process PID:\s*(\d+)/i,
    transform: (_l, m) => ({
      category: 'info',
      message: `プロセス起動 PID ${m[2]}`,
      iconName: 'Terminal',
    }),
  },
  {
    pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Timeout:\s*(.+)/i,
    transform: (_l, m) => ({
      category: 'info',
      message: `タイムアウト設定: ${m[2]}`,
      iconName: 'Timer',
    }),
  },
  {
    pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Prompt:\s*(.+)/i,
    transform: (_l, m) => ({
      category: 'agent-text',
      message: `指示: ${m[2].substring(0, 120)}${m[2].length > 120 ? '...' : ''}`,
      detail: m[2].length > 120 ? m[2] : undefined,
      iconName: 'MessageSquare',
    }),
  },
  {
    pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*(?:Execution )?timed out/i,
    transform: (_l, m) => ({
      category: 'error',
      message: `${m[1]} の実行がタイムアウトしました`,
      iconName: 'Timer',
    }),
  },
  {
    pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Error:\s*(.+)/i,
    transform: (_l, m) => ({
      category: 'error',
      message: `${m[1]} エラー: ${m[2].substring(0, 100)}`,
      detail: m[2].length > 100 ? m[2] : undefined,
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
    pattern: /^\[Command\]\s*(.+)/,
    transform: (_l, m) => {
      const cmd = m[1].trim();
      if (/(?:^|\s)(bun|npm|yarn|pnpm)\s+(?:test|run\s+test|vitest)/i.test(cmd))
        return {
          category: 'progress',
          message: 'テストを実行中...',
          detail: cmd,
          iconName: 'TestTube',
        };
      if (/(?:^|\s)(tsc|cargo\s+clippy|cargo\s+test|prettier)\b/i.test(cmd))
        return {
          category: 'progress',
          message: '検証コマンドを実行中...',
          detail: cmd,
          iconName: 'ShieldCheck',
        };
      if (/\bgit\s+commit\b/i.test(cmd))
        return {
          category: 'info',
          message: 'コミット中...',
          detail: cmd,
          iconName: 'GitCommitHorizontal',
        };
      if (/\bgit\s+push\b/i.test(cmd))
        return {
          category: 'info',
          message: 'リモートにプッシュ中...',
          detail: cmd,
          iconName: 'Upload',
        };
      if (/\bgit\b/i.test(cmd))
        return {
          category: 'info',
          message: `Git: ${cmd.substring(0, 70)}${cmd.length > 70 ? '...' : ''}`,
          detail: cmd.length > 70 ? cmd : undefined,
          iconName: 'GitBranch',
        };
      if (/\b(rg|grep|Select-String|Get-Content|cat|sed|ls|Get-ChildItem)\b/i.test(cmd))
        return {
          category: 'info',
          message: `調査: ${cmd.substring(0, 70)}${cmd.length > 70 ? '...' : ''}`,
          detail: cmd.length > 70 ? cmd : undefined,
          iconName: 'Search',
        };
      return {
        category: 'info',
        message: `$ ${cmd.substring(0, 70)}${cmd.length > 70 ? '...' : ''}`,
        detail: cmd.length > 70 ? cmd : undefined,
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
  {
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
  {
    pattern: /typecheck|type-check|tsc --noEmit/i,
    transform: () => ({
      category: 'progress',
      message: '型チェックを実行中...',
      iconName: 'ShieldCheck',
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
  /^\[codex\] hidden \d+ noisy line\(s\)/i,
  /^\[gemini\] hidden \d+ noisy line\(s\)/i,
  /codex_core::session: failed to record rollout/i,
  /^diff --git /,
  /^index [a-f0-9]+\.\.[a-f0-9]+/,
  /^--- /,
  /^\+\+\+ /,
  /^@@ /,
  /^[+-](?![+-]{2}\s)/,
  /^(import|export|const|let|function|class|interface|type|return|if|else|try|catch)\b/,
  /^[A-Za-z0-9_$]+\.(error|warn|info|debug|log)\(/,
  /^<\/?[A-Za-z][^>]*>/,
];
