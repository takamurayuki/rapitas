/**
 * date
 *
 * Lightweight relative/absolute date formatters used outside the main
 * Intl-based helpers in `@/lib/utils`. Locale-aware: defaults to the app's
 * current locale (from the locale store) but accepts an explicit override.
 */
import { useLocaleStore } from '@/stores/locale-store';

/**
 * Resolves the locale to format with: the explicit override if given,
 * otherwise the app's current locale from the locale store.
 *
 * @param locale - explicit locale override ('ja' | 'en') / 明示的なロケール指定
 * @returns the locale to use for formatting / フォーマットに使うロケール
 */
function resolveLocale(locale?: string): string {
  return locale ?? useLocaleStore.getState().locale;
}

/**
 * Simple implementation of date-fns formatDistanceToNow.
 *
 * @param date - date to compare against now / 比較対象の日時
 * @param locale - explicit locale override ('ja' | 'en'); defaults to the app locale / 明示的なロケール指定（省略時はアプリのロケール）
 * @returns localized relative time string, e.g. "5分前" / "5m ago" / ロケールに応じた相対時間文字列
 */
export function formatDistanceToNow(date: Date, locale?: string): string {
  const loc = resolveLocale(locale);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (loc === 'en') {
    if (diffSeconds < 60) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    return `${diffYears}y ago`;
  }

  if (diffSeconds < 60) {
    return 'たった今';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}分前`;
  }
  if (diffHours < 24) {
    return `${diffHours}時間前`;
  }
  if (diffDays < 30) {
    return `${diffDays}日前`;
  }
  if (diffMonths < 12) {
    return `${diffMonths}ヶ月前`;
  }
  return `${diffYears}年前`;
}

/**
 * Display date in the specified format.
 *
 * @param date - date (or ISO string) to format / フォーマットする日付
 * @param format - 'short' (MM/DD) or 'medium' (YYYY/MM/DD) / フォーマット種別
 * @returns formatted date string / フォーマット済み日付文字列
 */
export function formatDate(date: Date | string, format: 'short' | 'medium' = 'medium'): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  if (format === 'short') {
    // MM/DD
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
  }

  // medium: YYYY/MM/DD
  return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
}

/**
 * App-standard timestamp: `yyyy/mm/dd HH:mm:ss`, locale-independent
 * (operator decision 2026-09-03 — every datetime display uses this shape).
 *
 * @param date - Date or ISO string / Date か ISO 文字列
 * @returns "2026/09/03 02:45:07" style string / 統一フォーマットの日時文字列
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const p2 = (n: number): string => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ` +
    `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
  );
}

/**
 * App-standard time-only display: `HH:mm`, locale-independent
 * (companion to formatDateTime for displays that intentionally omit the date).
 *
 * @param date - Date or ISO string / Date か ISO 文字列
 * @returns "14:30" style string, or '' for an invalid date / "14:30" 形式の文字列（不正な日付は空文字）
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const p2 = (n: number): string => n.toString().padStart(2, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
