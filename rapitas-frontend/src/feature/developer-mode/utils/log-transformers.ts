/**
 * log-transformers
 *
 * Converts raw log lines into UserFriendlyLogEntry objects: collapses raw
 * markdown-file dumps, classifies lines (narrative prose vs mechanical
 * events), groups consecutive agent narrative, and merges consecutive
 * duplicates into ×N counters. Depends on log-pattern-rules for the pattern
 * table and log-display-utils for the pure render-prep helpers.
 */

import { getLogPatterns, HIDDEN_PATTERNS, type UserFriendlyLogEntry } from './log-pattern-rules';
import type { LogTranslate } from './log-pattern-rules';
import { defaultT } from './log-default-translations';
import {
  collapseMarkdownBlocks,
  dedupeConsecutiveEntries,
  isNarrativeProse,
  stripMarkdownDecorations,
  type MarkdownBlockToken,
} from './log-display-utils';

// Narrative preview cap — roughly three wrapped lines in the viewer; the full
// passage stays available via `detail` (click-to-expand).
const NARRATIVE_PREVIEW_CHARS = 280;

// NOTE: duplicates are not always adjacent — the same event (e.g. "verify.md
// saved") can be emitted by two log sources a few entries apart, so dedup
// searches a small window rather than only the previous entry.
const DEDUP_LOOKBACK_ENTRIES = 6;

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
  // Unmatched prose is the agent's own reasoning — the narrative a human
  // follows through the log — so it is promoted, not treated as noise.
  if (isNarrativeProse(trimmed)) {
    return {
      category: 'agent-text',
      message: stripMarkdownDecorations(trimmed),
      // NOTE: Bot = the agent speaking (its own narrative); MessageSquare is
      // reserved for instructions sent TO the agent.
      iconName: 'Bot',
    };
  }
  const cleaned = stripMarkdownDecorations(trimmed);
  return {
    category: 'info',
    message: cleaned.length > 80 ? `${cleaned.substring(0, 80)}...` : cleaned,
    detail: cleaned.length > 80 ? trimmed : undefined,
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
 * The joined passage is kept readable: up to {@link NARRATIVE_PREVIEW_CHARS}
 * chars go into `message` (the viewer clamps it to ~3 lines); the full text is
 * kept in `detail` whenever lines were merged or the preview was truncated.
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
    const truncated = joined.length > NARRATIVE_PREVIEW_CHARS;
    result.push({
      category: 'agent-text',
      message: truncated ? `${joined.substring(0, NARRATIVE_PREVIEW_CHARS)}...` : joined,
      detail: truncated || textBuffer.length > 1 ? joined : undefined,
      iconName: 'Bot', // the agent speaking — see icon note in transformLogToUserFriendly
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

/** Build the single summary entry for a collapsed markdown dump. */
function markdownBlockEntry(token: MarkdownBlockToken, t: LogTranslate): UserFriendlyLogEntry {
  // NOTE: en-US grouping (1,234) is used in both locales for the char count.
  const chars = token.charCount.toLocaleString('en-US');
  return {
    category: 'info',
    message: token.fileName
      ? t('mdContentNamed', { name: token.fileName, chars })
      : t('mdContent', { chars }),
    detail: token.content,
    detailFormat: 'markdown',
    iconName: 'FileText',
  };
}

/**
 * Convert an array of raw log strings into deduplicated user-friendly entries.
 *
 * Pipeline: split lines → collapse raw markdown dumps → classify → drop hidden
 * → group consecutive narrative → merge consecutive duplicates into ×N counts.
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
  const tokens = collapseMarkdownBlocks(splitLogsIntoLines(logs));
  const entries: UserFriendlyLogEntry[] = [];
  for (const token of tokens) {
    if (typeof token !== 'string') {
      entries.push(markdownBlockEntry(token, t));
      continue;
    }
    const entry = transformLogToUserFriendly(token, t);
    if (entry.category !== 'hidden') entries.push(entry);
  }
  return dedupeConsecutiveEntries(groupAgentText(entries), DEDUP_LOOKBACK_ENTRIES);
}
