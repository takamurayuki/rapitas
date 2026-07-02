/**
 * log-patterns-table
 *
 * Regex-based classification rules for agent log lines and hidden-line
 * patterns. Rules are ordered most-specific first. No side effects.
 *
 * NOTE: `pattern` regexes match raw tags emitted by the backend agent runner
 * (e.g. `[実行開始]`, `[Tool: Read]`) — these are a wire-format contract, not
 * UI text, and must NOT be translated. Only the human-readable `message`
 * built inside each `transform()` is user-visible; those are resolved via the
 * `t` translator passed into {@link getLogPatterns}.
 */

import type { LogTranslate, UserFriendlyLogEntry } from './log-pattern-rules';

interface LogPatternRule {
  pattern: RegExp;
  transform: (log: string, match: RegExpMatchArray) => UserFriendlyLogEntry;
}

/**
 * Builds the ordered log-classification rule table.
 *
 * @param t - Translator scoped to `devMode.logTransformer`, used to resolve each
 *   rule's human-readable `message`. / `devMode.logTransformer` にスコープした翻訳関数
 * @returns Ordered classification rules (most specific first). / 分類ルール（詳細な順）
 */
export function getLogPatterns(t: LogTranslate): LogPatternRule[] {
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
      pattern: /^\[System Error:\s*(.+)\]/,
      transform: (_l, m) => ({
        category: 'error',
        message: t('systemError', { detail: m[1] }),
        iconName: 'AlertCircle',
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
        message: t('workingDirectory', { dir: m[2].split(/[\\/]/).pop() || m[2] }),
        detail: m[2],
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
      pattern: /^\[(Codex|Gemini|Claude(?: Code)?)\]\s*Prompt:\s*(.+)/i,
      transform: (_l, m) => ({
        category: 'agent-text',
        message: t('instructionPrefix', {
          text: `${m[2].substring(0, 120)}${m[2].length > 120 ? '...' : ''}`,
        }),
        detail: m[2].length > 120 ? m[2] : undefined,
        iconName: 'MessageSquare',
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
        const parts = [t('executionCompleted')];
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
        if (/\bgit\b/i.test(cmd))
          return {
            category: 'info',
            message: t('gitCommand', {
              cmd: `${cmd.substring(0, 70)}${cmd.length > 70 ? '...' : ''}`,
            }),
            detail: cmd.length > 70 ? cmd : undefined,
            iconName: 'GitBranch',
          };
        if (/\b(rg|grep|Select-String|Get-Content|cat|sed|ls|Get-ChildItem)\b/i.test(cmd))
          return {
            category: 'info',
            message: t('searchCommand', {
              cmd: `${cmd.substring(0, 70)}${cmd.length > 70 ? '...' : ''}`,
            }),
            detail: cmd.length > 70 ? cmd : undefined,
            iconName: 'Search',
          };
        return {
          category: 'info',
          message: t('shellCommand', {
            cmd: `${cmd.substring(0, 70)}${cmd.length > 70 ? '...' : ''}`,
          }),
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
            message: t('gitCommand', { cmd: cmd.substring(0, 50) }),
            iconName: 'GitBranch',
          };
        return {
          category: 'info',
          message: t('shellCommand', {
            cmd: cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd,
          }),
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
      // runner and is shown verbatim (not translated).
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
  /^\$?\s*(?:[A-Za-z]:[\\/])?[\w@()[\].-]+(?:[\\/][\w@()[\].-]+)+$/,
  /^(import|export|const|let|function|class|interface|type|return|if|else|try|catch)\b/,
  /^[A-Za-z0-9_$]+\.(error|warn|info|debug|log)\(/,
  /^<\/?[A-Za-z][^>]*>/,
];
