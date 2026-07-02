/**
 * log-transformers
 *
 * Converts raw log lines into UserFriendlyLogEntry objects and deduplicates
 * / groups consecutive agent-text entries. Depends on log-pattern-rules for
 * the pattern table.
 */

import { getLogPatterns, HIDDEN_PATTERNS, type UserFriendlyLogEntry } from './log-pattern-rules';
import type { LogTranslate } from './log-pattern-rules';

// NOTE: `t` is optional throughout this module so existing callers without
// i18n context — including the pre-existing test suite — keep getting the
// original Japanese strings unchanged. Callers with a next-intl translator
// (scoped to `devMode.logTransformer`) get localized messages instead.
const JA_TEMPLATES: Record<string, string> = {
  'phaseStart.research': '調査フェーズを開始しました',
  'phaseStart.plan': '計画フェーズを開始しました',
  'phaseStart.implement': '実装フェーズを開始しました',
  'phaseStart.verify': '検証フェーズを開始しました',
  fileEdited: '{basename} を編集しました',
  fileCreated: '新しいファイル {name} を作成しました',
  errorOccurred: 'エラーが発生しました',
  testsCompleted: 'テストが正常に完了しました',
  committed: '変更をコミットしました',
  processing: '処理中です',
  agentPrefix: 'エージェント: {text}',
  continuationResumed: '追加指示の実行を再開',
  agentInitializing: 'エージェントを初期化中...',
  systemError: 'システムエラー: {detail}',
  providerStarting: '{provider} の実行を開始',
  workingDirectory: '作業ディレクトリ: {dir}',
  processStarted: 'プロセス起動 PID {pid}',
  timeoutSetting: 'タイムアウト設定: {timeout}',
  instructionPrefix: '指示: {text}',
  providerTimedOut: '{provider} の実行がタイムアウトしました',
  providerError: '{provider} エラー: {detail}',
  executionCompleted: '実行完了',
  toolRead: '読込 {path}',
  toolEdit: '編集 {path}',
  toolWrite: '作成 {path}',
  testRunning: 'テストを実行中...',
  verifyRunning: '検証コマンドを実行中...',
  committing: 'コミット中...',
  pushing: 'リモートにプッシュ中...',
  gitCommand: 'Git: {cmd}',
  searchCommand: '調査: {cmd}',
  shellCommand: '$ {cmd}',
  toolSearch: '検索 {query}',
  webSearch: 'Web検索: {query}',
  webFetch: 'Web取得: {url}',
  subAgent: 'サブエージェント: {text}',
  subAgentStarting: '起動中...',
  itemCount: '{count}件',
  objectDataPlaceholder: '(データ)',
  toolErrorSuffix: '{name} でエラー',
  questionPrefix: '質問: {text}',
  testsPassedCount: 'テスト {count}件成功',
  testsFailedCount: 'テスト {count}件失敗',
  typecheckRunning: '型チェックを実行中...',
  commitMessage: 'コミット: {message}',
  pushCompleted: 'リモートにプッシュ完了',
  waitingForAnswer: '回答を待っています...',
  timedOut: 'タイムアウトしました',
  jsonStatus: '状態: {status}',
  jsonStatusTranslated: '状態: {status} ({translated})',
  jsonTaskId: 'タスク: {taskId}',
  'statusLabels.running': '実行中',
  'statusLabels.completed': '完了',
  'statusLabels.failed': '失敗',
  'statusLabels.pending': '待機中',
  'statusLabels.cancelled': '中止',
  'statusLabels.waitingForInput': '回答待ち',
  'statusLabels.inProgress': '進行中',
  'statusLabels.todo': '未着手',
  'statusLabels.waiting': '待機中',
  'statusLabels.success': '成功',
};

/** Resolves `{param}` placeholders in a template string. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in params ? String(params[key]) : match,
  );
}

/** Default translator: returns the original Japanese source strings. */
const defaultT: LogTranslate = (key, params) => interpolate(JA_TEMPLATES[key] ?? key, params);

/**
 * Translate a status string to a localized label.
 *
 * @param status - raw status string / ステータス文字列
 * @param t - Optional translator (scoped to `devMode.logTransformer`). / 翻訳関数（任意）
 * @returns Localized label / ローカライズされたラベル
 */
export function translateStatus(status: string, t: LogTranslate = defaultT): string {
  const keyMap: Record<string, string> = {
    running: 'statusLabels.running',
    completed: 'statusLabels.completed',
    failed: 'statusLabels.failed',
    pending: 'statusLabels.pending',
    cancelled: 'statusLabels.cancelled',
    waiting_for_input: 'statusLabels.waitingForInput',
    'in-progress': 'statusLabels.inProgress',
    in_progress: 'statusLabels.inProgress',
    done: 'statusLabels.completed',
    todo: 'statusLabels.todo',
    waiting: 'statusLabels.waiting',
    success: 'statusLabels.success',
  };
  const key = keyMap[status.toLowerCase()];
  return key ? t(key) : status;
}

/**
 * Transform a single log line into a user-friendly entry.
 *
 * @param line - raw log line / ログの1行
 * @param t - Optional translator (scoped to `devMode.logTransformer`) used to localize
 *   the generated `message`. / 生成されるメッセージの翻訳に使う関数（任意）
 * @returns classified log entry / 分類済みログエントリ
 */
export function transformLogToUserFriendly(
  line: string,
  t: LogTranslate = defaultT,
): UserFriendlyLogEntry {
  const trimmed = String(line ?? '').trim();
  if (HIDDEN_PATTERNS.some((p) => p.test(trimmed))) return { category: 'hidden', message: '' };

  const patterns = getLogPatterns(t);
  for (const rule of patterns) {
    const match = trimmed.match(rule.pattern);
    if (match) return rule.transform(trimmed, match);
  }

  // JSON — try to extract a message field and re-run through patterns
  const jsonMatch = trimmed.match(/^(.*?)(\{[\s\S]*\})(.*)$/);
  if (jsonMatch) {
    try {
      const [, prefix, jsonStr] = jsonMatch;
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        const msg = obj.message || obj.msg || prefix?.trim() || '';
        const keys = Object.keys(obj);
        if (
          !msg &&
          keys.length > 0 &&
          keys.every((key) => ['agentId', 'executionId', 'timestamp'].includes(key))
        ) {
          return { category: 'hidden', message: '' };
        }
        const fields = [];
        if (obj.status) {
          const rawStatus = String(obj.status);
          const translatedStatus = translateStatus(rawStatus, t);
          fields.push(
            translatedStatus === rawStatus
              ? t('jsonStatus', { status: rawStatus })
              : t('jsonStatusTranslated', { status: rawStatus, translated: translatedStatus }),
          );
        }
        if (obj.taskId && !String(obj.taskId).match(/^[0-9a-f-]{36}$/))
          fields.push(t('jsonTaskId', { taskId: String(obj.taskId) }));
        if (fields.length > 0) return { category: 'info', message: fields.join(' / ') };
        for (const rule of patterns) {
          const m = String(msg).match(rule.pattern);
          if (m) return rule.transform(String(msg), m);
        }
        if (msg) return { category: 'info', message: String(msg).substring(0, 100) };
      }
    } catch {
      /* fall through */
    }
  }

  if (trimmed.length <= 3) return { category: 'hidden', message: '' };
  if (/^(I will|Let me|First I will|Then I will)\b/i.test(trimmed)) {
    return {
      category: 'agent-text',
      message: trimmed,
      iconName: 'MessageSquare',
    };
  }
  return {
    category: 'info',
    message: trimmed.length > 80 ? `${trimmed.substring(0, 80)}...` : trimmed,
    detail: trimmed.length > 80 ? trimmed : undefined,
  };
}

/**
 * Split a mixed array of log entries (some containing newlines) into individual lines.
 *
 * @param logs - raw log entries / 生ログ配列
 * @returns flat array of non-empty lines / 改行で分割済みの行配列
 */
export function splitLogsIntoLines(logs: string[]): string[] {
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

/**
 * Collapse consecutive agent-text entries into a single grouped entry.
 *
 * @param entries - classified entries / 分類済みエントリ配列
 * @returns entries with consecutive agent-text grouped / エージェントテキストをまとめた配列
 */
export function groupAgentText(entries: UserFriendlyLogEntry[]): UserFriendlyLogEntry[] {
  const result: UserFriendlyLogEntry[] = [];
  let textBuffer: string[] = [];

  const flushText = () => {
    if (textBuffer.length === 0) return;
    const joined = textBuffer.join('\n');
    const first = textBuffer[0];
    const preview = first.length > 120 ? first.substring(0, 120) + '...' : first;
    result.push({
      category: 'agent-text',
      message: preview,
      detail: textBuffer.length > 1 ? joined : first.length > 120 ? joined : undefined,
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

/**
 * Convert an array of raw log strings into deduplicated user-friendly entries.
 *
 * @param logs - raw log lines / 生ログ配列
 * @param t - Optional translator (scoped to `devMode.logTransformer`) forwarded to
 *   {@link transformLogToUserFriendly}. / 翻訳関数（任意）
 * @returns deduplicated user-friendly entries / 重複除去済みエントリ配列
 */
export function transformLogsToSimple(
  logs: string[],
  t: LogTranslate = defaultT,
): UserFriendlyLogEntry[] {
  const lines = splitLogsIntoLines(logs);
  const entries = lines
    .map((line) => transformLogToUserFriendly(line, t))
    .filter((e) => e.category !== 'hidden');
  const grouped = groupAgentText(entries);
  return grouped.reduce((acc: UserFriendlyLogEntry[], current) => {
    const last = acc[acc.length - 1];
    if (
      last &&
      last.message === current.message &&
      last.category === current.category &&
      last.detail === current.detail
    )
      return acc;
    acc.push(current);
    return acc;
  }, []);
}
