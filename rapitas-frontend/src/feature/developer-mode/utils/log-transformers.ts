/**
 * log-transformers
 *
 * Converts raw log lines into UserFriendlyLogEntry objects and deduplicates
 * / groups consecutive agent-text entries. Depends on log-pattern-rules for
 * the pattern table.
 */

import { LOG_PATTERNS, HIDDEN_PATTERNS, type UserFriendlyLogEntry } from './log-pattern-rules';

/**
 * Translate a status string to a Japanese label.
 *
 * @param status - raw status string / ステータス文字列
 * @returns Japanese label / 日本語ラベル
 */
export function translateStatus(status: string): string {
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

/**
 * Transform a single log line into a user-friendly entry.
 *
 * @param line - raw log line / ログの1行
 * @returns classified log entry / 分類済みログエントリ
 */
export function transformLogToUserFriendly(line: string): UserFriendlyLogEntry {
  const trimmed = String(line ?? '').trim();
  if (HIDDEN_PATTERNS.some((p) => p.test(trimmed))) return { category: 'hidden', message: '' };

  for (const rule of LOG_PATTERNS) {
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
          const translatedStatus = translateStatus(rawStatus);
          fields.push(
            translatedStatus === rawStatus
              ? `状態: ${rawStatus}`
              : `状態: ${rawStatus} (${translatedStatus})`,
          );
        }
        if (obj.taskId && !String(obj.taskId).match(/^[0-9a-f-]{36}$/))
          fields.push(`タスク: ${obj.taskId}`);
        if (fields.length > 0) return { category: 'info', message: fields.join(' / ') };
        for (const rule of LOG_PATTERNS) {
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
 * @returns deduplicated user-friendly entries / 重複除去済みエントリ配列
 */
export function transformLogsToSimple(logs: string[]): UserFriendlyLogEntry[] {
  const lines = splitLogsIntoLines(logs);
  const entries = lines.map(transformLogToUserFriendly).filter((e) => e.category !== 'hidden');
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
