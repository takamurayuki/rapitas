/**
 * LogMessageTransformer
 *
 * Transforms raw agent execution log output into structured, user-friendly entries.
 * No emoji — icons are handled by the UI component via iconName.
 */

export type UserFriendlyLogCategory =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'progress'
  | 'phase-transition'
  | 'tool-result'
  | 'agent-text'
  | 'hidden';

export interface UserFriendlyLogEntry {
  category: UserFriendlyLogCategory;
  message: string;
  detail?: string;
  iconName?: string;
  phase?: 'research' | 'plan' | 'implement' | 'verify';
}

export interface ExecutionSummary {
  filesEdited: string[];
  filesCreated: string[];
  filesRead: string[];
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  commits: number;
  errors: string[];
  durationSeconds?: number;
  costUsd?: number;
}

// ── Pattern rules (most specific first) ────────────────

interface LogPatternRule {
  pattern: RegExp;
  transform: (log: string, match: RegExpMatchArray) => UserFriendlyLogEntry;
}

const LOG_PATTERNS: LogPatternRule[] = [
  // Execution lifecycle
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

  // Result
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

  // Workflow phases
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

  // Tool calls
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
      if (body.includes('[object Object]')) {
        body = '(データ)';
      }
      return {
        category: 'info' as const,
        message: `${name}${body ? ' ' + body.substring(0, 50) : ''}`,
        detail,
        iconName: 'Wrench',
      };
    },
  },

  // Tool results
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

  // Question
  {
    pattern: /^\[質問\]\s*(.+)/,
    transform: (_l, m) => ({
      category: 'warning',
      message: `質問: ${m[1].substring(0, 120)}`,
      detail: m[1].length > 120 ? m[1] : undefined,
      iconName: 'HelpCircle',
    }),
  },

  // Test results
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

  // Git output
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

  // Status
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

const HIDDEN_PATTERNS = [
  /^\s*$/,
  /^[{}\[\],:]*$/,
  /^Active code page:/i,
  /^現在のコード ページ:/i,
  /^chcp\s/i,
];

/**
 * Transform a single log line into a user-friendly entry.
 */
export function transformLogToUserFriendly(line: string): UserFriendlyLogEntry {
  const trimmed = line.trim();
  if (HIDDEN_PATTERNS.some((p) => p.test(trimmed)))
    return { category: 'hidden', message: '' };

  for (const rule of LOG_PATTERNS) {
    const match = trimmed.match(rule.pattern);
    if (match) return rule.transform(trimmed, match);
  }

  // JSON
  const jsonMatch = trimmed.match(/^(.*?)(\{[\s\S]*\})(.*)$/);
  if (jsonMatch) {
    try {
      const [, prefix, jsonStr] = jsonMatch;
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        const msg = obj.message || obj.msg || prefix?.trim() || '';
        for (const rule of LOG_PATTERNS) {
          const m = String(msg).match(rule.pattern);
          if (m) return rule.transform(String(msg), m);
        }
        const fields = [];
        if (obj.status)
          fields.push(`状態: ${translateStatus(String(obj.status))}`);
        if (obj.taskId && !String(obj.taskId).match(/^[0-9a-f-]{36}$/))
          fields.push(`タスク: ${obj.taskId}`);
        if (fields.length > 0)
          return { category: 'info', message: fields.join(' / ') };
        if (msg)
          return { category: 'info', message: String(msg).substring(0, 100) };
      }
    } catch {
      /* fall through */
    }
  }

  if (trimmed.length <= 3) return { category: 'hidden', message: '' };
  return { category: 'agent-text', message: trimmed };
}

function translateStatus(status: string): string {
  const map: Record<string, string> = {
    running: '実行中',
    completed: '完了',
    failed: '失敗',
    pending: '待機中',
    cancelled: '中止',
    waiting_for_input: '回答待ち',
    'in-progress': '進行中',
    in_progress: '進行中',
    done: '完了',
    todo: '未着手',
    waiting: '待機中',
    success: '成功',
  };
  return map[status.toLowerCase()] || status;
}

export function detectCurrentPhase(
  logs: string[],
): 'research' | 'plan' | 'implement' | 'verify' | null {
  const joined = logs.join('\n');
  if (/\[verify\]/i.test(joined)) return 'verify';
  if (/\[implement\]/i.test(joined)) return 'implement';
  if (/\[plan\]/i.test(joined)) return 'plan';
  if (/\[research\]/i.test(joined)) return 'research';
  return null;
}

function splitLogsIntoLines(logs: string[]): string[] {
  const lines: string[] = [];
  for (const entry of logs) {
    if (entry.includes('\n')) {
      for (const line of entry.split('\n')) {
        if (line.length > 0) lines.push(line);
      }
    } else if (entry.length > 0) {
      lines.push(entry);
    }
  }
  return lines;
}

function groupAgentText(
  entries: UserFriendlyLogEntry[],
): UserFriendlyLogEntry[] {
  const result: UserFriendlyLogEntry[] = [];
  let textBuffer: string[] = [];

  const flushText = () => {
    if (textBuffer.length === 0) return;
    const joined = textBuffer.join('\n');
    const first = textBuffer[0];
    const preview =
      first.length > 120 ? first.substring(0, 120) + '...' : first;
    result.push({
      category: 'agent-text',
      message: preview,
      detail:
        textBuffer.length > 1
          ? joined
          : first.length > 120
            ? joined
            : undefined,
      iconName: 'MessageSquare',
    });
    textBuffer = [];
  };

  for (const entry of entries) {
    if (entry.category === 'agent-text') {
      textBuffer.push(entry.message);
    } else {
      flushText();
      result.push(entry);
    }
  }
  flushText();
  return result;
}

export function transformLogsToSimple(logs: string[]): UserFriendlyLogEntry[] {
  const lines = splitLogsIntoLines(logs);
  const entries = lines
    .map(transformLogToUserFriendly)
    .filter((e) => e.category !== 'hidden');
  const grouped = groupAgentText(entries);
  return grouped.reduce((acc: UserFriendlyLogEntry[], current) => {
    const last = acc[acc.length - 1];
    if (
      last &&
      last.message === current.message &&
      last.category === current.category
    )
      return acc;
    acc.push(current);
    return acc;
  }, []);
}

export function generateExecutionSummary(
  logs: string[],
): ExecutionSummary | null {
  const lines = splitLogsIntoLines(logs);
  const filesEdited = new Set<string>();
  const filesCreated = new Set<string>();
  const filesRead = new Set<string>();
  let testsPassed = 0,
    testsFailed = 0,
    commits = 0;
  const errors: string[] = [];
  let durationSeconds: number | undefined, costUsd: number | undefined;

  for (const line of lines) {
    const t = line.trim();
    const em = t.match(/\[Tool: Edit\]\s*->\s*(\S+)/);
    if (em?.[1]) filesEdited.add(em[1]);
    const wm = t.match(/\[Tool: Write\]\s*->\s*(\S+)/);
    if (wm?.[1]) filesCreated.add(wm[1]);
    const rm = t.match(/\[Tool: Read\]\s*->\s*(\S+)/);
    if (rm?.[1]) filesRead.add(rm[1]);
    const pm = t.match(/(\d+)\s+(?:tests?\s+)?passed/i);
    if (pm?.[1]) testsPassed = Math.max(testsPassed, parseInt(pm[1], 10));
    const fm = t.match(/(\d+)\s+(?:tests?\s+)?failed/i);
    if (fm?.[1]) testsFailed = Math.max(testsFailed, parseInt(fm[1], 10));
    if (/\[Tool: Bash\]\s*\$\s*git\s+commit/.test(t)) commits++;
    const rr = t.match(
      /\[Result:\s*\w+\s*\((\d+(?:\.\d+)?)s\)\s*\$?([\d.]+)?\]/,
    );
    if (rr) {
      durationSeconds = parseFloat(rr[1]);
      if (rr[2]) costUsd = parseFloat(rr[2]);
    }
    if (/\[System Error:/.test(t)) {
      const m = t.match(/\[System Error:\s*(.+)\]/);
      if (m?.[1]) errors.push(m[1]);
    }
  }

  if (
    filesEdited.size +
      filesCreated.size +
      testsPassed +
      testsFailed +
      commits ===
    0
  )
    return null;
  return {
    filesEdited: [...filesEdited],
    filesCreated: [...filesCreated],
    filesRead: [...filesRead],
    testsRun: testsPassed + testsFailed,
    testsPassed,
    testsFailed,
    commits,
    errors,
    durationSeconds,
    costUsd,
  };
}
